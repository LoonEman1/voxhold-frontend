import type { StreamCodec, StreamICECandidate } from '../domain/types'
import { normalizeStreamPreferences, selectedStreamResolution, type StreamPreferences } from './streamSettings'
import { WebRTCRecoveryController, remoteDescriptionAcceptsCandidate } from './webrtcRecovery'
import { wireICECandidate } from './webrtcCandidate'

export type StreamConnectionState = RTCPeerConnectionState

export interface StreamQualityStats {
  codec: string
  bitrateKbps: number
  framesPerSecond: number
  width: number
  height: number
  packetsLost: number
  qualityLimitationReason: 'none' | 'cpu' | 'bandwidth' | 'other' | ''
}

interface MediaCallbacks {
  onRemoteStream?: (stream: MediaStream) => void
  onQualityStats?: (stats: StreamQualityStats) => void
  onConnectionStateChange: (state: StreamConnectionState) => void
  onError: (error: Error) => void
}

function browserICEConfiguration(): RTCConfiguration {
  const urls = (import.meta.env.VITE_WEBRTC_ICE_SERVERS as string | undefined)
    ?.split(',')
    .map((url) => url.trim())
    .filter(Boolean)
  if (!urls?.length) return {}
  const username = (import.meta.env.VITE_WEBRTC_ICE_USERNAME as string | undefined)?.trim()
  const credential = (import.meta.env.VITE_WEBRTC_ICE_CREDENTIAL as string | undefined)?.trim()
  return { iceServers: [{ urls, ...(username && credential ? { username, credential } : {}) }] }
}

function browserCandidate(candidate: StreamICECandidate): RTCIceCandidateInit {
  return {
    candidate: candidate.candidate,
    sdpMid: candidate.sdp_mid ?? null,
    sdpMLineIndex: candidate.sdp_mline_index ?? null,
    usernameFragment: candidate.username_fragment ?? null,
  }
}

const STREAM_CODEC_MIME: Record<StreamCodec, string> = {
  vp8: 'video/vp8',
  vp9: 'video/vp9',
  h264: 'video/h264',
  av1: 'video/av1',
}

function codecCapabilities(
  capabilities: RTCRtpCapabilities | null | undefined,
  codec: StreamCodec,
) {
  return (capabilities?.codecs ?? []).filter((candidate) => {
    if (candidate.mimeType.toLowerCase() !== STREAM_CODEC_MIME[codec]) return false
    const format = candidate.sdpFmtpLine?.toLowerCase() ?? ''
    if (codec === 'vp9') return format === '' || /(?:^|;)profile-id=0(?:;|$)/.test(format)
    if (codec === 'h264') {
      return /(?:^|;)packetization-mode=1(?:;|$)/.test(format)
        && /(?:^|;)profile-level-id=42001f(?:;|$)/.test(format)
    }
    return true
  })
}

export function supportedStreamCodecs(): StreamCodec[] {
  const sender = typeof RTCRtpSender !== 'undefined' && typeof RTCRtpSender.getCapabilities === 'function'
    ? RTCRtpSender.getCapabilities('video')
    : null
  const receiver = typeof RTCRtpReceiver !== 'undefined' && typeof RTCRtpReceiver.getCapabilities === 'function'
    ? RTCRtpReceiver.getCapabilities('video')
    : null
  return (['vp9', 'h264', 'av1', 'vp8'] as const)
    .filter((codec) => codecCapabilities(sender, codec).length > 0 && codecCapabilities(receiver, codec).length > 0)
}

export function selectedStreamCodec(preferences: StreamPreferences): StreamCodec {
  const supported = supportedStreamCodecs()
  if (preferences.codec !== 'auto') {
    if (!supported.includes(preferences.codec)) throw new Error(`Кодек ${preferences.codec.toUpperCase()} не поддерживается этим браузером`)
    return preferences.codec
  }
  const automatic = (['vp9', 'h264', 'av1', 'vp8'] as const).find((codec) => supported.includes(codec))
  if (!automatic) throw new Error('Браузер не поддерживает видеокодеки трансляции')
  return automatic
}

