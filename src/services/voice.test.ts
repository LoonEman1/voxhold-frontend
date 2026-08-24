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
