import type { StreamCodec, StreamDynamicRange, StreamICECandidate, StreamRendition } from '../domain/types'
import { normalizeStreamPreferences, selectedStreamResolution, type StreamPreferences } from './streamSettings'
import { WebRTCRecoveryController, remoteDescriptionAcceptsCandidate } from './webrtcRecovery'
import { wireICECandidate } from './webrtcCandidate'
import { clientDiagnostics } from '../platform/clientDiagnostics'
import { cloneRTCConfiguration } from './webrtcConfig'
import { DecodeWatchdog, sampleInboundVideoStats } from './mediaRecovery'
import { detectHDRCapabilities, probeCapturedHDRTrack, rememberHDRCaptureProbe } from './hdrCapabilities'

export type StreamConnectionState = RTCPeerConnectionState

export interface StreamQualityStats {
  codec: string
  bitrateKbps: number
  framesPerSecond: number
  width: number
  height: number
  packetsLost: number
  qualityLimitationReason: 'none' | 'cpu' | 'bandwidth' | 'other' | ''
  dynamicRange?: StreamDynamicRange
}

interface MediaCallbacks {
  onRemoteStream?: (stream: MediaStream) => void
  onQualityStats?: (stats: StreamQualityStats) => void
  onConnectionStateChange: (state: StreamConnectionState) => void
  onError: (error: Error) => void
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

/** Compatibility-first auto order per RFC 7742: H.264 before VP8/VP9/AV1. */
const AUTO_CODEC_ORDER: StreamCodec[] = ['h264', 'vp8', 'vp9', 'av1']

export type CodecRole = 'send' | 'receive' | 'both'

/**
 * Tolerant fmtp parser: case-insensitive keys/values, tolerates spaces around
 * separators and values.
 */
function parseFmtp(fmtpLine: string | undefined | null): Map<string, string> {
  const result = new Map<string, string>()
  for (const part of (fmtpLine ?? '').split(';')) {
    const eq = part.indexOf('=')
    if (eq <= 0) continue
    const key = part.slice(0, eq).trim().toLowerCase()
    const value = part.slice(eq + 1).trim().toLowerCase()
    result.set(key, value)
  }
  return result
}

function isSupportedH264Fmtp(fmtpLine: string | undefined | null): boolean {
  const parameters = parseFmtp(fmtpLine)
  if (parameters.get('packetization-mode') !== '1') return false
  // Constrained Baseline (42e0xx) or legacy Baseline-compatible (4200xx).
  // The level byte must never be compared for exact equality.
  const profile = parameters.get('profile-level-id')?.replace(/\s+/g, '') ?? ''
  return /^42(e0|00)[0-9a-f]{2}$/.test(profile)
}

function codecCapabilities(
  capabilities: RTCRtpCapabilities | null | undefined,
  codec: StreamCodec,
  profile?: string,
) {
  return (capabilities?.codecs ?? []).filter((candidate) => {
    if (candidate.mimeType.toLowerCase() !== STREAM_CODEC_MIME[codec]) return false
    const format = candidate.sdpFmtpLine ?? ''
    if (codec === 'vp9') {
      const parsed = format === '' ? new Map<string, string>() : parseFmtp(format)
      const candidateProfile = parsed.get('profile-id') ?? '0'
      return candidateProfile === (profile || '0')
    }
    if (codec === 'h264') return isSupportedH264Fmtp(format)
    return true
  })
}

function capabilitiesForRole(role: CodecRole) {
  const getSender = typeof RTCRtpSender !== 'undefined' && typeof RTCRtpSender.getCapabilities === 'function'
  const getReceiver = typeof RTCRtpReceiver !== 'undefined' && typeof RTCRtpReceiver.getCapabilities === 'function'
  const sender = getSender && role !== 'receive' ? RTCRtpSender.getCapabilities('video') : null
  const receiver = getReceiver && role !== 'send' ? RTCRtpReceiver.getCapabilities('video') : null
  return { sender, receiver }
}

export function supportedStreamCodecs(role: CodecRole = 'both'): StreamCodec[] {
  const { sender, receiver } = capabilitiesForRole(role)
  return AUTO_CODEC_ORDER.filter((codec) => {
    // Role-aware: publishing checks the sender, viewing checks the receiver;
    // only 'both' demands support on both sides.
    if (role !== 'receive' && codecCapabilities(sender, codec).length === 0) return false
    if (role !== 'send' && codecCapabilities(receiver, codec).length === 0) return false
    return true
  })
}

export function selectedStreamCodec(preferences: StreamPreferences, role: CodecRole = 'send'): StreamCodec {
  const supported = supportedStreamCodecs(role)
  if (preferences.codec !== 'auto') {
    if (!supported.includes(preferences.codec)) throw new Error(`Кодек ${preferences.codec.toUpperCase()} не поддерживается этим браузером`)
    return preferences.codec
  }
  const automatic = AUTO_CODEC_ORDER.find((codec) => supported.includes(codec))
  if (!automatic) throw new Error('Браузер не поддерживает видеокодеки трансляции')
  return automatic
}

/**
 * Moves the selected primary codecs to the front of the FULL unchanged
 * capability list. RTX/RED/FEC and other primary codecs are never removed:
 * filtering the list would disable RTX retransmission and FEC negotiation.
 */
function reorderCodecPreferences(
  capabilities: RTCRtpCapabilities | null | undefined,
  codec: StreamCodec,
  profile?: string,
) {
  const selected = codecCapabilities(capabilities, codec, profile)
  if (!capabilities || !selected.length) return null
  const selectedIds = new Set(selected.map((item) => item.mimeType.toLowerCase() + '|' + (item.sdpFmtpLine ?? '')))
  const rest = (capabilities.codecs ?? []).filter(
    (item) => !selectedIds.has(item.mimeType.toLowerCase() + '|' + (item.sdpFmtpLine ?? '')),
  )
  return [...selected, ...rest]
}

function preferCodec(transceiver: RTCRtpTransceiver, codec: StreamCodec, profile?: string) {
  if (!transceiver.setCodecPreferences || typeof RTCRtpReceiver.getCapabilities !== 'function') {
    clientDiagnostics.record('webrtc', 'stream_codec_preferences_unavailable', 'warn', { codec })
    return
  }
  const reordered = reorderCodecPreferences(RTCRtpReceiver.getCapabilities('video'), codec, profile)
  if (!reordered) {
    clientDiagnostics.record('webrtc', 'stream_codec_unavailable', 'warn', { codec })
    return
  }
  try {
    transceiver.setCodecPreferences(reordered)
  } catch (error) {
    clientDiagnostics.record('webrtc', 'stream_codec_preferences_failed', 'warn', {
      codec,
      error_name: error instanceof Error ? error.name : typeof error,
    })
  }
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

interface MediaRTPDiagnosticStats extends RTCStats {
  kind?: string
  mediaType?: string
  isRemote?: boolean
  bytesSent?: number
  bytesReceived?: number
  packetsSent?: number
  packetsReceived?: number
  packetsLost?: number
  jitter?: number
  framesPerSecond?: number
  frameWidth?: number
  frameHeight?: number
  audioLevel?: number
  concealedSamples?: number
  totalSamplesReceived?: number
  qualityLimitationReason?: string
  trackIdentifier?: string
}

function monitorPeerDiagnostics(
  peer: RTCPeerConnection,
  context: Record<string, unknown>,
) {
  let sampling = false
  const sample = async () => {
    if (sampling || peer.connectionState === 'closed' || typeof peer.getStats !== 'function') return
    sampling = true
    try {
      const report = await peer.getStats()
      const reports: Array<Record<string, unknown>> = []
      report.forEach((raw) => {
        const stats = raw as MediaRTPDiagnosticStats
        if (
          stats.isRemote
          || (stats.type !== 'inbound-rtp' && stats.type !== 'outbound-rtp')
          || (stats.kind !== 'audio' && stats.kind !== 'video'
            && stats.mediaType !== 'audio' && stats.mediaType !== 'video')
        ) return
        const inbound = stats.type === 'inbound-rtp'
        reports.push({
          direction: inbound ? 'inbound' : 'outbound',
          kind: stats.kind ?? stats.mediaType ?? '',
          track_id: stats.trackIdentifier ?? '',
          bytes: inbound ? stats.bytesReceived ?? 0 : stats.bytesSent ?? 0,
          packets: inbound ? stats.packetsReceived ?? 0 : stats.packetsSent ?? 0,
          packets_lost: stats.packetsLost ?? 0,
          jitter: stats.jitter ?? 0,
          audio_level: stats.audioLevel ?? null,
          concealed_samples: stats.concealedSamples ?? null,
          total_samples_received: stats.totalSamplesReceived ?? null,
          frames_per_second: stats.framesPerSecond ?? null,
          width: stats.frameWidth ?? null,
          height: stats.frameHeight ?? null,
          quality_limitation_reason: stats.qualityLimitationReason ?? '',
        })
      })
      clientDiagnostics.record('media', 'stream_rtp_stats', 'info', {
        ...context,
        connection_state: peer.connectionState,
        reports,
      })
    } catch (error) {
      clientDiagnostics.record('media', 'stream_stats_failed', 'debug', {
        ...context,
        error_name: error instanceof Error ? error.name : typeof error,
      })
    } finally {
      sampling = false
    }
  }
  const timer = window.setInterval(() => { void sample() }, 15_000)
  return () => window.clearInterval(timer)
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
  diagnosticContext: Record<string, unknown> = {},
) {
  const remote = new MediaStream()
  peer.ontrack = (event) => {
    if (!remote.getTracks().some((track) => track.id === event.track.id)) {
      remote.addTrack(event.track)
      clientDiagnostics.record('media', 'stream_remote_track_added', 'info', {
        ...diagnosticContext,
        track_id: event.track.id,
        kind: event.track.kind,
        muted: event.track.muted,
        ready_state: event.track.readyState,
        remote_track_count: remote.getTracks().length,
      })
      event.track.addEventListener('mute', () => {
        clientDiagnostics.record('media', 'stream_remote_track_muted', 'warn', {
          ...diagnosticContext,
          track_id: event.track.id,
          kind: event.track.kind,
        })
      })
      event.track.addEventListener('unmute', () => {
        clientDiagnostics.record('media', 'stream_remote_track_unmuted', 'info', {
          ...diagnosticContext,
          track_id: event.track.id,
          kind: event.track.kind,
        })
      })
      event.track.addEventListener('ended', () => {
        clientDiagnostics.record('media', 'stream_remote_track_ended', 'warn', {
          ...diagnosticContext,
          track_id: event.track.id,
          kind: event.track.kind,
        })
        remote.removeTrack(event.track)
      }, { once: true })
    }
    // Always expose one stable aggregate. Browsers may return a different
    // event.streams[0] object for a track added during renegotiation; forwarding
    // only the newest object can drop audio or video that was attached earlier.
    callbacks.onRemoteStream?.(remote)
  }
  peer.onconnectionstatechange = () => {
    clientDiagnostics.record('webrtc', 'stream_connection_state', peer.connectionState === 'failed' ? 'error' : 'info', {
      ...diagnosticContext,
      connection_state: peer.connectionState,
      ice_connection_state: peer.iceConnectionState,
      signaling_state: peer.signalingState,
    })
    callbacks.onConnectionStateChange(peer.connectionState)
    onConnectionState?.(peer.connectionState)
  }
  peer.oniceconnectionstatechange = () => {
    clientDiagnostics.record('webrtc', 'stream_ice_state', peer.iceConnectionState === 'failed' ? 'error' : 'debug', {
      ...diagnosticContext,
      ice_connection_state: peer.iceConnectionState,
    })
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
  const settings = video.getSettings()
  clientDiagnostics.record('media', 'stream_capture_ready', 'info', {
    has_audio: media.getAudioTracks().length > 0,
    width: settings.width ?? null,
    height: settings.height ?? null,
    frame_rate: settings.frameRate ?? null,
  })
  if (preferences.dynamicRange === 'hdr' && preferences.mode === 'server') {
    const capabilities = await detectHDRCapabilities()
    const probe = await probeCapturedHDRTrack(video, capabilities)
    rememberHDRCaptureProbe(media, probe)
    clientDiagnostics.record('media', 'hdr_capture_probe', probe.supported ? 'info' : 'warn', {
      source_range: probe.sourceRange,
      bit_depth: probe.bitDepth,
      codec_profile: probe.codecProfile ? `${probe.codecProfile.codec}:${probe.codecProfile.profile}` : '',
      reason: probe.reason,
    })
  }
  return media
}

interface ServerSessionOptions extends MediaCallbacks {
  localStream?: MediaStream
  /** Publisher video tracks and rendition metadata use the same stable order. */
  renditions?: StreamRendition[]
  preferences: StreamPreferences
  codec: StreamCodec
  iceConfiguration?: RTCConfiguration
  onAnswer: (sdp: string) => void
  onICECandidate: (candidate: StreamICECandidate) => void
  /** Server-mode viewer only: bounded recovery request to the backend. */
  onRequestRecovery?: (action: 'keyframe' | 'ice_restart') => void
  /** Server-mode viewer only: one full leaveStream -> watchStream recreation. */
  onRequestRewatch?: () => void
}

export class BrowserServerStreamSession {
  private readonly peer: RTCPeerConnection
  private readonly pendingCandidates: StreamICECandidate[] = []
  private offerQueue = Promise.resolve()
  private tracksAdded = false
  private closed = false
  private readonly stopQualityMonitor: () => void
  private readonly stopDiagnosticMonitor: () => void
  private readonly watchdog: DecodeWatchdog | null

  constructor(private readonly options: ServerSessionOptions) {
    this.peer = new RTCPeerConnection(
      options.iceConfiguration ? cloneRTCConfiguration(options.iceConfiguration) : {},
    )
    const context = {
      transport: 'server',
      role: options.localStream ? 'publisher' : 'viewer',
    }
    wirePeer(this.peer, options, undefined, context)
    if (!options.localStream) {
      // Viewer-only: detect RTP flowing but no decodable frames (black live).
      this.watchdog = new DecodeWatchdog({
        getSample: () => sampleInboundVideoStats(this.peer),
        requestKeyframe: () => options.onRequestRecovery?.('keyframe'),
        requestIceRestart: () => options.onRequestRecovery?.('ice_restart'),
        requestFullRewatch: () => options.onRequestRewatch?.(),
      })
      this.watchdog.start()
    } else {
      this.watchdog = null
    }
    this.stopQualityMonitor = monitorVideoQuality(
      this.peer,
      options.localStream ? 'outbound-rtp' : 'inbound-rtp',
      options.onQualityStats,
    )
    this.stopDiagnosticMonitor = monitorPeerDiagnostics(this.peer, context)
    this.peer.onicecandidate = (event) => {
      if (!event.candidate) return
      clientDiagnostics.record('webrtc', 'stream_local_ice', 'debug', {
        ...context,
        type: event.candidate.type ?? null,
        protocol: event.candidate.protocol ?? null,
      })
      const candidate = wireICECandidate(event.candidate)
      if (candidate) options.onICECandidate(candidate)
    }
  }

  acceptOffer(sdp: string) {
    const operation = this.offerQueue.then(async () => {
      if (this.closed) return
      clientDiagnostics.record('webrtc', 'stream_offer_received', 'debug', {
        transport: 'server',
        role: this.options.localStream ? 'publisher' : 'viewer',
        sdp_bytes: sdp.length,
        pending_ice_count: this.pendingCandidates.length,
      })
      await this.peer.setRemoteDescription({ type: 'offer', sdp })
      const pending = this.pendingCandidates.splice(0)
      for (const candidate of pending) {
        if (remoteDescriptionAcceptsCandidate(this.peer, candidate)) {
          await this.peer.addIceCandidate(browserCandidate(candidate))
        }
      }
      if (this.options.localStream && !this.tracksAdded) {
        const videoTracks = this.options.localStream.getVideoTracks()
        const audioTracks = this.options.localStream.getAudioTracks()
        for (const [index, track] of videoTracks.entries()) {
          const rendition = this.options.renditions?.[index]
          const transceiver = this.peer.getTransceivers().find((item) => item.receiver.track.kind === 'video' && !item.sender.track)
          if (transceiver) {
            transceiver.direction = 'sendonly'
            await transceiver.sender.replaceTrack(track)
            preferCodec(transceiver, rendition?.codec ?? this.options.codec, rendition?.profile)
          } else {
            const created = this.peer.addTransceiver(track, { direction: 'sendonly', streams: [this.options.localStream] })
            preferCodec(created, rendition?.codec ?? this.options.codec, rendition?.profile)
          }
        }
        for (const track of audioTracks) {
          const transceiver = this.peer.getTransceivers().find((item) => item.receiver.track.kind === 'audio' && !item.sender.track)
          if (transceiver) {
            transceiver.direction = 'sendonly'
            await transceiver.sender.replaceTrack(track)
          } else {
            this.peer.addTransceiver(track, { direction: 'sendonly', streams: [this.options.localStream] })
          }
        }
        this.tracksAdded = true
      }
      const answer = await this.peer.createAnswer()
      await this.peer.setLocalDescription(answer)
      await applyAllSenderLimits(this.peer, this.options.preferences)
      const localSDP = this.peer.localDescription?.sdp
      if (!localSDP) throw new Error('Браузер не создал SDP-ответ трансляции')
      clientDiagnostics.record('webrtc', 'stream_answer_created', 'debug', {
        transport: 'server',
        role: this.options.localStream ? 'publisher' : 'viewer',
        sdp_bytes: localSDP.length,
      })
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
      clientDiagnostics.record('webrtc', 'stream_remote_ice_buffered', 'debug', {
        transport: 'server',
        pending_ice_count: this.pendingCandidates.length,
      })
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
    clientDiagnostics.record('webrtc', 'stream_session_closed', 'info', {
      transport: 'server',
      role: this.options.localStream ? 'publisher' : 'viewer',
    })
    this.watchdog?.stop()
    this.stopQualityMonitor()
    this.stopDiagnosticMonitor()
    this.peer.close()
    this.pendingCandidates.length = 0
  }
}

interface P2PPublisherOptions extends MediaCallbacks {
  localStream: MediaStream
  preferences: StreamPreferences
  codec: StreamCodec
  iceConfiguration?: RTCConfiguration
  onOffer: (targetConnectionId: string, sdp: string) => void
  onICECandidate: (targetConnectionId: string, candidate: StreamICECandidate) => void
}

interface PeerState {
  peer: RTCPeerConnection
  pendingCandidates: StreamICECandidate[]
  stopQualityMonitor: () => void
  stopDiagnosticMonitor: () => void
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
    const peer = new RTCPeerConnection(
      this.options.iceConfiguration ? cloneRTCConfiguration(this.options.iceConfiguration) : {},
    )
    const state: PeerState = {
      peer,
      pendingCandidates: [],
      stopQualityMonitor: monitorVideoQuality(
        peer,
        'outbound-rtp',
        this.options.onQualityStats,
      ),
      stopDiagnosticMonitor: monitorPeerDiagnostics(peer, {
        transport: 'p2p',
        role: 'publisher',
        peer_connection_id: connectionId,
      }),
      recovery: new WebRTCRecoveryController(),
      operation: Promise.resolve(),
    }
    this.peers.set(connectionId, state)
    wirePeer(
      peer,
      this.options,
      (connectionState) => {
        this.handlePeerConnectionState(connectionId, state, connectionState)
      },
      { transport: 'p2p', role: 'publisher', peer_connection_id: connectionId },
    )
    peer.onicecandidate = (event) => {
      if (!event.candidate) return
      clientDiagnostics.record('webrtc', 'stream_local_ice', 'debug', {
        transport: 'p2p',
        role: 'publisher',
        peer_connection_id: connectionId,
        type: event.candidate.type ?? null,
        protocol: event.candidate.protocol ?? null,
      })
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
      clientDiagnostics.record('webrtc', 'stream_answer_received', 'debug', {
        transport: 'p2p',
        role: 'publisher',
        peer_connection_id: connectionId,
        sdp_bytes: sdp.length,
      })
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
    state?.stopDiagnosticMonitor()
    state?.peer.close()
    this.peers.delete(connectionId)
  }

  close() {
    if (this.closed) return
    this.closed = true
    this.peers.forEach(({ peer, stopQualityMonitor, stopDiagnosticMonitor, recovery }) => {
      recovery.stop()
      stopQualityMonitor()
      stopDiagnosticMonitor()
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
      clientDiagnostics.record('webrtc', 'stream_offer_created', 'debug', {
        transport: 'p2p',
        role: 'publisher',
        peer_connection_id: connectionId,
        ice_restart: restartICE,
        sdp_bytes: localSDP.length,
      })
      this.options.onOffer(connectionId, localSDP)
    })
    state.operation = operation.catch(() => undefined)
    return operation
  }
}

interface P2PViewerOptions extends MediaCallbacks {
  iceConfiguration?: RTCConfiguration
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
      const peer = new RTCPeerConnection(
        this.options.iceConfiguration ? cloneRTCConfiguration(this.options.iceConfiguration) : {},
      )
      const state: PeerState = {
        peer,
        pendingCandidates: [],
        stopQualityMonitor: monitorVideoQuality(
          peer,
          'inbound-rtp',
          this.options.onQualityStats,
        ),
        stopDiagnosticMonitor: monitorPeerDiagnostics(peer, {
          transport: 'p2p',
          role: 'viewer',
          peer_connection_id: connectionId,
        }),
        recovery: new WebRTCRecoveryController(),
        operation: Promise.resolve(),
      }
      this.state = state
      this.publisherConnectionId = connectionId
      wirePeer(
        peer,
        this.options,
        (connectionState) => {
          this.handleConnectionState(state, connectionState)
        },
        { transport: 'p2p', role: 'viewer', peer_connection_id: connectionId },
      )
      peer.onicecandidate = (event) => {
        if (!event.candidate) return
        clientDiagnostics.record('webrtc', 'stream_local_ice', 'debug', {
          transport: 'p2p',
          role: 'viewer',
          peer_connection_id: connectionId,
          type: event.candidate.type ?? null,
          protocol: event.candidate.protocol ?? null,
        })
        const candidate = wireICECandidate(event.candidate)
        if (candidate) this.options.onICECandidate(connectionId, candidate)
      }
    }
    if (connectionId !== this.publisherConnectionId) return
    const state = this.state
    const operation = state.operation.then(async () => {
      if (this.closed || this.state !== state) return
      await state.peer.setRemoteDescription({ type: 'offer', sdp })
      clientDiagnostics.record('webrtc', 'stream_offer_received', 'debug', {
        transport: 'p2p',
        role: 'viewer',
        peer_connection_id: connectionId,
        sdp_bytes: sdp.length,
      })
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
      clientDiagnostics.record('webrtc', 'stream_answer_created', 'debug', {
        transport: 'p2p',
        role: 'viewer',
        peer_connection_id: connectionId,
        sdp_bytes: localSDP.length,
      })
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
    this.state?.stopDiagnosticMonitor()
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
