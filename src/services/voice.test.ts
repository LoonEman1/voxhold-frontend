// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BrowserVoiceSession, voiceCloseMessage } from './voice'
import { DEFAULT_VOICE_PREFERENCES } from './voiceSettings'

class FakeTrack extends EventTarget {
  readonly id = crypto.randomUUID()
  enabled = true
  stop = vi.fn()
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

  it('answers offers, queues ICE and releases microphone resources', async () => {
    const onAnswer = vi.fn()
    const onICECandidate = vi.fn()
    const session = new BrowserVoiceSession({
      onAnswer,
      onICECandidate,
      onConnectionStateChange: vi.fn(),
      onError: vi.fn(),
    })

    await session.start(false, false, DEFAULT_VOICE_PREFERENCES)
    const peer = FakePeerConnection.latest
    expect(peer?.addTrack).toHaveBeenCalledWith(inputTrack, expect.any(FakeMediaStream))
    expect(peer?.sender.setParameters).toHaveBeenCalledWith({ encodings: [{ maxBitrate: 64_000 }] })
    expect(document.querySelector('.voice-audio-output')).not.toBeNull()

    await session.applyPreferences({ ...DEFAULT_VOICE_PREFERENCES, bitrateKbps: 128 })
    expect(peer?.sender.setParameters).toHaveBeenLastCalledWith({ encodings: [{ maxBitrate: 128_000 }] })

    const remoteCandidate = { candidate: 'remote-candidate', sdp_mid: '0', sdp_mline_index: 0 }
    await session.addICECandidate(remoteCandidate)
    expect(peer?.addIceCandidate).not.toHaveBeenCalled()
    await session.acceptOffer('offer-sdp')
    expect(peer?.setRemoteDescription).toHaveBeenCalledWith({ type: 'offer', sdp: 'offer-sdp' })
    expect(peer?.addIceCandidate).toHaveBeenCalledWith(expect.objectContaining({ candidate: 'remote-candidate', sdpMid: '0' }))
    expect(onAnswer).toHaveBeenCalledWith('answer-sdp')

    peer?.onicecandidate?.({ candidate: { toJSON: () => ({ candidate: 'local-candidate', sdpMid: '0', sdpMLineIndex: 0 }) } } as RTCPeerConnectionIceEvent)
    expect(onICECandidate).toHaveBeenCalledWith(expect.objectContaining({ candidate: 'local-candidate', sdp_mid: '0' }))

    session.setState(true, true)
    expect(inputTrack.enabled).toBe(false)
    session.close()
    expect(inputTrack.stop).toHaveBeenCalledOnce()
    expect(peer?.close).toHaveBeenCalledOnce()
    expect(document.querySelector('.voice-audio-output')).toBeNull()
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