function preferCodec(transceiver: RTCRtpTransceiver, codec: StreamCodec) {
  if (!transceiver.setCodecPreferences || typeof RTCRtpReceiver.getCapabilities !== 'function') {
    throw new Error('Браузер не позволяет выбрать видеокодек трансляции')
  }
  const selected = codecCapabilities(RTCRtpReceiver.getCapabilities('video'), codec)
  if (!selected.length) throw new Error(`Кодек ${codec.toUpperCase()} недоступен для WebRTC`)
  transceiver.setCodecPreferences(selected)
}

async function applySenderLimits(sender: RTCRtpSender, preferences: StreamPreferences) {
  const track = sender.track
  if (!track) return
  const parameters = sender.getParameters()
  if (!parameters.encodings.length) return
  const encoding = parameters.encodings[0]
  if (!encoding) return
  if (track.kind === 'video') {
    encoding.maxBitrate = preferences.videoBitrateKbps * 1000
    encoding.maxFramerate = preferences.frameRate
    // Screen sharing benefits more from readable text and stable detail than
    // from preserving every frame when bandwidth briefly becomes constrained.
    parameters.degradationPreference = 'maintain-resolution'
  } else if (track.kind === 'audio') {
    encoding.maxBitrate = preferences.audioBitrateKbps * 1000
  }
  await sender.setParameters(parameters)
}

interface VideoRTPStats extends RTCStats {
  isRemote?: boolean
  kind?: string
  mediaType?: string
  bytesSent?: number
  bytesReceived?: number
  framesPerSecond?: number
  frameWidth?: number
  frameHeight?: number
  packetsLost?: number
  codecId?: string
  qualityLimitationReason?: string
}

interface CodecStats extends RTCStats {
  mimeType?: string
}

