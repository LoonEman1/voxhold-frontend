// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BrowserVoiceSession, voiceCloseMessage } from './voice'
import { BrowserVoiceInput } from './voiceInput'
import { DEFAULT_VOICE_PREFERENCES } from './voiceSettings'
import type { E2EEMediaTransform } from './e2ee/mediaTransform'
import { AudioPlaybackMixer } from './audioPlaybackMixer'

class FakeTrack extends EventTarget {
  readonly id = crypto.randomUUID()
  constructor(readonly kind: 'audio' | 'video' = 'audio') { super() }
  enabled = true
  readyState = 'live'
  stop = vi.fn(() => { this.readyState = 'ended' })
}

class FakeMediaStream {
  private tracks: FakeTrack[]

  constructor(tracks: FakeTrack[] = []) {
    this.tracks = [...tracks]
  }

  getTracks() { return [...this.tracks] }
  getAudioTracks() { return this.tracks.filter((track) => track.kind === 'audio') }
  getVideoTracks() { return this.tracks.filter((track) => track.kind === 'video') }
  addTrack(track: FakeTrack) { this.tracks.push(track) }
  removeTrack(track: FakeTrack) { this.tracks = this.tracks.filter((item) => item !== track) }
}

class FakeSender {
  parameters = { encodings: [{}] }
  getParameters = vi.fn(() => this.parameters)
  setParameters = vi.fn(async (parameters: { encodings: Array<{ maxBitrate?: number }> }) => { this.parameters = parameters })
  replaceTrack = vi.fn(async () => undefined)
}

class FakePeerConnection {
  static latest: FakePeerConnection | null = null
  connectionState: RTCPeerConnectionState = 'new'
  remoteDescription: RTCSessionDescriptionInit | null = null
  localDescription: RTCSessionDescriptionInit | null = null
  onicecandidate: ((event: RTCPeerConnectionIceEvent) => void) | null = null
  ontrack: ((event: RTCTrackEvent) => void) | null = null
  onconnectionstatechange: (() => void) | null = null
  sender = new FakeSender()
  addTrack = vi.fn(() => this.sender)
  addIceCandidate = vi.fn(async () => undefined)
  createAnswer = vi.fn(async () => ({ type: 'answer' as const, sdp: 'answer-sdp' }))
  setRemoteDescription = vi.fn(async (description: RTCSessionDescriptionInit) => { this.remoteDescription = description })
  setLocalDescription = vi.fn(async (description: RTCSessionDescriptionInit) => { this.localDescription = description })
  close = vi.fn(() => { this.connectionState = 'closed' })

  constructor() { FakePeerConnection.latest = this }
}

