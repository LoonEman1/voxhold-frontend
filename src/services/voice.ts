import type { VoiceICECandidate } from '../domain/types'
import { normalizeVoicePreferences, type VoicePreferences } from './voiceSettings'
import { remoteDescriptionAcceptsCandidate } from './webrtcRecovery'
import { wireICECandidate } from './webrtcCandidate'
import { clientDiagnostics } from '../platform/clientDiagnostics'
import { cloneRTCConfiguration } from './webrtcConfig'
import { BrowserVoiceInput } from './voiceInput'

export { inputConstraints } from './voiceInput'
export { BrowserVoiceInput } from './voiceInput'

export type VoiceMediaConnectionState = 'new' | 'connecting' | 'connected' | 'disconnected' | 'failed' | 'closed'

interface VoiceMediaOptions {
  /** The pre-started microphone capture. The session never closes it. */
  input: BrowserVoiceInput
  /** Runtime ICE configuration loaded from the backend; empty means host-only. */
  iceConfiguration?: RTCConfiguration
  onAnswer: (sdp: string) => void
  onICECandidate: (candidate: VoiceICECandidate) => void
  onConnectionStateChange: (state: VoiceMediaConnectionState) => void
  onError: (error: Error) => void
  onInputLevel?: (level: number) => void
  onRemoteLevels?: (levels: VoiceRemoteLevel[]) => void
  /** Browser blocked audible playback; the UI should offer an explicit action. */
  onPlaybackBlocked?: () => void
}

interface VoiceRemoteOutput {
  stream: MediaStream
  track: MediaStreamTrack
  audio: HTMLAudioElement
}

interface VoiceRemoteAnalyser {
  source: MediaStreamAudioSourceNode
  analyser: AnalyserNode
  values: Uint8Array<ArrayBuffer>
}

export interface VoiceRemoteLevel {
  connectionId: string
  level: number
}

interface AudioRTPDiagnosticStats extends RTCStats {
  kind?: string
  mediaType?: string
  isRemote?: boolean
  bytesReceived?: number
  bytesSent?: number
  packetsReceived?: number
  packetsSent?: number
  packetsLost?: number
  jitter?: number
  audioLevel?: number
  concealedSamples?: number
  totalSamplesReceived?: number
  jitterBufferDelay?: number
  jitterBufferEmittedCount?: number
  trackIdentifier?: string
}

function audioRTPDiagnostics(report: RTCStatsReport) {
  const values: Array<Record<string, unknown>> = []
  report.forEach((raw) => {
    const stats = raw as AudioRTPDiagnosticStats
    if (
      stats.isRemote
      || (stats.type !== 'inbound-rtp' && stats.type !== 'outbound-rtp')
      || (stats.kind !== 'audio' && stats.mediaType !== 'audio')
    ) return
    values.push({
      direction: stats.type === 'inbound-rtp' ? 'inbound' : 'outbound',
      track_id: stats.trackIdentifier ?? '',
      bytes: stats.type === 'inbound-rtp' ? stats.bytesReceived ?? 0 : stats.bytesSent ?? 0,
      packets: stats.type === 'inbound-rtp' ? stats.packetsReceived ?? 0 : stats.packetsSent ?? 0,
      packets_lost: stats.packetsLost ?? 0,
      jitter: stats.jitter ?? 0,
      audio_level: stats.audioLevel ?? null,
      concealed_samples: stats.concealedSamples ?? null,
      total_samples_received: stats.totalSamplesReceived ?? null,
      jitter_buffer_delay: stats.jitterBufferDelay ?? null,
      jitter_buffer_emitted_count: stats.jitterBufferEmittedCount ?? null,
    })
  })
  return values
}

function toBrowserCandidate(candidate: VoiceICECandidate): RTCIceCandidateInit {
  return {
    candidate: candidate.candidate,
    sdpMid: candidate.sdp_mid ?? null,
    sdpMLineIndex: candidate.sdp_mline_index ?? null,
    usernameFragment: candidate.username_fragment ?? null,
  }
}

/**
 * Owns only the peer connection, its sender and the remote outputs. It accepts
 * an existing BrowserVoiceInput so that signalling reconnect can recreate the
 * peer while keeping the already granted microphone.
 */
