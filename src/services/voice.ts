import type { VoiceICECandidate } from '../domain/types'
import { normalizeVoicePreferences, type VoicePreferences } from './voiceSettings'
import { remoteDescriptionAcceptsCandidate } from './webrtcRecovery'
import { wireICECandidate } from './webrtcCandidate'
import { clientDiagnostics } from '../platform/clientDiagnostics'

export type VoiceMediaConnectionState = 'new' | 'connecting' | 'connected' | 'disconnected' | 'failed' | 'closed'

interface VoiceMediaOptions {
  onAnswer: (sdp: string) => void
  onICECandidate: (candidate: VoiceICECandidate) => void
  onConnectionStateChange: (state: VoiceMediaConnectionState) => void
  onError: (error: Error) => void
  onInputLevel?: (level: number) => void
}

interface VoiceInputChain {
  raw: MediaStream
  stream: MediaStream
  track: MediaStreamTrack
  context: AudioContext | null
  gain: GainNode | null
  analyser: AnalyserNode | null
  meterTimer: number | null
}

interface VoiceRemoteOutput {
  stream: MediaStream
  track: MediaStreamTrack
  audio: HTMLAudioElement
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

function browserICEConfiguration(): RTCConfiguration {
  const urls = (import.meta.env.VITE_WEBRTC_ICE_SERVERS as string | undefined)
    ?.split(',')
    .map((url) => url.trim())
    .filter(Boolean)

  if (!urls?.length) return {}

  const username = (import.meta.env.VITE_WEBRTC_ICE_USERNAME as string | undefined)?.trim()
  const credential = (import.meta.env.VITE_WEBRTC_ICE_CREDENTIAL as string | undefined)?.trim()
  return {
    iceServers: [{
      urls,
      ...(username && credential ? { username, credential } : {}),
    }],
  }
}

function toBrowserCandidate(candidate: VoiceICECandidate): RTCIceCandidateInit {
  return {
    candidate: candidate.candidate,
    sdpMid: candidate.sdp_mid ?? null,
    sdpMLineIndex: candidate.sdp_mline_index ?? null,
    usernameFragment: candidate.username_fragment ?? null,
  }
}

function inputConstraints(preferences: VoicePreferences): MediaTrackConstraints {
  return {
    ...(preferences.inputDeviceId ? { deviceId: { exact: preferences.inputDeviceId } } : {}),
    autoGainControl: preferences.autoGainControl,
    echoCancellation: preferences.echoCancellation,
    noiseSuppression: preferences.noiseSuppression,
    channelCount: 1,
  }
}

function needsNewInput(previous: VoicePreferences, next: VoicePreferences) {
  return previous.inputDeviceId !== next.inputDeviceId
    || previous.autoGainControl !== next.autoGainControl
    || previous.echoCancellation !== next.echoCancellation
    || previous.noiseSuppression !== next.noiseSuppression
}

export class BrowserVoiceSession {
  private peer: RTCPeerConnection | null = null
  private input: VoiceInputChain | null = null
  private inputSender: RTCRtpSender | null = null
  private readonly remoteOutputs = new Map<string, VoiceRemoteOutput>()
  private preferences: VoicePreferences | null = null
  private pendingRemoteCandidates: VoiceICECandidate[] = []
  private offerQueue: Promise<void> = Promise.resolve()
  private inputQueue: Promise<void> = Promise.resolve()
  private statsTimer: number | null = null
  private statsSampling = false
  private closed = false
  private selfMute = false
  private selfDeaf = false
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
    clientDiagnostics.record('webrtc', 'voice_starting', 'info', {
      self_mute: selfMute,
      self_deaf: selfDeaf,
      bitrate_kbps: this.preferences.bitrateKbps,
      selected_input: !!this.preferences.inputDeviceId,
      selected_output: !!this.preferences.outputDeviceId,
    })
    const input = await this.createInput(this.preferences)

    if (this.closed) {
      this.disposeInput(input)
      return
    }

    const peer = new RTCPeerConnection(browserICEConfiguration())
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

    peer.ontrack = ({ track }) => {
      if (this.closed || track.kind !== 'audio' || this.remoteOutputs.has(track.id)) return
      const stream = new MediaStream([track])
      const audio = document.createElement('audio')
      audio.autoplay = true
      audio.muted = this.selfDeaf
      audio.volume = this.preferences?.outputVolume !== undefined
        ? this.preferences.outputVolume / 100
        : 1
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
      return { raw, stream: raw, track: rawTrack, context: null, gain: null, analyser: null, meterTimer: null }
    }

    let context: AudioContext | null = null
    try {
      context = new AudioContext({ latencyHint: 'interactive' })
      const source = context.createMediaStreamSource(raw)
      const gain = context.createGain()
      const analyser = context.createAnalyser()
      const destination = context.createMediaStreamDestination()
      gain.gain.value = preferences.inputVolume / 100
      analyser.fftSize = 256
      analyser.smoothingTimeConstant = 0.72
      source.connect(gain)
      gain.connect(analyser)
      analyser.connect(destination)
      if (context.state === 'suspended') await context.resume()

      const track = destination.stream.getAudioTracks()[0]
      if (!track) throw new Error('Не удалось подготовить аудиодорожку')
      const chain: VoiceInputChain = { raw, stream: destination.stream, track, context, gain, analyser, meterTimer: null }
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
    input.meterTimer = window.setInterval(() => {
      if (this.closed || !input.analyser) return
      input.analyser.getByteTimeDomainData(values)
      let energy = 0
      for (const value of values) {
        const normalized = (value - 128) / 128
        energy += normalized * normalized
      }
      const rms = Math.sqrt(energy / values.length)
      this.options.onInputLevel?.(this.selfMute ? 0 : Math.min(1, rms * 4.5))
    }, 90)
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
    output.audio.pause()
    output.audio.srcObject = null
    output.audio.remove()
    output.stream.removeTrack(output.track)
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
    this.remoteOutputs.forEach(({ audio }) => { audio.volume = next.outputVolume / 100 })
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
    this.pendingRemoteCandidates = []
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
