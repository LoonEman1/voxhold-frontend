import type { VoiceICECandidate } from '../domain/types'
import { noiseGateOpenLevel, normalizeVoicePreferences, type VoicePreferences } from './voiceSettings'
import { remoteDescriptionAcceptsCandidate } from './webrtcRecovery'
import { wireICECandidate } from './webrtcCandidate'
import { clientDiagnostics } from '../platform/clientDiagnostics'
import { cloneRTCConfiguration } from './webrtcConfig'

export type VoiceMediaConnectionState = 'new' | 'connecting' | 'connected' | 'disconnected' | 'failed' | 'closed'

interface VoiceMediaOptions {
  /** Runtime ICE configuration loaded from the backend; empty means host-only. */
  iceConfiguration?: RTCConfiguration
  onAnswer: (sdp: string) => void
  onICECandidate: (candidate: VoiceICECandidate) => void
  onConnectionStateChange: (state: VoiceMediaConnectionState) => void
  onError: (error: Error) => void
  onInputLevel?: (level: number) => void
  onRemoteLevels?: (levels: VoiceRemoteLevel[]) => void
}

interface VoiceInputChain {
  raw: MediaStream
  stream: MediaStream
  track: MediaStreamTrack
  context: AudioContext | null
  gate: GainNode | null
  gateAnalyser: AnalyserNode | null
  gain: GainNode | null
  analyser: AnalyserNode | null
  meterTimer: number | null
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

export function inputConstraints(preferences: VoicePreferences): MediaTrackConstraints {
  return {
    ...(preferences.inputDeviceId ? { deviceId: { exact: preferences.inputDeviceId } } : {}),
    autoGainControl: preferences.autoGainControl,
    echoCancellation: preferences.echoCancellation,
    // In threshold mode the software gate below replaces browser processing.
    noiseSuppression: preferences.noiseSuppression && preferences.noiseSuppressionMode === 'auto',
    channelCount: 1,
  }
}

function needsNewInput(previous: VoicePreferences, next: VoicePreferences) {
  return previous.inputDeviceId !== next.inputDeviceId
    || previous.autoGainControl !== next.autoGainControl
    || previous.echoCancellation !== next.echoCancellation
    || previous.noiseSuppression !== next.noiseSuppression
    || previous.noiseSuppressionMode !== next.noiseSuppressionMode
}

export class BrowserVoiceSession {
  private peer: RTCPeerConnection | null = null
  private input: VoiceInputChain | null = null
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
  private inputQueue: Promise<void> = Promise.resolve()
  private statsTimer: number | null = null
  private statsSampling = false
  private closed = false
  private selfMute = false
  private selfDeaf = false
  // Software noise gate: null disables it, otherwise the threshold in the same
  // 0-100 scale shown on the input meter, plus hysteresis state.
  private noiseGateThresholdPercent: number | null = null
  private noiseGateOpen = true
  private autoplayRetryAttached = false
  private autoplayRetryHandler: (() => void) | null = null

  constructor(private readonly options: VoiceMediaOptions) {}

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

    this.selfMute = selfMute
    this.selfDeaf = selfDeaf
    this.preferences = normalizeVoicePreferences(preferences)
    this.noiseGateThresholdPercent = this.preferences.noiseSuppressionMode === 'threshold'
      ? this.preferences.noiseGateThreshold
      : null
    this.noiseGateOpen = true
    clientDiagnostics.record('webrtc', 'voice_starting', 'info', {
      self_mute: selfMute,
      self_deaf: selfDeaf,
      bitrate_kbps: this.preferences.bitrateKbps,
      selected_input: !!this.preferences.inputDeviceId,
      selected_output: !!this.preferences.outputDeviceId,
      noise_suppression_mode: this.preferences.noiseSuppressionMode,
      noise_gate_threshold: this.noiseGateThresholdPercent,
    })
    const input = await this.createInput(this.preferences)

    if (this.closed) {
      this.disposeInput(input)
      return
    }

    const peer = new RTCPeerConnection(
      this.options.iceConfiguration ? cloneRTCConfiguration(this.options.iceConfiguration) : {},
    )
    this.input = input
    this.peer = peer
    const inputSettings = input.track.getSettings?.() ?? {}
    clientDiagnostics.record('media', 'voice_input_ready', 'info', {
      sample_rate: inputSettings.sampleRate ?? null,
      channel_count: inputSettings.channelCount ?? null,
      echo_cancellation: inputSettings.echoCancellation ?? null,
      noise_suppression: inputSettings.noiseSuppression ?? null,
      auto_gain_control: inputSettings.autoGainControl ?? null,
    })
    input.track.enabled = !selfMute
    this.inputSender = peer.addTrack(input.track, input.stream)
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