function monitorVideoQuality(
  peer: RTCPeerConnection,
  direction: 'outbound-rtp' | 'inbound-rtp',
  callback: ((stats: StreamQualityStats) => void) | undefined,
) {
  if (!callback) return () => undefined

  let previousBytes: number | null = null
  let previousTimestamp: number | null = null
  let sampling = false

  const sample = async () => {
    if (sampling || peer.connectionState === 'closed') return
    sampling = true
    try {
      const report = await peer.getStats()
      let video: VideoRTPStats | undefined
      report.forEach((value) => {
        const candidate = value as VideoRTPStats
        if (
          candidate.type === direction
          && (candidate.kind === 'video' || candidate.mediaType === 'video')
          && !candidate.isRemote
        ) video = candidate
      })
      if (!video) return

      const bytes = direction === 'outbound-rtp' ? video.bytesSent : video.bytesReceived
      let bitrateKbps = 0
      if (
        typeof bytes === 'number'
        && previousBytes !== null
        && previousTimestamp !== null
        && video.timestamp > previousTimestamp
      ) {
        bitrateKbps = Math.max(0, Math.round(
          ((bytes - previousBytes) * 8) / (video.timestamp - previousTimestamp),
        ))
      }
      if (typeof bytes === 'number') {
        previousBytes = bytes
        previousTimestamp = video.timestamp
      }

      const codecReport = video.codecId
        ? report.get(video.codecId) as CodecStats | undefined
        : undefined
      const rawReason = video.qualityLimitationReason ?? ''
      const qualityLimitationReason = (
        rawReason === 'none'
        || rawReason === 'cpu'
        || rawReason === 'bandwidth'
        || rawReason === 'other'
      ) ? rawReason : ''

      callback({
        codec: codecReport?.mimeType?.replace(/^video\//i, '').toUpperCase() ?? '',
        bitrateKbps,
        framesPerSecond: Math.round(video.framesPerSecond ?? 0),
        width: video.frameWidth ?? 0,
        height: video.frameHeight ?? 0,
        packetsLost: Math.max(0, video.packetsLost ?? 0),
        qualityLimitationReason,
      })
    } catch {
      // getStats is diagnostic only and must never interrupt the stream.
    } finally {
      sampling = false
    }
  }

  void sample()
  const timer = window.setInterval(() => void sample(), 2000)
  return () => window.clearInterval(timer)
}

async function applyAllSenderLimits(peer: RTCPeerConnection, preferences: StreamPreferences) {
  await Promise.all(peer.getSenders().map((sender) => applySenderLimits(sender, preferences).catch(() => undefined)))
}

function wirePeer(
  peer: RTCPeerConnection,
  callbacks: MediaCallbacks,
  onConnectionState?: (state: StreamConnectionState) => void,
) {
  const remote = new MediaStream()
  peer.ontrack = (event) => {
    if (!remote.getTracks().some((track) => track.id === event.track.id)) {
      remote.addTrack(event.track)
      event.track.addEventListener('ended', () => remote.removeTrack(event.track), { once: true })
    }
    // Always expose one stable aggregate. Browsers may return a different
    // event.streams[0] object for a track added during renegotiation; forwarding
    // only the newest object can drop audio or video that was attached earlier.
    callbacks.onRemoteStream?.(remote)
  }
  peer.onconnectionstatechange = () => {
    callbacks.onConnectionStateChange(peer.connectionState)
    onConnectionState?.(peer.connectionState)
  }
}

export async function captureScreen(value: StreamPreferences): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getDisplayMedia) throw new Error('Браузер не поддерживает трансляцию экрана')
  const preferences = normalizeStreamPreferences(value)
  const resolution = selectedStreamResolution(preferences)
  const media = await navigator.mediaDevices.getDisplayMedia({
    video: {
      width: { ideal: resolution.width, max: resolution.width },
      height: { ideal: resolution.height, max: resolution.height },
      frameRate: { ideal: preferences.frameRate, max: preferences.frameRate },
    },
    audio: preferences.includeAudio,
  })
  const video = media.getVideoTracks()[0]
  if (!video) {
    media.getTracks().forEach((track) => track.stop())
    throw new Error('Источник экрана не предоставил видеодорожку')
  }
  video.contentHint = 'detail'
  return media
}

interface ServerSessionOptions extends MediaCallbacks {
  localStream?: MediaStream
  preferences: StreamPreferences
  codec: StreamCodec
  onAnswer: (sdp: string) => void
  onICECandidate: (candidate: StreamICECandidate) => void
}

export class BrowserServerStreamSession {
  private readonly peer = new RTCPeerConnection(browserICEConfiguration())
  private readonly pendingCandidates: StreamICECandidate[] = []
  private offerQueue = Promise.resolve()
  private tracksAdded = false
  private closed = false
  private readonly stopQualityMonitor: () => void

  constructor(private readonly options: ServerSessionOptions) {
    wirePeer(this.peer, options)
    this.stopQualityMonitor = monitorVideoQuality(
      this.peer,
      options.localStream ? 'outbound-rtp' : 'inbound-rtp',
      options.onQualityStats,
    )
    this.peer.onicecandidate = (event) => {
      if (!event.candidate) return
      const candidate = wireICECandidate(event.candidate)
      if (candidate) options.onICECandidate(candidate)
    }
  }

