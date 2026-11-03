import { BrowserP2PStreamPublisher, BrowserP2PStreamViewer, BrowserServerStreamSession } from '../../src/services/stream'
import { createSDRPublishPipeline, type StreamPublishPipeline } from '../../src/services/hdrPipeline'
import { applyLiveStreamSettings } from '../../src/services/liveStreamSettings'
import { DEFAULT_STREAM_PREFERENCES, type StreamPreferences } from '../../src/services/streamSettings'
import type { StreamICECandidate } from '../../src/domain/types'
import { wireICECandidate } from '../../src/services/webrtcCandidate'

let capture: MediaStream, pipeline: StreamPublishPipeline
let publisher: BrowserServerStreamSession | BrowserP2PStreamPublisher
let native: RTCPeerConnection | null = null
let preferences: StreamPreferences = { ...DEFAULT_STREAM_PREFERENCES, codec: 'vp8' }
let closed = false, ended = 0
const errors: string[] = [], viewers = new Map<string, BrowserP2PStreamViewer>()
const peers = new WeakMap<RTCPeerConnection, number>()
let nextPeer = 0
const presented = new Map<string, number>()
const onError = (error: Error) => errors.push(error.message)
const nativeCandidate = (value: StreamICECandidate): RTCIceCandidateInit => ({ candidate: value.candidate, sdpMid: value.sdp_mid, sdpMLineIndex: value.sdp_mline_index, usernameFragment: value.username_fragment })
function attach(id: string, media: MediaStream) {
  const video = document.getElementById(id) as HTMLVideoElement
  if (!presented.has(id)) {
    presented.set(id, 0)
    const frame = () => { if (closed) return; presented.set(id, (presented.get(id) ?? 0) + 1); video.requestVideoFrameCallback(frame) }
    if (typeof video.requestVideoFrameCallback === 'function') video.requestVideoFrameCallback(frame)
  }
  if (video.srcObject !== media) video.srcObject = media
  void video.play().catch(onError)
}
async function addViewer(id = 'late') {
  const viewer = new BrowserP2PStreamViewer({ onRemoteStream: (media) => attach(id, media), onConnectionStateChange: () => {}, onError,
    onAnswer: (_target, sdp) => { void (publisher as BrowserP2PStreamPublisher).acceptAnswer(id, sdp) },
    onICECandidate: (_target, candidate) => { void (publisher as BrowserP2PStreamPublisher).addICECandidate(id, candidate) },
    onRestartRequest: () => {},
  })
  viewers.set(id, viewer)
  await (publisher as BrowserP2PStreamPublisher).addViewer(id)
}
const fixture = {
  async start(mode: 'server' | 'p2p') {
    preferences = { ...preferences, mode }
    capture = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } }, audio: true })
    pipeline = await createSDRPublishPipeline(capture, 'vp8', onError)
    for (const track of [...capture.getTracks(), ...pipeline.stream.getVideoTracks()]) track.addEventListener('ended', () => ended++)
    if (mode === 'server') {
      const remote = new MediaStream(), pending: StreamICECandidate[] = []
      native = new RTCPeerConnection()
      native.addTransceiver('video', { direction: 'recvonly' }); native.addTransceiver('audio', { direction: 'recvonly' })
      native.ontrack = ({ track }) => { remote.addTrack(track); attach('viewer', remote) }
      native.onicecandidate = ({ candidate }) => { const value = candidate && wireICECandidate(candidate); if (value) void (publisher as BrowserServerStreamSession).addICECandidate(value) }
      publisher = new BrowserServerStreamSession({ localStream: pipeline.stream, preferences, codec: 'vp8', onConnectionStateChange: () => {}, onError,
        onAnswer: (sdp) => { void native!.setRemoteDescription({ type: 'answer', sdp }).then(async () => { for (const candidate of pending.splice(0)) await native!.addIceCandidate(nativeCandidate(candidate)) }).catch(onError) },
        onICECandidate: (candidate) => { if (native!.remoteDescription) void native!.addIceCandidate(nativeCandidate(candidate)).catch(onError); else pending.push(candidate) },
      })
      await native.setLocalDescription(await native.createOffer())
      await publisher.acceptOffer(native.localDescription!.sdp)
    } else {
      publisher = new BrowserP2PStreamPublisher({ localStream: pipeline.stream, preferences, codec: 'vp8', onConnectionStateChange: () => {}, onError,
        onOffer: (id, sdp) => { void viewers.get(id)!.acceptOffer('publisher', sdp) },
        onICECandidate: (id, candidate) => { void viewers.get(id)!.addICECandidate('publisher', candidate) },
      })
      await addViewer('viewer')
    }
  },
  async apply(value: Partial<StreamPreferences>) {
    preferences = await applyLiveStreamSettings({ capture, pipeline, isCurrent: () => !closed, updateSenders: (next, sourceSettings) => publisher.updatePreferences(next, sourceSettings) }, preferences, { ...preferences, ...value })
  },
  addViewer,
  snapshot() {
    // Fixture-only instrumentation; the application exposes no debug API.
    const value = publisher as unknown as { peer?: RTCPeerConnection; peers?: Map<string, { peer: RTCPeerConnection }> }
    const connections = value.peer ? [value.peer] : [...value.peers!.values()].map((state) => state.peer)
    return { errors: [...errors], ended, captureId: capture.id, captureTrackId: capture.getVideoTracks()[0]!.id, outputTrackId: pipeline.stream.getVideoTracks()[0]!.id, source: capture.getVideoTracks()[0]!.getSettings(),
      peers: connections.map((peer) => { if (!peers.has(peer)) peers.set(peer, ++nextPeer); return { id: peers.get(peer), state: peer.connectionState, senders: peer.getSenders().filter((sender) => sender.track).map((sender) => ({ kind: sender.track!.kind, trackId: sender.track!.id, encodings: sender.getParameters().encodings })) } }),
      videos: ['viewer', 'late'].map((id) => { const video = document.getElementById(id) as HTMLVideoElement; return { id, width: video.videoWidth, height: video.videoHeight, frames: Math.max(presented.get(id) ?? 0, video.getVideoPlaybackQuality().totalVideoFrames), paused: video.paused, readyState: video.readyState } }),
    }
  },
  close() { closed = true; publisher?.close(); native?.close(); viewers.forEach((viewer) => viewer.close()); pipeline?.close(); capture?.getTracks().forEach((track) => track.stop()) },
}
Object.assign(window, { liveStreamFixture: fixture })
export type LiveStreamFixture = typeof fixture
