// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BrowserServerStreamSession } from './stream'
import { DEFAULT_STREAM_PREFERENCES } from './streamSettings'

class FakeTrack extends EventTarget {
  constructor(
    readonly id: string,
    readonly kind: 'audio' | 'video',
  ) {
    super()
  }
}

class FakeMediaStream {
  private tracks: FakeTrack[]

  constructor(tracks: FakeTrack[] = []) {
    this.tracks = [...tracks]
  }

  getTracks() { return [...this.tracks] }
  getVideoTracks() { return this.tracks.filter((track) => track.kind === 'video') }
  getAudioTracks() { return this.tracks.filter((track) => track.kind === 'audio') }
  addTrack(track: FakeTrack) { this.tracks.push(track) }
  removeTrack(track: FakeTrack) { this.tracks = this.tracks.filter((item) => item !== track) }
}

class FakePeerConnection {
  static latest: FakePeerConnection | null = null
  connectionState: RTCPeerConnectionState = 'new'
  ontrack: ((event: RTCTrackEvent) => void) | null = null
  onicecandidate: ((event: RTCPeerConnectionIceEvent) => void) | null = null
  onconnectionstatechange: (() => void) | null = null
  remoteDescription: RTCSessionDescription | null = null
  localDescription: RTCSessionDescription | null = null
  transceivers: Array<{
    receiver: { track: FakeTrack }
    sender: { track: FakeTrack | null; replaceTrack: ReturnType<typeof vi.fn>; getParameters: () => RTCRtpSendParameters }
    direction: RTCRtpTransceiverDirection
    setCodecPreferences: ReturnType<typeof vi.fn>
  }> = []
  close = vi.fn(() => { this.connectionState = 'closed' })

  constructor() { FakePeerConnection.latest = this }
  setRemoteDescription = vi.fn(async (description: RTCSessionDescriptionInit) => {
    this.remoteDescription = description as RTCSessionDescription
  })
  getTransceivers() { return this.transceivers }
  getSenders() { return this.transceivers.map((item) => item.sender) }
  addTransceiver = vi.fn()
  createAnswer = vi.fn(async () => ({ type: 'answer' as const, sdp: 'answer-sdp' }))
  setLocalDescription = vi.fn(async (description: RTCSessionDescriptionInit) => {
    this.localDescription = description as RTCSessionDescription
  })
}

function fakeTransceiver(kind: 'audio' | 'video') {
  const sender = {
    track: null as FakeTrack | null,
    replaceTrack: vi.fn(async (track: FakeTrack) => { sender.track = track }),
    getParameters: () => ({ encodings: [] }) as unknown as RTCRtpSendParameters,
  }
  return {
    receiver: { track: new FakeTrack(`receiver-${kind}`, kind) },
    sender,
    direction: 'recvonly' as RTCRtpTransceiverDirection,
    setCodecPreferences: vi.fn(),
  }
}

describe('stream remote media', () => {
  beforeEach(() => {
    vi.stubGlobal('MediaStream', FakeMediaStream)
    vi.stubGlobal('RTCPeerConnection', FakePeerConnection)
    vi.stubGlobal('RTCRtpReceiver', {
      getCapabilities: () => ({ codecs: [
        { mimeType: 'video/H264', clockRate: 90_000, sdpFmtpLine: 'packetization-mode=1;profile-level-id=42e01f' },
        { mimeType: 'video/VP9', clockRate: 90_000, sdpFmtpLine: 'profile-id=0' },
        { mimeType: 'video/VP9', clockRate: 90_000, sdpFmtpLine: 'profile-id=2' },
      ] }),
    })
  })

  afterEach(() => {
    FakePeerConnection.latest = null
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('keeps video and renegotiated audio in one stable stream', () => {
    const onRemoteStream = vi.fn()
    const session = new BrowserServerStreamSession({
      preferences: DEFAULT_STREAM_PREFERENCES,
      codec: 'vp8',
      onRemoteStream,
      onConnectionStateChange: vi.fn(),
      onError: vi.fn(),
      onAnswer: vi.fn(),
      onICECandidate: vi.fn(),
    })
    const peer = FakePeerConnection.latest
    const video = new FakeTrack('screen-video', 'video')
    const audio = new FakeTrack('screen-audio', 'audio')

    peer?.ontrack?.({
      track: video,
      streams: [new FakeMediaStream([video])],
    } as unknown as RTCTrackEvent)
    peer?.ontrack?.({
      track: audio,
      streams: [new FakeMediaStream([audio])],
    } as unknown as RTCTrackEvent)

    const first = onRemoteStream.mock.calls[0]?.[0] as unknown as FakeMediaStream
    const second = onRemoteStream.mock.calls[1]?.[0] as unknown as FakeMediaStream
    expect(second).toBe(first)
    expect(second.getTracks()).toEqual([video, audio])

    session.close()
    expect(peer?.close).toHaveBeenCalledOnce()
  })

  it('maps SDR and HDR tracks to separate video m-lines with exact profiles', async () => {
    const sdr = new FakeTrack('sdr-video', 'video')
    const hdr = new FakeTrack('hdr-video', 'video')
    const stream = new FakeMediaStream([sdr, hdr])
    const onAnswer = vi.fn()
    const session = new BrowserServerStreamSession({
      localStream: stream as unknown as MediaStream,
      renditions: [
        { id: 'sdr', codec: 'h264', profile: 'baseline', dynamic_range: 'sdr', bit_depth: 8, color_primaries: 'bt709', transfer: 'bt709', matrix: 'bt709' },
        { id: 'hdr', codec: 'vp9', profile: '2', dynamic_range: 'hdr10', bit_depth: 10, color_primaries: 'bt2020', transfer: 'pq', matrix: 'bt2020-ncl' },
      ],
      preferences: DEFAULT_STREAM_PREFERENCES,
      codec: 'h264',
      onConnectionStateChange: vi.fn(),
      onError: vi.fn(),
      onAnswer,
      onICECandidate: vi.fn(),
    })
    const peer = FakePeerConnection.latest
    const sdrLine = fakeTransceiver('video')
    const hdrLine = fakeTransceiver('video')
    peer?.transceivers.push(sdrLine, hdrLine)

    await session.acceptOffer('v=0')

    expect(sdrLine.sender.track).toBe(sdr)
    expect(hdrLine.sender.track).toBe(hdr)
    expect(sdrLine.setCodecPreferences.mock.calls[0]?.[0]?.[0]?.mimeType).toBe('video/H264')
    expect(hdrLine.setCodecPreferences.mock.calls[0]?.[0]?.[0]?.sdpFmtpLine).toContain('profile-id=2')
    expect(onAnswer).toHaveBeenCalledWith('answer-sdp')
    session.close()
  })
})