  acceptOffer(sdp: string) {
    const operation = this.offerQueue.then(async () => {
      if (this.closed) return
      await this.peer.setRemoteDescription({ type: 'offer', sdp })
      const pending = this.pendingCandidates.splice(0)
      for (const candidate of pending) {
        if (remoteDescriptionAcceptsCandidate(this.peer, candidate)) {
          await this.peer.addIceCandidate(browserCandidate(candidate))
        }
      }
      if (this.options.localStream && !this.tracksAdded) {
        for (const track of this.options.localStream.getTracks()) {
          const transceiver = this.peer.getTransceivers().find((item) => item.receiver.track.kind === track.kind && !item.sender.track)
          if (transceiver) {
            transceiver.direction = 'sendonly'
            await transceiver.sender.replaceTrack(track)
            if (track.kind === 'video') preferCodec(transceiver, this.options.codec)
          } else {
            const added = this.peer.addTransceiver(track, { direction: 'sendonly', streams: [this.options.localStream!] })
            if (track.kind === 'video') preferCodec(added, this.options.codec)
          }
        }
        this.tracksAdded = true
      }
      const answer = await this.peer.createAnswer()
      await this.peer.setLocalDescription(answer)
      await applyAllSenderLimits(this.peer, this.options.preferences)
      const localSDP = this.peer.localDescription?.sdp
      if (!localSDP) throw new Error('Браузер не создал SDP-ответ трансляции')
      this.options.onAnswer(localSDP)
    })
    this.offerQueue = operation.catch((error: unknown) => {
      if (!this.closed) this.options.onError(asError(error, 'Не удалось согласовать серверную трансляцию'))
    })
    return this.offerQueue
  }

  async addICECandidate(candidate: StreamICECandidate) {
    if (this.closed) return
    if (!remoteDescriptionAcceptsCandidate(this.peer, candidate)) {
      if (this.pendingCandidates.length < 64) this.pendingCandidates.push(candidate)
      return
    }
    try {
      await this.peer.addIceCandidate(browserCandidate(candidate))
    } catch (error) {
      this.options.onError(asError(error, 'Не удалось добавить ICE-кандидат трансляции'))
    }
  }

  close() {
    if (this.closed) return
    this.closed = true
    this.stopQualityMonitor()
    this.peer.close()
    this.pendingCandidates.length = 0
  }
}

interface P2PPublisherOptions extends MediaCallbacks {
  localStream: MediaStream
  preferences: StreamPreferences
  codec: StreamCodec
  onOffer: (targetConnectionId: string, sdp: string) => void
  onICECandidate: (targetConnectionId: string, candidate: StreamICECandidate) => void
}

interface PeerState {
  peer: RTCPeerConnection
  pendingCandidates: StreamICECandidate[]
  stopQualityMonitor: () => void
  recovery: WebRTCRecoveryController
  operation: Promise<void>
}

export class BrowserP2PStreamPublisher {
  private readonly peers = new Map<string, PeerState>()
  private closed = false

  constructor(private readonly options: P2PPublisherOptions) {}

  async addViewer(connectionId: string) {
    if (this.closed) return
    if (this.peers.has(connectionId)) {
      this.restartViewer(connectionId)
      return
    }
    const peer = new RTCPeerConnection(browserICEConfiguration())
    const state: PeerState = {
      peer,
      pendingCandidates: [],
      stopQualityMonitor: monitorVideoQuality(
        peer,
        'outbound-rtp',
        this.options.onQualityStats,
      ),
      recovery: new WebRTCRecoveryController(),
      operation: Promise.resolve(),
    }
    this.peers.set(connectionId, state)
    wirePeer(peer, this.options, (connectionState) => {
      this.handlePeerConnectionState(connectionId, state, connectionState)
    })
    peer.onicecandidate = (event) => {
      if (!event.candidate) return
      const candidate = wireICECandidate(event.candidate)
      if (candidate) this.options.onICECandidate(connectionId, candidate)
    }
    for (const track of this.options.localStream.getTracks()) {
      const transceiver = peer.addTransceiver(track, { direction: 'sendonly', streams: [this.options.localStream] })
      if (track.kind === 'video') preferCodec(transceiver, this.options.codec)
    }
    try {
      await this.negotiate(connectionId, state, false)
    } catch (error) {
      this.removeViewer(connectionId)
      this.options.onError(asError(error, 'Не удалось создать P2P-трансляцию'))
    }
  }

