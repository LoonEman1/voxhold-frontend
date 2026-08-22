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
  addTrack(track: FakeTrack) { this.tracks.push(track) }
  removeTrack(track: FakeTrack) { this.tracks = this.tracks.filter((item) => item !== track) }
}

class FakePeerConnection {
  static latest: FakePeerConnection | null = null
  connectionState: RTCPeerConnectionState = 'new'
  ontrack: ((event: RTCTrackEvent) => void) | null = null
  onicecandidate: ((event: RTCPeerConnectionIceEvent) => void) | null = null
  onconnectionstatechange: (() => void) | null = null
  close = vi.fn(() => { this.connectionState = 'closed' })

  constructor() { FakePeerConnection.latest = this }
}

describe('stream remote media', () => {
  beforeEach(() => {
    vi.stubGlobal('MediaStream', FakeMediaStream)
    vi.stubGlobal('RTCPeerConnection', FakePeerConnection)
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
})