export class BrowserVoiceSession {
  private peer: RTCPeerConnection | null = null
  private inputSender: RTCRtpSender | null = null
  private readonly remoteOutputs = new Map<string, VoiceRemoteOutput>()
  // The server names every relayed track "audio-<connectionId>" in the offer
  // msid, which lets us attribute remote audio levels to room participants.
  private readonly midOwners = new Map<string, string>()
  private readonly trackOwners = new Map<string, string>()
  private analysis: { context: AudioContext; sink: GainNode } | null = null
  private readonly remoteAnalysers = new Map<string, VoiceRemoteAnalyser>()
  // Per-user loudness multiplier keyed by the server connection id (0..2).
  private readonly remoteGains = new Map<string, number>()
  private levelTimer: number | null = null
  private preferences: VoicePreferences | null = null
  private pendingRemoteCandidates: VoiceICECandidate[] = []
  private offerQueue: Promise<void> = Promise.resolve()
  private statsTimer: number | null = null
  private statsSampling = false
  private closed = false
  private selfMute = false
  private selfDeaf = false
  private autoplayRetryAttached = false
  private autoplayRetryHandler: (() => void) | null = null
  private unsubscribeInput: (() => void) | null = null
  private readonly visibilityHandler = () => {
    if (!this.closed && typeof document !== 'undefined' && document.visibilityState === 'visible') {
      this.resumeAudio()
    }
  }

