import { noiseGateOpenLevel, normalizeVoicePreferences, type VoicePreferences } from './voiceSettings'
import { clientDiagnostics } from '../platform/clientDiagnostics'

export interface VoiceInputChain {
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

export interface BrowserVoiceInputOptions {
  onLevel?: (level: number) => void
  /** Reacquire failed after device loss: sending is disabled until retry(). */
  onUnavailable?: () => void
  /** A new working track replaced the previous one (device restored/retry). */
  onReplaced?: (track: MediaStreamTrack) => void
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

export function needsNewInput(previous: VoicePreferences, next: VoicePreferences) {
  return previous.inputDeviceId !== next.inputDeviceId
    || previous.autoGainControl !== next.autoGainControl
    || previous.echoCancellation !== next.echoCancellation
    || previous.noiseSuppression !== next.noiseSuppression
    || previous.noiseSuppressionMode !== next.noiseSuppressionMode
}

/**
 * Owns the microphone capture chain (getUserMedia, Web Audio graph, software
 * noise gate, meter) independently of any RTCPeerConnection so that a voice
 * session can be recreated after signalling loss without a new permission
 * gesture, and an unplugged device can be reacquired without leaving the
 * voice channel.
 */
export class BrowserVoiceInput {
  private chain: VoiceInputChain | null = null
  private preferences: VoicePreferences | null = null
  private enabled = true
  private closed = false
  private closedOnce = false
  private queue: Promise<unknown> = Promise.resolve()
  private reacquireQueued = false
  private readonly replacementListeners = new Set<(track: MediaStreamTrack) => void>()
  private noiseGateThresholdPercent: number | null = null
  private noiseGateOpen = true
  private readonly deviceChangeHandler = () => { this.scheduleReacquire('devicechange') }
  private readonly rawTrackEndedHandler = () => { this.scheduleReacquire('track_ended') }
  private listeningForDeviceChanges = false

  constructor(private readonly options: BrowserVoiceInputOptions = {}) {}

  get isHealthy() {
    const track = this.chain?.track
    return !!track && track.readyState === 'live'
  }

  currentTrack() {
    return this.chain?.track ?? null
  }

  currentStream() {
    return this.chain?.stream ?? null
  }

  /** Subscribes to track replacements. Returns an unsubscribe function. */
  subscribe(listener: (track: MediaStreamTrack) => void) {
    this.replacementListeners.add(listener)
    return () => { this.replacementListeners.delete(listener) }
  }

  async start(preferences: VoicePreferences) {
    if (this.closed) throw new Error('Voice input is closed')
    if (this.chain) return
    const normalized = normalizeVoicePreferences(preferences)
    this.preferences = normalized
    this.noiseGateThresholdPercent = normalized.noiseSuppressionMode === 'threshold'
      ? normalized.noiseGateThreshold
      : null
    this.noiseGateOpen = true
    const chain = await this.createChain(normalized)
    if (this.closed) {
      this.disposeChain(chain)
      return
    }
    this.attachLifecycleListeners(chain)
    this.chain = chain
    chain.track.enabled = this.enabled
    clientDiagnostics.record('media', 'voice_input_ready', 'info', {
      sample_rate: chain.track.getSettings?.().sampleRate ?? null,
      selected_input: !!normalized.inputDeviceId,
    })
  }

  /** Reflects the desired mute state onto the current track. */
  setState(enabled: boolean) {
    this.enabled = enabled
    if (this.chain) this.chain.track.enabled = enabled
  }

  /** Resumes the processing AudioContext after autoplay/visibility blocks. */
  resume() {
    const context = this.chain?.context
    if (context && context.state === 'suspended') void context.resume().catch(() => undefined)
  }

  applyPreferences(value: VoicePreferences): Promise<void> {
    const operation = this.queue.then(async () => {
      if (this.closed) return
      const next = normalizeVoicePreferences(value)
      const previous = this.preferences ?? next
      this.preferences = next
      if (next.noiseSuppressionMode === 'threshold') {
        if (this.noiseGateThresholdPercent === null) {
          this.noiseGateOpen = true
          if (this.chain?.gate) this.chain.gate.gain.value = 1
        }
        this.noiseGateThresholdPercent = next.noiseGateThreshold
      } else {
        this.noiseGateThresholdPercent = null
        this.noiseGateOpen = true
      }
      if (this.chain?.gain) this.chain.gain.gain.value = next.inputVolume / 100
      if (!this.chain || !needsNewInput(previous, next)) return
      await this.replaceChain(next)
    })
    this.queue = operation.catch(() => undefined)
    return operation
  }

  /**
   * Serialized reacquire after device loss: try the selected exact device
   * first, then fall back to the default input. The old working chain is kept
   * until a replacement exists; if both attempts fail the sender receives a
   * disabled ended track via onUnavailable and remote playback continues.
   */
  retry(): Promise<void> {
    const operation = this.queue.then(async () => {
      if (this.closed) return
      const preferences = this.preferences
      if (!preferences) return
      // First attempt: the currently selected device.
      if (await this.tryRebuild(preferences)) return
      // Second attempt: default input without the exact deviceId constraint.
      if (await this.tryRebuild({ ...preferences, inputDeviceId: '' })) return
      clientDiagnostics.record('media', 'voice_input_unavailable', 'error')
      this.enabled = true
      if (this.chain) this.chain.track.enabled = false
      this.options.onUnavailable?.()
    })
    this.queue = operation.catch(() => undefined)
    return operation
  }