describe('BrowserVoiceSession', () => {
  let inputTrack: FakeTrack

  beforeEach(() => {
    inputTrack = new FakeTrack()
    vi.stubGlobal('MediaStream', FakeMediaStream)
    vi.stubGlobal('RTCPeerConnection', FakePeerConnection)
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn(async () => new FakeMediaStream([inputTrack])) },
    })
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined)
  })

  afterEach(() => {
    document.querySelectorAll('.voice-audio-output').forEach((element) => element.remove())
    FakePeerConnection.latest = null
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  async function startSession(input: BrowserVoiceInput) {
    const session = new BrowserVoiceSession({
      input,
      onAnswer: vi.fn(),
      onICECandidate: vi.fn(),
      onConnectionStateChange: vi.fn(),
      onError: vi.fn(),
    })
    await session.start(false, false, DEFAULT_VOICE_PREFERENCES)
    return session
  }

  it('composes the shared 200% volume with participant overrides without changing deafen or the received track', async () => {
    const mix = vi.spyOn(AudioPlaybackMixer.prototype, 'setVolume').mockImplementation((audio, stream, gain) => { audio.srcObject = stream; audio.volume = Math.min(1, gain) })
    const input = new BrowserVoiceInput(); await input.start(DEFAULT_VOICE_PREFERENCES)
    const session = await startSession(input)
    try {
      await session.applyPreferences({ ...DEFAULT_VOICE_PREFERENCES, outputVolume: 200 })
      await session.acceptOffer('v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=mid:0\r\na=msid:voice audio-peer\r\n')
      const track = new FakeTrack()
      FakePeerConnection.latest!.ontrack?.({ track, transceiver: { mid: '0' } } as unknown as RTCTrackEvent)
      const audio = document.querySelector<HTMLAudioElement>('.voice-audio-output')!
      expect(mix).toHaveBeenLastCalledWith(audio, expect.any(FakeMediaStream), 2)
      session.setRemoteGain('peer', 2)
      expect(mix).toHaveBeenLastCalledWith(audio, expect.any(FakeMediaStream), 4)
      session.setState(false, true)
      await session.applyPreferences({ ...DEFAULT_VOICE_PREFERENCES, outputVolume: 50 })
      expect(mix).toHaveBeenLastCalledWith(audio, expect.any(FakeMediaStream), 1)
      expect(audio.muted).toBe(true)
      expect(track.stop).not.toHaveBeenCalled()
    } finally { session.close(); input.close() }
  })

  it('answers offers, queues ICE and keeps the microphone alive across sessions', async () => {
    const input = new BrowserVoiceInput()
    await input.start(DEFAULT_VOICE_PREFERENCES)
    const onAnswer = vi.fn()

    const first = new BrowserVoiceSession({
      input,
      onAnswer,
      onICECandidate: vi.fn(),
      onConnectionStateChange: vi.fn(),
      onError: vi.fn(),
    })
    await first.start(false, false, DEFAULT_VOICE_PREFERENCES)
    expect(FakePeerConnection.latest?.addTrack).toHaveBeenCalledWith(inputTrack, expect.any(FakeMediaStream))
    expect(FakePeerConnection.latest?.sender.setParameters).toHaveBeenCalledWith({ encodings: [{ maxBitrate: 64_000 }] })

    // A second peer session reuses the same granted microphone without a new
    // getUserMedia call (signalling reconnect path).
    first.close()
    expect(inputTrack.stop).not.toHaveBeenCalled()

    const second = new BrowserVoiceSession({
      input,
      onAnswer,
      onICECandidate: vi.fn(),
      onConnectionStateChange: vi.fn(),
      onError: vi.fn(),
    })
    await second.start(true, false, DEFAULT_VOICE_PREFERENCES)
    const peer = FakePeerConnection.latest
    expect(peer?.addTrack).toHaveBeenCalledWith(inputTrack, expect.any(FakeMediaStream))
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledOnce()
    expect(inputTrack.enabled).toBe(false)

    const remoteCandidate = { candidate: 'remote-candidate', sdp_mid: '0', sdp_mline_index: 0 }
    await second.addICECandidate(remoteCandidate)
    expect(peer?.addIceCandidate).not.toHaveBeenCalled()
    await second.acceptOffer('offer-sdp')
    expect(peer?.setRemoteDescription).toHaveBeenCalledWith({ type: 'offer', sdp: 'offer-sdp' })
    expect(peer?.addIceCandidate).toHaveBeenCalledWith(expect.objectContaining({ candidate: 'remote-candidate', sdpMid: '0' }))
    expect(onAnswer).toHaveBeenCalledWith('answer-sdp')

    second.setState(false, true)
    expect(inputTrack.enabled).toBe(true)
    second.close()
    input.close()
    expect(inputTrack.stop).toHaveBeenCalledOnce()
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledOnce()
  })

  it('keeps the channel and remote audio alive when replacing the microphone fails', async () => {
    const input = new BrowserVoiceInput()
    await input.start(DEFAULT_VOICE_PREFERENCES)
    const fatal = vi.fn(), inputError = vi.fn()
    const session = new BrowserVoiceSession({ input, onAnswer: vi.fn(), onICECandidate: vi.fn(), onConnectionStateChange: vi.fn(), onError: fatal, onInputError: inputError })
    await session.start(false, false, DEFAULT_VOICE_PREFERENCES)
    const peer = FakePeerConnection.latest!
    peer.ontrack?.({ track: new FakeTrack() } as unknown as RTCTrackEvent)
    const output = document.querySelector<HTMLAudioElement>('.voice-audio-output')!, remote = output.srcObject
    peer.sender.replaceTrack.mockRejectedValueOnce(new DOMException('swap rejected', 'InvalidModificationError'))
    const next = new FakeTrack()
    vi.mocked(navigator.mediaDevices.getUserMedia).mockResolvedValue(new FakeMediaStream([next]) as unknown as MediaStream)
    try {
      await session.applyPreferences({ ...DEFAULT_VOICE_PREFERENCES, inputDeviceId: 'other' })
      await vi.waitFor(() => expect(inputError).toHaveBeenCalledOnce())
      expect(fatal).not.toHaveBeenCalled()
      expect(peer.close).not.toHaveBeenCalled()
      expect(output.srcObject).toBe(remote)
      expect(output.muted).toBe(false)
      await input.retry()
      await vi.waitFor(() => expect(peer.sender.replaceTrack).toHaveBeenCalledTimes(2))
      expect(peer.close).not.toHaveBeenCalled()
    } finally { session.close(); input.close() }
  })

  it('keeps remote playback and the peer unchanged across microphone toggles and acknowledgements', async () => {
    const input = new BrowserVoiceInput()
    await input.start(DEFAULT_VOICE_PREFERENCES)
    const session = await startSession(input)
    const peer = FakePeerConnection.latest!
    peer.ontrack?.({ track: new FakeTrack() } as unknown as RTCTrackEvent)
    const output = document.querySelector<HTMLAudioElement>('.voice-audio-output')!
    const remoteMedia = output.srcObject
    const play = vi.mocked(HTMLMediaElement.prototype.play)
    play.mockClear()

    try {
      for (const muted of [true, true, false, false, true, false]) {
        session.setState(muted, false)
        expect(inputTrack.enabled).toBe(!muted)
        expect(output.srcObject).toBe(remoteMedia)
        expect(output.muted).toBe(false)
      }
      expect(play).not.toHaveBeenCalled()
      expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledOnce()
      expect(peer.addTrack).toHaveBeenCalledOnce()
      expect(peer.sender.replaceTrack).not.toHaveBeenCalled()
      expect(peer.createAnswer).not.toHaveBeenCalled()
      expect(peer.close).not.toHaveBeenCalled()

      session.setState(false, true)
      expect(output.muted).toBe(true)
      session.setState(false, false)
      expect(output.muted).toBe(false)
      expect(play).toHaveBeenCalledOnce()
      session.setState(false, false)
      expect(play).toHaveBeenCalledOnce()
    } finally {
      session.close()
      input.close()
    }
  })

  it('meters a reused receiver with a browser track ID, refreshes its owner and clears silent speakers without AudioContext', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('AudioContext', undefined)
    const input = new BrowserVoiceInput()
    await input.start(DEFAULT_VOICE_PREFERENCES)
    const levels = vi.fn()
    const session = new BrowserVoiceSession({ input, onAnswer: vi.fn(), onICECandidate: vi.fn(), onConnectionStateChange: vi.fn(), onError: vi.fn(), onRemoteLevels: levels })
    await session.start(false, false, DEFAULT_VOICE_PREFERENCES)
    const peer = FakePeerConnection.latest!
    const track = new FakeTrack()
    const transceiver = { mid: null as string | null, receiver: { track } }
    let level = .1
    Object.assign(peer, {
      getTransceivers: () => [transceiver],
      getStats: vi.fn(async () => new Map([['audio', { type: 'inbound-rtp', kind: 'audio', trackIdentifier: track.id, audioLevel: level }]]) as unknown as RTCStatsReport),
    })
    peer.ontrack?.({ track, transceiver } as unknown as RTCTrackEvent)
    transceiver.mid = '0'
    const offer = (owner: string) => `v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=mid:0\r\na=msid:voice audio-${owner}\r\n`
    try {
      await session.acceptOffer(offer('alice'))
      session.setRemoteGain('alice', .3)
      await vi.advanceTimersByTimeAsync(200)
      expect(levels).toHaveBeenLastCalledWith([{ connectionId: 'alice', level: .45 }])
      const output = document.querySelector<HTMLAudioElement>('.voice-audio-output')!
      expect(output.volume).toBe(.3)
      await session.acceptOffer(offer('bob'))
      expect(output.volume).toBe(1)
      await vi.advanceTimersByTimeAsync(200)
      expect(levels).toHaveBeenLastCalledWith([{ connectionId: 'bob', level: .45 }])
      session.setState(false, true)
      await vi.advanceTimersByTimeAsync(200)
      expect(levels).toHaveBeenLastCalledWith([{ connectionId: 'bob', level: .45 }])
      expect(output.muted).toBe(true)
      session.setState(false, false)
      level = 0
      await vi.advanceTimersByTimeAsync(200)
      expect(levels).toHaveBeenLastCalledWith([{ connectionId: 'bob', level: 0 }])
      await session.acceptOffer('v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=mid:0\r\na=recvonly\r\n')
      await vi.advanceTimersByTimeAsync(200)
      expect(levels).toHaveBeenLastCalledWith([])
    } finally { session.close(); input.close(); vi.useRealTimers() }
  })

  it('protects the preallocated receiver before negotiation and keeps its key mapping when mid and owner change', async () => {
    const remoteTrack = new FakeTrack()
    const transceiver = { mid: null as string | null, receiver: { track: remoteTrack } }
    class EncryptedPeer extends FakePeerConnection {
      getTransceivers = () => [transceiver]
    }
    vi.stubGlobal('RTCPeerConnection', EncryptedPeer)
    const attachReceiver = vi.fn(), onReceiverOwners = vi.fn()
    const media = { peerConfiguration: (base: RTCConfiguration) => base, attachSender: vi.fn(), attachReceiver } as unknown as E2EEMediaTransform
    const input = new BrowserVoiceInput()
    await input.start(DEFAULT_VOICE_PREFERENCES)
    const session = new BrowserVoiceSession({ input, e2ee: { media, onReceiverOwners }, onAnswer: vi.fn(), onICECandidate: vi.fn(), onConnectionStateChange: vi.fn(), onError: vi.fn() })
    try {
      await session.start(false, false, DEFAULT_VOICE_PREFERENCES)
      const peer = FakePeerConnection.latest!
      expect(attachReceiver).toHaveBeenCalledWith(transceiver.receiver, 'audio', expect.any(String))
      expect(peer.setRemoteDescription).not.toHaveBeenCalled()
      const receiverId = attachReceiver.mock.calls[0]![2] as string
      peer.ontrack?.({ track: remoteTrack, transceiver } as unknown as RTCTrackEvent)
      transceiver.mid = '0'
      const offer = (owner: string) => `v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=mid:0\r\na=msid:voice audio-${owner}\r\n`
      await session.acceptOffer(offer('alice'))
      expect(onReceiverOwners).toHaveBeenLastCalledWith(new Map([[receiverId, 'alice']]))
      await session.acceptOffer(offer('bob'))
      expect(onReceiverOwners).toHaveBeenLastCalledWith(new Map([[receiverId, 'bob']]))
      expect(new Set(attachReceiver.mock.calls.map((call) => call[2]))).toEqual(new Set([receiverId]))
      await session.acceptOffer('v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=mid:0\r\na=recvonly\r\n')
      expect(onReceiverOwners).toHaveBeenLastCalledWith(new Map())
    } finally { session.close(); input.close() }
  })

  it('pauses remote level polling while hidden, resumes it, and removes the listener on close', async () => {
    vi.useFakeTimers()
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    const input = new BrowserVoiceInput(); await input.start(DEFAULT_VOICE_PREFERENCES)
    const levels = vi.fn()
    const session = new BrowserVoiceSession({ input, onAnswer: vi.fn(), onICECandidate: vi.fn(), onConnectionStateChange: vi.fn(), onError: vi.fn(), onRemoteLevels: levels })
    try {
      await session.start(false, false, DEFAULT_VOICE_PREFERENCES)
      const peer = FakePeerConnection.latest!
      Object.assign(peer, { getStats: vi.fn(async () => new Map() as unknown as RTCStatsReport) })
      peer.ontrack?.({ track: new FakeTrack() } as unknown as RTCTrackEvent)
      await vi.advanceTimersByTimeAsync(200); expect(levels).toHaveBeenCalled()
      levels.mockClear(); visibility.mockReturnValue('hidden'); document.dispatchEvent(new Event('visibilitychange'))
      await vi.advanceTimersByTimeAsync(600); expect(levels).not.toHaveBeenCalled()
      visibility.mockReturnValue('visible'); document.dispatchEvent(new Event('visibilitychange'))
      await vi.advanceTimersByTimeAsync(200); expect(levels).toHaveBeenCalled()
      session.close(); levels.mockClear(); document.dispatchEvent(new Event('visibilitychange'))
      await vi.advanceTimersByTimeAsync(600); expect(levels).not.toHaveBeenCalled()
    } finally { session.close(); input.close(); vi.useRealTimers() }
  })

  it('stops remote outputs exactly once and never touches the shared input', async () => {
    const input = new BrowserVoiceInput()
    await input.start(DEFAULT_VOICE_PREFERENCES)
    const session = await startSession(input)
    const peer = FakePeerConnection.latest!
    const firstRemoteTrack = new FakeTrack()
    const secondRemoteTrack = new FakeTrack()
    peer.ontrack?.({ track: firstRemoteTrack } as unknown as RTCTrackEvent)
    peer.ontrack?.({ track: secondRemoteTrack } as unknown as RTCTrackEvent)

    session.close()
    expect(firstRemoteTrack.stop).toHaveBeenCalledOnce()
    expect(secondRemoteTrack.stop).toHaveBeenCalledOnce()
    expect(peer.close).toHaveBeenCalledOnce()
    expect(document.querySelector('.voice-audio-output')).toBeNull()
    expect(inputTrack.stop).not.toHaveBeenCalled()
    input.close()
    expect(inputTrack.stop).toHaveBeenCalledOnce()
  })

  it('uses the reserved camera sender, attributes remote video and releases only the camera on stop', async () => {
    const input = new BrowserVoiceInput()
    await input.start(DEFAULT_VOICE_PREFERENCES)
    const cameraTrack = new FakeTrack('video')
    vi.mocked(navigator.mediaDevices.getUserMedia).mockResolvedValue(new FakeMediaStream([cameraTrack]) as unknown as MediaStream)
    const onCamera = vi.fn(), onRemoteCamera = vi.fn()
    const session = new BrowserVoiceSession({ input, onCamera, onRemoteCamera, onAnswer: vi.fn(), onICECandidate: vi.fn(), onConnectionStateChange: vi.fn(), onError: vi.fn() })
    await session.start(false, false, DEFAULT_VOICE_PREFERENCES)
    const peer = FakePeerConnection.latest!
    const sender = new FakeSender()
    const upload = { mid: 'upload', sender, receiver: { track: new FakeTrack('video') }, direction: 'recvonly' }
    const remoteTrack = new FakeTrack('video')
    const remote = { mid: 'remote', sender: new FakeSender(), receiver: { track: remoteTrack } }
    Object.assign(peer, { getTransceivers: () => [upload, remote] })
    await session.acceptOffer('v=0\nm=video 9 UDP/TLS/RTP/SAVPF 96\na=mid:upload\na=recvonly\nm=video 9 UDP/TLS/RTP/SAVPF 96\na=mid:remote\na=sendonly\na=msid:camera-room camera-alice\n')
    expect(upload.direction).toBe('sendrecv')
    await session.startCamera('low')
    expect(sender.replaceTrack).toHaveBeenCalledWith(cameraTrack)
    expect(peer.sender.replaceTrack).not.toHaveBeenCalled()
    peer.ontrack?.({ track: remoteTrack, transceiver: remote } as unknown as RTCTrackEvent)
    expect(onRemoteCamera).toHaveBeenCalledWith('alice', expect.any(FakeMediaStream))
    session.stopCamera()
    expect(sender.replaceTrack).toHaveBeenLastCalledWith(null)
    expect(cameraTrack.stop).toHaveBeenCalledOnce()
    expect(inputTrack.stop).not.toHaveBeenCalled()
    session.close()
    expect(onRemoteCamera).toHaveBeenLastCalledWith('alice', null)
    input.close()
  })
})

describe('voiceCloseMessage', () => {
  it('explains that another tab took over the voice connection', () => {
    expect(voiceCloseMessage('voice session moved to another connection'))
      .toBe('Голосовое подключение перенесено в другую вкладку или устройство')
  })

  it('explains when the server rejects excessive microphone bitrate', () => {
    expect(voiceCloseMessage('audio bitrate limit exceeded'))
      .toBe('Голосовое подключение остановлено: превышен разрешённый сервером битрейт микрофона')
  })
})

it('explains permanent channel access revocation', () => {
  expect(voiceCloseMessage('channel access was revoked')).toBe('Доступ к голосовому каналу был отозван')
})
