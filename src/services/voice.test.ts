// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BrowserVoiceSession, voiceCloseMessage } from './voice'
import { BrowserVoiceInput } from './voiceInput'
import { DEFAULT_VOICE_PREFERENCES } from './voiceSettings'

class FakeTrack extends EventTarget {
  readonly id = crypto.randomUUID()
  readonly kind = 'audio'
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
  getAudioTracks() { return [...this.tracks] }
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
      level = 0
      await vi.advanceTimersByTimeAsync(200)
      expect(levels).toHaveBeenLastCalledWith([{ connectionId: 'bob', level: 0 }])
      await session.acceptOffer('v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=mid:0\r\na=recvonly\r\n')
      await vi.advanceTimersByTimeAsync(200)
      expect(levels).toHaveBeenLastCalledWith([])
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