  /** Stops the microphone exactly once. Only the owner/coordinator calls this. */
  close() {
    if (this.closedOnce) return
    this.closedOnce = true
    this.closed = true
    this.replacementListeners.clear()
    this.stopDeviceListener()
    const chain = this.chain
    this.chain = null
    if (chain) this.disposeChain(chain)
    this.options.onLevel?.(0)
  }

  private scheduleReacquire(reason: string) {
    if (this.closed || this.reacquireQueued || !this.preferences) return
    if (!this.chain) return
    this.reacquireQueued = true
    clientDiagnostics.record('media', 'voice_input_reacquire_scheduled', 'warn', { reason })
    const operation = this.queue.then(async () => {
      this.reacquireQueued = false
      if (this.closed || !this.preferences) return
      if (this.isHealthy && reason === 'devicechange') return
      await this.retry()
    })
    this.queue = operation.catch(() => undefined)
  }

  private async tryRebuild(preferences: VoicePreferences) {
    try {
      await this.replaceChain(preferences)
      clientDiagnostics.record('media', 'voice_input_reacquired', 'info', {
        selected_input: !!preferences.inputDeviceId,
      })
      return true
    } catch {
      return false
    }
  }

  private async replaceChain(preferences: VoicePreferences) {
    const replacement = await this.createChain(preferences)
    if (this.closed) {
      this.disposeChain(replacement)
      return
    }
    const previous = this.chain
    this.attachLifecycleListeners(replacement)
    this.chain = replacement
    replacement.track.enabled = this.enabled
    this.emitReplaced(replacement.track)
    if (previous) this.disposeChain(previous)
  }

  private emitReplaced(track: MediaStreamTrack) {
    this.replacementListeners.forEach((listener) => listener(track))
  }

  private attachLifecycleListeners(chain: VoiceInputChain) {
    chain.raw.getAudioTracks().forEach((track) => {
      track.addEventListener('ended', this.rawTrackEndedHandler)
    })
    this.ensureDeviceListener()
  }

  private ensureDeviceListener() {
    if (this.listeningForDeviceChanges) return
    if (!navigator.mediaDevices?.addEventListener) return
    this.listeningForDeviceChanges = true
    navigator.mediaDevices.addEventListener('devicechange', this.deviceChangeHandler)
  }

  private stopDeviceListener() {
    if (!this.listeningForDeviceChanges) return
    this.listeningForDeviceChanges = false
    navigator.mediaDevices?.removeEventListener?.('devicechange', this.deviceChangeHandler)
  }

  private createChain(preferences: VoicePreferences): Promise<VoiceInputChain> {
    return navigator.mediaDevices.getUserMedia({
      audio: inputConstraints(preferences),
      video: false,
    }).then(async (raw) => {
      const rawTrack = raw.getAudioTracks()[0]
      if (!rawTrack) {
        raw.getTracks().forEach((track) => track.stop())
        throw new Error('Микрофон не передал аудиодорожку')
      }

      if (typeof AudioContext === 'undefined') {
        return {
          raw, stream: raw, track: rawTrack, context: null, gate: null,
          gateAnalyser: null, gain: null, analyser: null, meterTimer: null,
        }
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
        const chain: VoiceInputChain = {
          raw, stream: destination.stream, track, context, gate, gateAnalyser,
          gain, analyser, meterTimer: null,
        }
        this.startMeter(chain)
        return chain
      } catch (error) {
        void context?.close().catch(() => undefined)
        raw.getTracks().forEach((track) => track.stop())
        throw error
      }
    })
  }

  private startMeter(chain: VoiceInputChain) {
    if (!chain.analyser || !this.options.onLevel) return
    const values = new Uint8Array(chain.analyser.fftSize)
    const gateValues = chain.gateAnalyser ? new Uint8Array(chain.gateAnalyser.fftSize) : null
    chain.meterTimer = window.setInterval(() => {
      // The gate reacts to the pre-gain signal so a closed gate never silences
      // the meter permanently.
      const analyser = (gateValues && chain.gateAnalyser) ? chain.gateAnalyser : chain.analyser
      const buffer = gateValues && chain.gateAnalyser ? gateValues : values!
      if (this.closed || !analyser) return
      analyser.getByteTimeDomainData(buffer)
      let energy = 0
      for (const value of buffer) {
        const normalized = (value - 128) / 128
        energy += normalized * normalized
      }
      const level = Math.min(1, Math.sqrt(energy / buffer.length) * 4.5)
      this.applyNoiseGate(chain, level)
      this.options.onLevel?.(this.enabled ? level : 0)
    }, 90)
  }

  private applyNoiseGate(chain: VoiceInputChain, level: number) {
    const thresholdPercent = this.noiseGateThresholdPercent
    if (!chain.gate || !chain.context || thresholdPercent === null) return
    const openLevel = noiseGateOpenLevel(thresholdPercent)
    // Hysteresis keeps the gate from chattering when speech sits at the bar.
    if (!this.noiseGateOpen && level > openLevel + 0.02) this.noiseGateOpen = true
    else if (this.noiseGateOpen && level < openLevel - 0.02) this.noiseGateOpen = false
    const now = chain.context.currentTime
    chain.gate.gain.setTargetAtTime(this.noiseGateOpen ? 1 : 0, now, this.noiseGateOpen ? 0.02 : 0.18)
  }

  private disposeChain(chain: VoiceInputChain | null) {
    if (!chain) return
    if (chain.meterTimer !== null) window.clearInterval(chain.meterTimer)
    chain.raw.getAudioTracks().forEach((track) => {
      track.removeEventListener('ended', this.rawTrackEndedHandler)
      track.stop()
    })
    if (chain.stream !== chain.raw) chain.stream.getTracks().forEach((track) => track.stop())
    void chain.context?.close().catch(() => undefined)
  }
}