  acceptAnswer(connectionId: string, sdp: string) {
    const state = this.peers.get(connectionId)
    if (!state || this.closed) return
    const operation = state.operation.then(async () => {
      if (this.closed || this.peers.get(connectionId) !== state) return
      await state.peer.setRemoteDescription({ type: 'answer', sdp })
      const pending = state.pendingCandidates.splice(0)
      for (const candidate of pending) {
        if (remoteDescriptionAcceptsCandidate(state.peer, candidate)) {
          await state.peer.addIceCandidate(browserCandidate(candidate))
        }
      }
    })
    state.operation = operation.catch((error: unknown) => {
      if (!this.closed && this.peers.get(connectionId) === state) {
        this.options.onError(asError(error, 'Не удалось принять P2P-ответ зрителя'))
      }
    })
    return operation
  }

  async addICECandidate(connectionId: string, candidate: StreamICECandidate) {
    const state = this.peers.get(connectionId)
    if (!state || this.closed) return
    if (!remoteDescriptionAcceptsCandidate(state.peer, candidate)) {
      if (state.pendingCandidates.length < 64) state.pendingCandidates.push(candidate)
      return
    }
    try {
      await state.peer.addIceCandidate(browserCandidate(candidate))
    } catch (error) {
      this.options.onError(asError(error, 'Не удалось добавить P2P ICE-кандидат'))
    }
  }

  removeViewer(connectionId: string) {
    const state = this.peers.get(connectionId)
    state?.recovery.stop()
    state?.stopQualityMonitor()
    state?.peer.close()
    this.peers.delete(connectionId)
  }

  close() {
    if (this.closed) return
    this.closed = true
    this.peers.forEach(({ peer, stopQualityMonitor, recovery }) => {
      recovery.stop()
      stopQualityMonitor()
      peer.close()
    })
    this.peers.clear()
  }

  restartViewer(connectionId: string) {
    if (this.closed) return
    const state = this.peers.get(connectionId)
    if (!state) {
      void this.addViewer(connectionId)
      return
    }
    this.startPeerRecovery(connectionId, state, true)
  }

  private handlePeerConnectionState(
    connectionId: string,
    state: PeerState,
    connectionState: RTCPeerConnectionState,
  ) {
    if (this.closed || this.peers.get(connectionId) !== state) return
    if (connectionState === 'connected') state.recovery.stop()
    else if (connectionState === 'disconnected') this.startPeerRecovery(connectionId, state, false)
    else if (connectionState === 'failed') this.startPeerRecovery(connectionId, state, true)
  }

  private startPeerRecovery(connectionId: string, state: PeerState, immediate: boolean) {
    state.recovery.start(
      immediate,
      () => this.negotiate(connectionId, state, true),
      () => {
        if (this.peers.get(connectionId) === state && state.peer.connectionState !== 'connected') {
          this.removeViewer(connectionId)
        }
      },
    )
  }

  private negotiate(connectionId: string, state: PeerState, restartICE: boolean) {
    const operation = state.operation.then(async () => {
      if (this.closed || this.peers.get(connectionId) !== state) return
      if (state.peer.signalingState !== 'stable') return
      if (restartICE) state.peer.restartIce()
      const offer = await state.peer.createOffer(restartICE ? { iceRestart: true } : undefined)
      await state.peer.setLocalDescription(offer)
      await applyAllSenderLimits(state.peer, this.options.preferences)
      const localSDP = state.peer.localDescription?.sdp
      if (!localSDP) throw new Error('Браузер не создал P2P SDP-предложение')
      this.options.onOffer(connectionId, localSDP)
    })
    state.operation = operation.catch(() => undefined)
    return operation
  }
}

interface P2PViewerOptions extends MediaCallbacks {
  onAnswer: (targetConnectionId: string, sdp: string) => void
  onICECandidate: (targetConnectionId: string, candidate: StreamICECandidate) => void
  onRestartRequest: (targetConnectionId: string) => void
}

export class BrowserP2PStreamViewer {
  private state: PeerState | null = null
  private publisherConnectionId = ''
  private closed = false

  constructor(private readonly options: P2PViewerOptions) {}