  constructor(private readonly options: VoiceMediaOptions) {
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.visibilityHandler)
    }
  }

  static supported() {
    return typeof RTCPeerConnection !== 'undefined' && !!navigator.mediaDevices?.getUserMedia
  }

  static outputSelectionSupported() {
    return typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype
  }

  async start(selfMute: boolean, selfDeaf: boolean, preferences: VoicePreferences) {
    if (this.peer || this.closed) throw new Error('Voice session is already initialized')
    if (!BrowserVoiceSession.supported()) {
      throw new Error('Голосовые каналы требуют современный браузер и защищённое HTTPS-соединение')
    }
    const track = this.options.input.currentTrack()
    const stream = this.options.input.currentStream()
    if (!track || !stream || !this.options.input.isHealthy) {
      throw new Error('Микрофон не готов: запустите захват перед стартом сессии')
    }

    this.selfMute = selfMute
    this.selfDeaf = selfDeaf
    this.preferences = normalizeVoicePreferences(preferences)
    clientDiagnostics.record('webrtc', 'voice_starting', 'info', {
      self_mute: selfMute,
      self_deaf: selfDeaf,
      bitrate_kbps: this.preferences.bitrateKbps,
      selected_input: !!this.preferences.inputDeviceId,
      selected_output: !!this.preferences.outputDeviceId,
      noise_suppression_mode: this.preferences.noiseSuppressionMode,
    })

    this.options.input.setState(!selfMute)

    const peer = new RTCPeerConnection(
      this.options.iceConfiguration ? cloneRTCConfiguration(this.options.iceConfiguration) : {},
    )
    this.peer = peer
    const inputSettings = track.getSettings?.() ?? {}
    clientDiagnostics.record('media', 'voice_input_ready', 'info', {
      sample_rate: inputSettings.sampleRate ?? null,
      channel_count: inputSettings.channelCount ?? null,
      echo_cancellation: inputSettings.echoCancellation ?? null,
      noise_suppression: inputSettings.noiseSuppression ?? null,
      auto_gain_control: inputSettings.autoGainControl ?? null,
    })
    this.inputSender = peer.addTrack(track, stream)
    await this.applySenderBitrate(this.preferences.bitrateKbps).catch(() => {
      // Keep voice available in WebViews that do not expose encoding controls.
    })
    peer.onicecandidate = ({ candidate }) => {
      if (!candidate || this.closed) return
      clientDiagnostics.record('webrtc', 'voice_local_ice', 'debug', {
        type: candidate.type ?? null,
        protocol: candidate.protocol ?? null,
      })
      const wireCandidate = wireICECandidate(candidate)
      if (wireCandidate) this.options.onICECandidate(wireCandidate)
    }

    peer.ontrack = ({ track: remoteTrack, transceiver }) => {
      if (this.closed || remoteTrack.kind !== 'audio' || this.remoteOutputs.has(remoteTrack.id)) return
      const connectionId = transceiver?.mid != null ? this.midOwners.get(transceiver.mid) : undefined
      if (connectionId) this.trackOwners.set(remoteTrack.id, connectionId)
      const media = new MediaStream([remoteTrack])
      const audio = document.createElement('audio')
      audio.autoplay = true
      audio.muted = this.selfDeaf
      audio.volume = this.remoteAudioVolume(connectionId)
      audio.setAttribute('aria-hidden', 'true')
      audio.className = 'voice-audio-output'
      audio.srcObject = media
      const output = { stream: media, track: remoteTrack, audio }
      this.remoteOutputs.set(remoteTrack.id, output)
      document.body.append(audio)
      clientDiagnostics.record('media', 'voice_remote_track_added', 'info', {
        track_id: remoteTrack.id,
        muted: remoteTrack.muted,
        ready_state: remoteTrack.readyState,
        remote_track_count: this.remoteOutputs.size,
      })
      remoteTrack.addEventListener('mute', () => {
        clientDiagnostics.record('media', 'voice_remote_track_muted', 'warn', { track_id: remoteTrack.id })
      })
      remoteTrack.addEventListener('unmute', () => {
        clientDiagnostics.record('media', 'voice_remote_track_unmuted', 'info', { track_id: remoteTrack.id })
      })
      remoteTrack.addEventListener('ended', () => {
        clientDiagnostics.record('media', 'voice_remote_track_ended', 'warn', { track_id: remoteTrack.id })
        this.removeRemoteOutput(remoteTrack.id, output)
      }, { once: true })
      void this.applyOutputDevice(this.preferences?.outputDeviceId ?? '', audio).catch(() => {
        // Keep the default output when the selected device disappeared.
      })
      this.attachRemoteAnalyser(remoteTrack.id, media)
      this.playRemoteAudio(output, 'track_added')
    }

    peer.onconnectionstatechange = () => {
      clientDiagnostics.record('webrtc', 'voice_connection_state', peer.connectionState === 'failed' ? 'error' : 'info', {
        connection_state: peer.connectionState,
        ice_connection_state: peer.iceConnectionState,
        ice_gathering_state: peer.iceGatheringState,
        signaling_state: peer.signalingState,
      })
      if (peer.connectionState === 'connected') void this.sampleStats()
      if (!this.closed) this.options.onConnectionStateChange(peer.connectionState)
    }
    peer.oniceconnectionstatechange = () => {
      clientDiagnostics.record('webrtc', 'voice_ice_state', peer.iceConnectionState === 'failed' ? 'error' : 'debug', {
        ice_connection_state: peer.iceConnectionState,
      })
    }
    peer.onicegatheringstatechange = () => {
      clientDiagnostics.record('webrtc', 'voice_ice_gathering_state', 'debug', {
        ice_gathering_state: peer.iceGatheringState,
      })
    }

    // A replacement track (device restored/retry) is swapped into the sender
    // without touching the rest of the session.
    this.unsubscribeInput = this.options.input.subscribe((nextTrack) => {
      void this.handleInputReplacement(nextTrack)
    })
    this.statsTimer = window.setInterval(() => { void this.sampleStats() }, 15_000)
  }

  private async handleInputReplacement(nextTrack: MediaStreamTrack) {
    const sender = this.inputSender
    if (!sender || this.closed) return
    nextTrack.enabled = !this.selfMute
    try {
      await sender.replaceTrack(nextTrack)
      clientDiagnostics.record('media', 'voice_input_sender_replaced', 'info')
    } catch (error) {
      if (!this.closed) {
        this.options.onError(error instanceof Error ? error : new Error('Не удалось заменить микрофон в сессии'))
      }
    }
  }

  // The relayed offer names each remote participant track "audio-<connectionId>"
  // inside its msid line. Pairing that track id with the m-line mid lets ontrack
  // attribute incoming audio to a specific room participant.
  private rememberOfferTracks(sdp: string) {
    let mid: string | null = null
    for (const rawLine of sdp.split(/\r?\n/)) {
      const line = rawLine.trim()
      if (line.startsWith('a=mid:')) {
        mid = line.slice('a=mid:'.length).trim() || null
      } else if (line.startsWith('a=msid:')) {
        const trackId = line.slice('a=msid:'.length).trim().split(/\s+/)[1] ?? ''
        if (mid !== null && trackId.startsWith('audio-')) {
          this.midOwners.set(mid, trackId.slice('audio-'.length))
        }
      }
    }
  }

  private attachRemoteAnalyser(trackId: string, media: MediaStream) {
    if (!this.options.onRemoteLevels || typeof AudioContext === 'undefined') return
    try {
      if (!this.analysis) {
        const context = new AudioContext({ latencyHint: 'interactive' })
        const sink = context.createGain()
        sink.gain.value = 0
        sink.connect(context.destination)
        this.analysis = { context, sink }
      }
      const { context, sink } = this.analysis
      const source = context.createMediaStreamSource(media)
      const analyser = context.createAnalyser()
      analyser.fftSize = 512
      analyser.smoothingTimeConstant = 0.55
      source.connect(analyser)
      analyser.connect(sink)
      this.remoteAnalysers.set(trackId, { source, analyser, values: new Uint8Array(analyser.fftSize) })
      if (context.state === 'suspended') void context.resume().catch(() => undefined)
      this.ensureLevelTimer()
    } catch {
      // Level metering is best-effort; voice keeps working without it.
    }
  }

  private detachRemoteAnalyser(trackId: string) {
    const entry = this.remoteAnalysers.get(trackId)
    if (!entry) return
    this.remoteAnalysers.delete(trackId)
    this.trackOwners.delete(trackId)
    try {
      entry.source.disconnect()
      entry.analyser.disconnect()
    } catch {
      // The node may already be detached with its context.
    }
  }

  private ensureLevelTimer() {
    if (this.levelTimer !== null || !this.options.onRemoteLevels) return
    this.levelTimer = window.setInterval(() => {
      if (this.closed) return
      const levels: VoiceRemoteLevel[] = []
      this.remoteAnalysers.forEach((entry, trackId) => {
        const connectionId = this.trackOwners.get(trackId)
        if (!connectionId) return
        entry.analyser.getByteTimeDomainData(entry.values)
        let energy = 0
        for (const value of entry.values) {
          const normalized = (value - 128) / 128
          energy += normalized * normalized
        }
        levels.push({ connectionId, level: Math.min(1, Math.sqrt(energy / entry.values.length) * 4.5) })
      })
      this.options.onRemoteLevels?.(levels)
    }, 120)
  }

  private playRemoteAudio(output: VoiceRemoteOutput, reason: string) {
    void output.audio.play().then(() => {
      clientDiagnostics.record('media', 'voice_playback_started', 'info', {
        track_id: output.track.id,
        reason,
        muted: output.audio.muted,
        volume: output.audio.volume,
      })
    }).catch((error: unknown) => {
      clientDiagnostics.record('media', 'voice_playback_blocked', 'warn', {
        track_id: output.track.id,
        reason,
        error_name: error instanceof Error ? error.name : typeof error,
      })
      if (error instanceof DOMException && error.name === 'NotAllowedError') {
        this.ensureAutoplayRetry()
        this.options.onPlaybackBlocked?.()
      }
    })
  }

  // Browsers block audible playback without a recent user gesture. Tracks that
  // arrive from renegotiation (a new participant joining later) have no gesture
  // available, so playback stays blocked until the next interaction. Retry on
  // the first global interaction instead of waiting for mute/unmute toggling.
  private ensureAutoplayRetry() {
    if (this.autoplayRetryAttached || this.closed || typeof document === 'undefined') return
    this.autoplayRetryAttached = true
    const handler = () => {
      document.removeEventListener('pointerdown', handler)
      document.removeEventListener('keydown', handler)
      this.autoplayRetryAttached = false
      this.autoplayRetryHandler = null
      if (this.closed || this.selfDeaf) return
      this.remoteOutputs.forEach((output) => {
        if (output.audio.paused) this.playRemoteAudio(output, 'autoplay_retry')
      })
      this.options.input.resume()
    }
    this.autoplayRetryHandler = handler
    document.addEventListener('pointerdown', handler)
    document.addEventListener('keydown', handler)
  }

  private async sampleStats() {
    const peer = this.peer
    if (!peer || this.closed || this.statsSampling || typeof peer.getStats !== 'function') return
    this.statsSampling = true
    try {
      const report = await peer.getStats()
      clientDiagnostics.record('media', 'voice_rtp_stats', 'info', {
        connection_state: peer.connectionState,
        remote_track_count: this.remoteOutputs.size,
        reports: audioRTPDiagnostics(report),
        outputs: Array.from(this.remoteOutputs.values(), ({ track, audio }) => ({
          track_id: track.id,
          track_muted: track.muted,
          track_ready_state: track.readyState,
          playback_paused: audio.paused,
          playback_muted: audio.muted,
          playback_ready_state: audio.readyState,
          playback_time: Math.round(audio.currentTime * 10) / 10,
          volume: audio.volume,
        })),
      })
    } catch (error) {
      clientDiagnostics.record('media', 'voice_stats_failed', 'debug', {
        error_name: error instanceof Error ? error.name : typeof error,
      })
    } finally {
      this.statsSampling = false
    }
  }

  private removeRemoteOutput(trackId: string, output: VoiceRemoteOutput) {
    if (this.remoteOutputs.get(trackId) !== output) return
    this.remoteOutputs.delete(trackId)
    this.detachRemoteAnalyser(trackId)
    output.audio.pause()
    output.audio.srcObject = null
    output.audio.remove()
    output.stream.removeTrack(output.track)
  }

  // Element volume is capped at 1, so a >100% user volume only amplifies while
  // the shared channel volume leaves headroom.
  private remoteAudioVolume(connectionId: string | undefined) {
    const gain = connectionId ? this.remoteGains.get(connectionId) ?? 1 : 1
    const base = (this.preferences?.outputVolume ?? 100) / 100
    return Math.min(1, Math.max(0, base * gain))
  }

  setRemoteGain(connectionId: string, gain: number) {
    const clamped = Math.min(2, Math.max(0, gain))
    this.remoteGains.set(connectionId, clamped)
    this.remoteOutputs.forEach((output, trackId) => {
      if (this.trackOwners.get(trackId) === connectionId) output.audio.volume = this.remoteAudioVolume(connectionId)
    })
  }

  private async applyOutputDevice(deviceId: string, target?: HTMLAudioElement) {
    if (!BrowserVoiceSession.outputSelectionSupported() || !deviceId) return
    const outputs = target
      ? [target]
      : Array.from(this.remoteOutputs.values(), ({ audio }) => audio)
    await Promise.all(outputs.map(async (audio) => {
      try {
        await audio.setSinkId(deviceId)
      } catch (error) {
        clientDiagnostics.record('media', 'voice_output_device_failed', 'warn', {
          device_id_length: deviceId.length,
          error_name: error instanceof Error ? error.name : typeof error,
        })
        // A failing setSinkId must not break playback: fall back to default.
        await audio.setSinkId('').catch(() => undefined)
      }
    }))
  }

  private async applySenderBitrate(bitrateKbps: number) {
    const sender = this.inputSender
    if (!sender?.getParameters || !sender.setParameters) return
    const parameters = sender.getParameters()
    const encoding = parameters.encodings?.[0]
    if (!encoding) return
    encoding.maxBitrate = bitrateKbps * 1000
    await sender.setParameters(parameters)
  }

  applyPreferences(value: VoicePreferences) {
    const next = normalizeVoicePreferences(value)
    const previous = this.preferences ?? next
    this.preferences = next
    this.remoteOutputs.forEach((output, trackId) => {
      output.audio.volume = this.remoteAudioVolume(this.trackOwners.get(trackId))
    })
    const tasks: Array<Promise<void> | undefined> = [
      previous.bitrateKbps !== next.bitrateKbps ? this.applySenderBitrate(next.bitrateKbps) : undefined,
      this.applyOutputDevice(next.outputDeviceId).catch(() => undefined),
      this.options.input.applyPreferences(next),
    ]
    const operation = Promise.all(tasks).then(() => undefined)
    operation.catch(() => undefined)
    return operation
  }

  acceptOffer(sdp: string) {
    const operation = this.offerQueue.then(async () => {
      const peer = this.peer
      if (!peer || this.closed) return

      clientDiagnostics.record('webrtc', 'voice_offer_received', 'debug', {
        sdp_bytes: sdp.length,
        pending_ice_count: this.pendingRemoteCandidates.length,
      })
      this.rememberOfferTracks(sdp)
      await peer.setRemoteDescription({ type: 'offer', sdp })
      const candidates = this.pendingRemoteCandidates.splice(0)
      for (const candidate of candidates) {
        if (remoteDescriptionAcceptsCandidate(peer, candidate)) {
          await peer.addIceCandidate(toBrowserCandidate(candidate))
        }
      }

      const answer = await peer.createAnswer()
      await peer.setLocalDescription(answer)
      if (peer.localDescription?.sdp) {
        clientDiagnostics.record('webrtc', 'voice_answer_created', 'debug', {
          sdp_bytes: peer.localDescription.sdp.length,
        })
        this.options.onAnswer(peer.localDescription.sdp)
      }
    })

    this.offerQueue = operation.catch((error: unknown) => {
      if (!this.closed) this.options.onError(error instanceof Error ? error : new Error('Не удалось согласовать WebRTC-соединение'))
    })
    return this.offerQueue
  }

  async addICECandidate(candidate: VoiceICECandidate) {
    const peer = this.peer
    if (!peer || this.closed) return
    if (!remoteDescriptionAcceptsCandidate(peer, candidate)) {
      if (this.pendingRemoteCandidates.length < 64) this.pendingRemoteCandidates.push(candidate)
      clientDiagnostics.record('webrtc', 'voice_remote_ice_buffered', 'debug', {
        pending_ice_count: this.pendingRemoteCandidates.length,
      })
      return
    }

    try {
      await peer.addIceCandidate(toBrowserCandidate(candidate))
    } catch (error) {
      if (!this.closed) this.options.onError(error instanceof Error ? error : new Error('Не удалось добавить ICE-кандидат'))
    }
  }

  setState(selfMute: boolean, selfDeaf: boolean) {
    this.selfMute = selfMute
    this.selfDeaf = selfDeaf
    this.options.input.setState(!selfMute)
    if (selfMute) this.options.onInputLevel?.(0)
    this.remoteOutputs.forEach((output) => {
      output.audio.muted = selfDeaf
      if (!selfDeaf) this.playRemoteAudio(output, 'undeaf')
    })
  }

  resumeAudio() {
    if (this.analysis?.context.state === 'suspended') {
      void this.analysis.context.resume().catch(() => undefined)
    }
    if (!this.selfDeaf) {
      this.remoteOutputs.forEach((output) => {
        if (output.audio.paused) this.playRemoteAudio(output, 'user_interaction')
      })
    }
    this.options.input.resume()
  }

  close() {
    if (this.closed) return
    this.closed = true
    if (this.unsubscribeInput) this.unsubscribeInput()
    this.unsubscribeInput = null
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.visibilityHandler)
    }
    if (this.autoplayRetryHandler) {
      document.removeEventListener('pointerdown', this.autoplayRetryHandler)
      document.removeEventListener('keydown', this.autoplayRetryHandler)
      this.autoplayRetryHandler = null
    }
    this.autoplayRetryAttached = false
    clientDiagnostics.record('webrtc', 'voice_closed', 'info', {
      remote_track_count: this.remoteOutputs.size,
    })
    if (this.statsTimer !== null) window.clearInterval(this.statsTimer)
    this.statsTimer = null
    if (this.levelTimer !== null) window.clearInterval(this.levelTimer)
    this.levelTimer = null
    this.pendingRemoteCandidates = []
    Array.from(this.remoteAnalysers.keys()).forEach((trackId) => this.detachRemoteAnalyser(trackId))
    this.remoteAnalysers.clear()
    this.trackOwners.clear()
    this.midOwners.clear()
    void this.analysis?.context.close().catch(() => undefined)
    this.analysis = null
    // Deliberately NOT stopping the shared input: it is owned by
    // BrowserVoiceInput and may outlive this peer (signalling recovery).
    this.remoteOutputs.forEach((output, trackId) => {
      output.track.stop()
      this.removeRemoteOutput(trackId, output)
    })
    this.remoteOutputs.clear()
    this.peer?.close()
    this.inputSender = null
    this.peer = null
    this.options.onInputLevel?.(0)
    this.options.onConnectionStateChange('closed')
  }
}

