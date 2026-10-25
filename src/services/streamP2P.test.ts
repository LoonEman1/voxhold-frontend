// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BrowserP2PStreamPublisher } from './stream'
import { DEFAULT_STREAM_PREFERENCES } from './streamSettings'

class FakeTrack extends EventTarget {
  readonly id = crypto.randomUUID()
  constructor(readonly kind: 'audio' | 'video') { super() }
}

class FakeMediaStream {
  constructor(private readonly tracks: FakeTrack[] = []) {}
  getTracks() { return [...this.tracks] }
  addTrack(track: FakeTrack) { this.tracks.push(track) }
  removeTrack(track: FakeTrack) { this.tracks.splice(this.tracks.indexOf(track), 1) }
}

class FakePeerConnection {
  static latest: FakePeerConnection | null = null
  connectionState: RTCPeerConnectionState = 'new'
  iceConnectionState: RTCIceConnectionState = 'new'
  signalingState: RTCSignalingState = 'stable'
  localDescription: RTCSessionDescriptionInit | null = null
  remoteDescription: RTCSessionDescriptionInit | null = null
  private offers = 0

  restartIce = vi.fn()
  createOffer = vi.fn(async (_options?: RTCOfferOptions) => {
    this.offers += 1
    return { type: 'offer' as const, sdp: `offer-${this.offers}` }
  })
  setLocalDescription = vi.fn(async (description: RTCSessionDescriptionInit) => {
    if (description.type === 'rollback') {
      this.signalingState = 'stable'
      this.localDescription = null
      return
    }
    this.signalingState = 'have-local-offer'
    this.localDescription = description
  })

  constructor() {
    FakePeerConnection.latest = this
  }

  addTransceiver(track: FakeTrack) {
    return { sender: { track } }
  }
  getSenders() { return [] }
  close() { this.connectionState = 'closed' }
}

afterEach(() => {
  vi.unstubAllGlobals()
  FakePeerConnection.latest = null
})

describe('BrowserP2PStreamPublisher', () => {
  it('rolls back an unanswered offer before an ICE restart', async () => {
    vi.stubGlobal('RTCPeerConnection', FakePeerConnection)
    vi.stubGlobal('MediaStream', FakeMediaStream)
    const offers: string[] = []
    const publisher = new BrowserP2PStreamPublisher({
      localStream: new FakeMediaStream([new FakeTrack('video')]) as unknown as MediaStream,
      preferences: DEFAULT_STREAM_PREFERENCES,
      codec: 'vp8',
      onOffer: (_target, sdp) => offers.push(sdp),
      onICECandidate: () => undefined,
      onConnectionStateChange: () => undefined,
      onError: () => undefined,
    })

    await publisher.addViewer('viewer-1')
    const peer = FakePeerConnection.latest
    expect(offers).toEqual(['offer-1'])
    expect(peer?.signalingState).toBe('have-local-offer')

    // The answer to offer-1 never arrives; the viewer asks for a restart.
    publisher.restartViewer('viewer-1')
    await vi.waitFor(() => expect(offers).toEqual(['offer-1', 'offer-2']))

    expect(peer?.setLocalDescription).toHaveBeenCalledWith({ type: 'rollback' })
    expect(peer?.restartIce).toHaveBeenCalledOnce()
    expect(peer?.createOffer).toHaveBeenLastCalledWith({ iceRestart: true })
    publisher.close()
  })
})
