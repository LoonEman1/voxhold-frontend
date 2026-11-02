import { E2EEMediaTransform, type E2EETransformMode } from '../../src/services/e2ee/mediaTransform'
import type { WorkerEvent } from '../../src/services/e2ee/frameProcessor'
import { BrowserVoiceSession } from '../../src/services/voice'
import type { BrowserVoiceInput } from '../../src/services/voiceInput'
import { DEFAULT_VOICE_PREFERENCES } from '../../src/services/voiceSettings'

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

async function gathered(peer: RTCPeerConnection) {
  if (peer.iceGatheringState === 'complete') return
  await new Promise<void>((resolve) => peer.addEventListener('icegatheringstatechange', () => {
    if (peer.iceGatheringState === 'complete') resolve()
  }))
}

async function runSession(mode: E2EETransformMode | 'none', keyState: 'valid' | 'wrong' | 'missing' = 'valid') {
  const started = performance.now()
  const events: { side: string; event: WorkerEvent }[] = []
  const errors: string[] = []
  const sendTransform = mode === 'none' ? null : new E2EEMediaTransform(mode, (event) => events.push({ side: 'sender', event }))
  const receiveTransform = mode === 'none' ? null : new E2EEMediaTransform(mode, (event) => events.push({ side: 'receiver', event }))
  const key = crypto.getRandomValues(new Uint8Array(32))
  sendTransform?.setSendKey(0, key)
  receiveTransform?.setSendKey(1, key)
  if (keyState !== 'missing') receiveTransform?.addReceiveKey('sender', 0, keyState === 'wrong' ? crypto.getRandomValues(new Uint8Array(32)) : key)
  const relay = new RTCPeerConnection(sendTransform?.peerConfiguration({}) ?? {})
  const transceiver = relay.addTransceiver('audio', { direction: 'recvonly' })
  sendTransform?.attachSender(transceiver.sender, 'audio')
  transceiver.setCodecPreferences(RTCRtpSender.getCapabilities('audio')!.codecs.filter((codec) => codec.mimeType.toLowerCase() === 'audio/opus'))
  const context = new AudioContext({ sampleRate: 48_000 })
  await context.resume()
  const oscillator = context.createOscillator()
  oscillator.frequency.value = 440
  const gain = context.createGain()
  gain.gain.value = 0.25
  const destination = context.createMediaStreamDestination()
  oscillator.connect(gain).connect(destination)
  const track = destination.stream.getAudioTracks()[0]!
  const localTrack = track.clone()
  const localStream = new MediaStream([localTrack])
  const pending: RTCIceCandidateInit[] = []
  let answer = Promise.resolve()
  let connected = false
  const input = {
    currentTrack: () => localTrack, currentStream: () => localStream, isHealthy: true,
    setState: () => {}, subscribe: () => () => {}, resume: () => {},
  } as unknown as BrowserVoiceInput
  const session = new BrowserVoiceSession({
    input,
    e2ee: receiveTransform ? { media: receiveTransform, onReceiverOwners: (owners) => owners.forEach((owner, id) => receiveTransform.mapReceiver(id, owner)) } : undefined,
    onAnswer: (sdp) => { answer = relay.setRemoteDescription({ type: 'answer', sdp }) },
    onICECandidate: (candidate) => {
      const value = { candidate: candidate.candidate, sdpMid: candidate.sdp_mid, sdpMLineIndex: candidate.sdp_mline_index }
      if (relay.remoteDescription) void relay.addIceCandidate(value).catch((error: Error) => errors.push(error.message))
      else pending.push(value)
    },
    onConnectionStateChange: (state) => { connected = state === 'connected' },
    onError: (error) => errors.push(error.message),
  })
  relay.onicecandidate = ({ candidate }) => {
    if (candidate) void session.addICECandidate({ candidate: candidate.candidate, sdp_mid: candidate.sdpMid ?? undefined, sdp_mline_index: candidate.sdpMLineIndex ?? undefined })
  }
  const negotiate = async () => {
    await relay.setLocalDescription(await relay.createOffer())
    await gathered(relay)
    // Pion advertises the forwarding connection in both forms of msid.
    const offer = relay.localDescription!.sdp.replace(/(a=(?:ssrc:\d+ )?msid:\S+ )[^\r\n ]+/g, '$1audio-sender')
    await session.acceptOffer(offer)
    await answer
    for (const candidate of pending.splice(0)) await relay.addIceCandidate(candidate)
  }
  try {
    await session.start(false, false, DEFAULT_VOICE_PREFERENCES)
    await negotiate()
    await delay(300)
    await transceiver.sender.replaceTrack(track)
    transceiver.direction = 'sendrecv'
    await negotiate()
    oscillator.start()
    const deadline = Date.now() + 10_000
    while ((!connected || !document.querySelector('.voice-audio-output')) && Date.now() < deadline) await delay(50)
    const playback = document.querySelector<HTMLAudioElement>('.voice-audio-output')!
    playback.volume = 0.000001
    const analyser = context.createAnalyser()
    analyser.fftSize = 8192
    const source = context.createMediaStreamSource(playback.srcObject as MediaStream)
    source.connect(analyser)
    const silent = context.createGain()
    silent.gain.value = 0.000001
    analyser.connect(silent).connect(context.destination)
    await delay(3500)
    const values = new Float32Array(analyser.fftSize)
    analyser.getFloatTimeDomainData(values)
    let energy = 0, sine = 0, cosine = 0
    for (let index = 0; index < values.length; index++) {
      const value = values[index]!
      const phase = 2 * Math.PI * 440 * index / context.sampleRate
      energy += value * value
      sine += value * Math.sin(phase)
      cosine += value * Math.cos(phase)
    }
    if (mode !== 'none') await delay(Math.max(0, 16_000 - (performance.now() - started)))
    let encrypted = 0, decrypted = 0, authDrops = 0, unknownKeyDrops = 0
    for (const { side, event } of events) {
      if (event.type !== 'stats') continue
      if (side === 'sender') encrypted += event.encrypted
      else { decrypted += event.decrypted; authDrops += event.dropped.auth; unknownKeyDrops += event.dropped.unknown_key }
    }
    return { mode, keyState, connected, errors, rms: Math.sqrt(energy / values.length), toneRatio: energy ? Math.min(1, 2 * (sine * sine + cosine * cosine) / (values.length * energy)) : 0, encrypted, decrypted, authDrops, unknownKeyDrops }
  } finally {
    session.close()
    relay.close()
    sendTransform?.close()
    receiveTransform?.close()
    oscillator.stop()
    track.stop()
    localTrack.stop()
    await context.close()
  }
}

export type AudioProbeResult = Awaited<ReturnType<typeof runSession>>
export type AudioProbe = { runSession: typeof runSession }

Object.assign(window, { e2eeAudioProbe: { runSession } })