  async acceptOffer(connectionId: string, sdp: string) {
    if (this.closed) return
    if (
      this.state
      && (this.state.peer.connectionState === 'failed' || this.state.peer.connectionState === 'closed')
    ) this.disposeState()
    if (!this.state) {
      const peer = new RTCPeerConnection(browserICEConfiguration())
      const state: PeerState = {
        peer,
        pendingCandidates: [],
        stopQualityMonitor: monitorVideoQuality(
          peer,
          'inbound-rtp',
          this.options.onQualityStats,
        ),
        recovery: new WebRTCRecoveryController(),
        operation: Promise.resolve(),
      }
      this.state = state
      this.publisherConnectionId = connectionId
      wirePeer(peer, this.options, (connectionState) => {
        this.handleConnectionState(state, connectionState)
      })
      peer.onicecandidate = (event) => {
        if (!event.candidate) return
        const candidate = wireICECandidate(event.candidate)
        if (candidate) this.options.onICECandidate(connectionId, candidate)
      }
    }
    if (connectionId !== this.publisherConnectionId) return
    const state = this.state
    const operation = state.operation.then(async () => {
      if (this.closed || this.state !== state) return
      await state.peer.setRemoteDescription({ type: 'offer', sdp })
      const pending = state.pendingCandidates.splice(0)
      for (const candidate of pending) {
        if (remoteDescriptionAcceptsCandidate(state.peer, candidate)) {
          await state.peer.addIceCandidate(browserCandidate(candidate))
        }
      }
      const answer = await state.peer.createAnswer()
      await state.peer.setLocalDescription(answer)
      const localSDP = state.peer.localDescription?.sdp
      if (!localSDP) throw new Error('Браузер не создал P2P SDP-ответ')
      this.options.onAnswer(connectionId, localSDP)
    })
    state.operation = operation.catch((error: unknown) => {
      this.options.onError(asError(error, 'Не удалось принять P2P-трансляцию'))
    })
    return operation
  }

  async addICECandidate(connectionId: string, candidate: StreamICECandidate) {
    if (this.closed || connectionId !== this.publisherConnectionId || !this.state) return
    if (!remoteDescriptionAcceptsCandidate(this.state.peer, candidate)) {
      if (this.state.pendingCandidates.length < 64) this.state.pendingCandidates.push(candidate)
      return
    }
    try {
      await this.state.peer.addIceCandidate(browserCandidate(candidate))
    } catch (error) {
      this.options.onError(asError(error, 'Не удалось добавить P2P ICE-кандидат'))
    }
  }

  close() {
    if (this.closed) return
    this.closed = true
    this.disposeState()
  }

  private handleConnectionState(state: PeerState, connectionState: RTCPeerConnectionState) {
    if (this.closed || this.state !== state) return
    if (connectionState === 'connected') state.recovery.stop()
    else if (connectionState === 'disconnected') this.startRecovery(state, false)
    else if (connectionState === 'failed') this.startRecovery(state, true)
  }

  private startRecovery(state: PeerState, immediate: boolean) {
    state.recovery.start(
      immediate,
      () => {
        if (this.publisherConnectionId) this.options.onRestartRequest(this.publisherConnectionId)
      },
      () => {
        if (this.state === state && state.peer.connectionState !== 'connected') {
          this.options.onError(new Error('Не удалось восстановить P2P-трансляцию после потери сети'))
        }
      },
    )
  }

  private disposeState() {
    this.state?.recovery.stop()
    this.state?.stopQualityMonitor()
    this.state?.peer.close()
    this.state = null
  }
}

function asError(value: unknown, fallback: string) {
  return value instanceof Error ? value : new Error(fallback)
}

export function streamErrorMessage(error: unknown) {
  if (error instanceof DOMException && error.name === 'NotAllowedError') return 'Доступ к экрану не предоставлен'
  if (error instanceof DOMException && error.name === 'NotFoundError') return 'Нет доступного экрана или окна для трансляции'
  return error instanceof Error ? error.message : 'Не удалось запустить трансляцию'
}