export async function enumerateVoiceDevices(requestPermission = false): Promise<MediaDeviceInfo[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return []
  let temporary: MediaStream | null = null
  try {
    if (requestPermission) temporary = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
    return await navigator.mediaDevices.enumerateDevices()
  } finally {
    temporary?.getTracks().forEach((track) => track.stop())
  }
}

export function voiceErrorMessage(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError' || error.name === 'SecurityError') return 'Разрешите Voxhold доступ к микрофону в настройках браузера'
    if (error.name === 'NotFoundError' || error.name === 'OverconstrainedError') return 'Выбранный микрофон не найден. Подключите устройство или выберите другое'
    if (error.name === 'NotReadableError' || error.name === 'AbortError') return 'Микрофон занят другим приложением или недоступен'
  }
  if (error instanceof Error && error.message) return error.message
  return 'Не удалось подключиться к голосовому каналу'
}

export function voiceCloseMessage(reason: string): string {
  if (reason === 'voice session moved to another connection') {
    return 'Голосовое подключение перенесено в другую вкладку или устройство'
  }
  if (reason === 'audio bitrate limit exceeded') {
    return 'Голосовое подключение остановлено: превышен разрешённый сервером битрейт микрофона'
  }

  return reason || 'Сервер завершил голосовое соединение'
}