    peer.ontrack = ({ track, transceiver }) => {
      if (this.closed || track.kind !== 'audio' || this.remoteOutputs.has(track.id)) return
      const connectionId = transceiver?.mid != null ? this.midOwners.get(transceiver.mid) : undefined
      if (connectionId) this.trackOwners.set(track.id, connectionId)
      const stream = new MediaStream([track])
      const audio = document.createElement('audio')
      audio.autoplay = true
      audio.muted = this.selfDeaf
      audio.volume = this.remoteAudioVolume(connectionId)
      audio.setAttribute('aria-hidden', 'true')
      audio.className = 'voice-audio-output'
      audio.srcObject = stream
      const output = { stream, track, audio }
      this.remoteOutputs.set(track.id, output)
      document.body.append(audio)
      clientDiagnostics.record('media', 'voice_remote_track_added', 'info', {
        track_id: track.id,
        muted: track.muted,
        ready_state: track.readyState,
        remote_track_count: this.remoteOutputs.size,
      })
      track.addEventListener('mute', () => {
        clientDiagnostics.record('media', 'voice_remote_track_muted', 'warn', { track_id: track.id })
      })
      track.addEventListener('unmute', () => {
        clientDiagnostics.record('media', 'voice_remote_track_unmuted', 'info', { track_id: track.id })
      })
      track.addEventListener('ended', () => {
        clientDiagnostics.record('media', 'voice_remote_track_ended', 'warn', { track_id: track.id })
        this.removeRemoteOutput(track.id, output)
      }, { once: true })
      void this.applyOutputDevice(this.preferences?.outputDeviceId ?? '', audio).catch(() => {
        // Keep the default output when the selected device disappeared.
      })
      this.attachRemoteAnalyser(track.id, stream)
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
    this.statsTimer = window.setInterval(() => { void this.sampleStats() }, 15_000)
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

  private attachRemoteAnalyser(trackId: string, stream: MediaStream) {
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
      const source = context.createMediaStreamSource(stream)
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
      if (this.input?.context?.state === 'suspended') {
        void this.input.context.resume().catch(() => undefined)
      }
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

  private async createInput(preferences: VoicePreferences): Promise<VoiceInputChain> {
    const raw = await navigator.mediaDevices.getUserMedia({
      audio: inputConstraints(preferences),
      video: false,
    })
    const rawTrack = raw.getAudioTracks()[0]
    if (!rawTrack) {
      raw.getTracks().forEach((track) => track.stop())
      throw new Error('Микрофон не передал аудиодорожку')
    }

    if (typeof AudioContext === 'undefined') {
      return { raw, stream: raw, track: rawTrack, context: null, gate: null, gateAnalyser: null, gain: null, analyser: null, meterTimer: null }
    }

    let context: AudioContext | null = null
    try {
      context = new AudioContext({ latencyHint: 'interactive' })
      const source = context.createMediaStreamSource(raw)
      const gating = preferences.noiseSuppressionMode === 'threshold'
      const gate = gating ? context.createGain() : null
      const gateAnalyser = gating ? context.createAnalyser() : null
      const gain = context.createGain()
      const analyser = context.createAnalyser()
      const destination = context.createMediaStreamDestination()
      if (gate) {
        // Starts closed so background noise never leaks before the first
        // metering tick opens it.
        gate.gain.value = 0
      }
      if (gateAnalyser) {
        gateAnalyser.fftSize = 256
        gateAnalyser.smoothingTimeConstant = 0.4
        source.connect(gateAnalyser)
      }
      gain.gain.value = preferences.inputVolume / 100
      analyser.fftSize = 256
      analyser.smoothingTimeConstant = 0.72
      source.connect(gate ?? gain)
      if (gate) gate.connect(gain)
      gain.connect(analyser)
      analyser.connect(destination)
      if (context.state === 'suspended') await context.resume()

      const track = destination.stream.getAudioTracks()[0]
      if (!track) throw new Error('Не удалось подготовить аудиодорожку')
      const chain: VoiceInputChain = { raw, stream: destination.stream, track, context, gate, gateAnalyser, gain, analyser, meterTimer: null }
      this.startInputMeter(chain)
      return chain
    } catch (error) {
      void context?.close().catch(() => undefined)
      raw.getTracks().forEach((track) => track.stop())
      throw error
    }
  }

  private startInputMeter(input: VoiceInputChain) {
    if (!input.analyser || !this.options.onInputLevel) return
    const values = new Uint8Array(input.analyser.fftSize)
    const gateValues = input.gateAnalyser ? new Uint8Array(input.gateAnalyser.fftSize) : null
    input.meterTimer = window.setInterval(() => {
      // The gate must react to the pre-gate signal, otherwise a closed gate
      // would silence the meter and never reopen.
      const analyser = (gateValues && input.gateAnalyser) ? input.gateAnalyser : input.analyser
      const buffer = gateValues && input.gateAnalyser ? gateValues : values!
      if (this.closed || !analyser) return
      analyser.getByteTimeDomainData(buffer)
      let energy = 0
      for (const value of buffer) {
        const normalized = (value - 128) / 128
        energy += normalized * normalized
      }
      const level = Math.min(1, Math.sqrt(energy / buffer.length) * 4.5)
      this.applyNoiseGate(input, level)
      this.options.onInputLevel?.(this.selfMute ? 0 : level)
    }, 90)
  }

  private applyNoiseGate(input: VoiceInputChain, level: number) {
    const thresholdPercent = this.noiseGateThresholdPercent
    if (!input.gate || !input.context || thresholdPercent === null) return
    const openLevel = noiseGateOpenLevel(thresholdPercent)
    // Hysteresis keeps the gate from chattering when speech sits at the bar.
    if (!this.noiseGateOpen && level > openLevel + 0.02) this.noiseGateOpen = true
    else if (this.noiseGateOpen && level < openLevel - 0.02) this.noiseGateOpen = false
    const now = input.context.currentTime
    input.gate.gain.setTargetAtTime(this.noiseGateOpen ? 1 : 0, now, this.noiseGateOpen ? 0.02 : 0.18)
  }

  private disposeInput(input: VoiceInputChain | null) {
    if (!input) return
    if (input.meterTimer !== null) window.clearInterval(input.meterTimer)
    input.raw.getTracks().forEach((track) => track.stop())
    if (input.stream !== input.raw) input.stream.getTracks().forEach((track) => track.stop())
    void input.context?.close().catch(() => undefined)
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
    await Promise.all(outputs.map((audio) => audio.setSinkId(deviceId)))
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
    // Threshold tweaks apply instantly; only mode/device changes rebuild input.
    if (next.noiseSuppressionMode === 'threshold') {
      if (this.noiseGateThresholdPercent === null) {
        this.noiseGateOpen = true
        if (this.input?.gate) this.input.gate.gain.value = 1
      }
      this.noiseGateThresholdPercent = next.noiseGateThreshold
    } else {
      this.noiseGateThresholdPercent = null
      this.noiseGateOpen = true
    }
    this.remoteOutputs.forEach((output, trackId) => { output.audio.volume = this.remoteAudioVolume(this.trackOwners.get(trackId)) })
    if (this.input?.gain) this.input.gain.gain.value = next.inputVolume / 100

    const operation = this.inputQueue.then(async () => {
      if (this.closed) return
      await this.applyOutputDevice(next.outputDeviceId)
      if (previous.bitrateKbps !== next.bitrateKbps) await this.applySenderBitrate(next.bitrateKbps)
      if (!this.peer || !this.inputSender || !needsNewInput(previous, next)) return

      const replacement = await this.createInput(next)
      if (this.closed) {
        this.disposeInput(replacement)
        return
      }
      replacement.track.enabled = !this.selfMute
      try {
        await this.inputSender.replaceTrack(replacement.track)
      } catch (error) {
        this.disposeInput(replacement)
        throw error
      }
      const old = this.input
      this.input = replacement
      this.disposeInput(old)
    })
    this.inputQueue = operation.catch(() => undefined)
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
    if (this.input) this.input.track.enabled = !selfMute
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
      this.remoteOutputs.forEach((output) => this.playRemoteAudio(output, 'user_interaction'))
    }
    if (this.input?.context?.state === 'suspended') void this.input.context.resume().catch(() => undefined)
  }

  close() {
    if (this.closed) return
    this.closed = true
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
    this.disposeInput(this.input)
    this.remoteOutputs.forEach((output, trackId) => {
      output.track.stop()
      this.removeRemoteOutput(trackId, output)
    })
    this.remoteOutputs.clear()
    this.peer?.close()
    this.input = null
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
