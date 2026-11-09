import { clientDiagnostics } from '../platform/clientDiagnostics'

interface Output {
  input: MediaStream
  source: MediaStreamAudioSourceNode
  gain: GainNode
  destination: MediaStreamAudioDestinationNode
  inputAudio: HTMLAudioElement
  volume: number
}

/** A shared Web Audio context boosts playback while audio elements keep sink selection and mute. */
export class AudioPlaybackMixer {
  private context: AudioContext | null = null
  private outputs = new Map<HTMLMediaElement, Output>()
  constructor(private readonly onBlocked: () => void = () => undefined) {}

  setVolume(audio: HTMLMediaElement, input: MediaStream, multiplier: number) {
    const value = Math.max(0, Math.min(4, Number.isFinite(multiplier) ? multiplier : 1))
    let output = this.outputs.get(audio)
    if (output && output.input !== input) { this.remove(audio); output = undefined }
    if (!input.getAudioTracks().length) { this.remove(audio); audio.srcObject = input; audio.volume = Math.min(1, value); return }
    if (!output && value <= 1) {
      if (audio.srcObject !== input) audio.srcObject = input
      audio.volume = value
      return
    }
    if (!output) {
      let source: MediaStreamAudioSourceNode | null = null, gain: GainNode | null = null, destination: MediaStreamAudioDestinationNode | null = null
      try {
        const context = this.context ?? this.createContext()
        source = context.createMediaStreamSource(input)
        gain = context.createGain()
        destination = context.createMediaStreamDestination()
        source.connect(gain); gain.connect(destination)
        // Chromium can stop delivering remote audio when no media element plays the original stream.
        const inputAudio = document.createElement('audio')
        inputAudio.muted = true
        inputAudio.srcObject = input
        const playing = inputAudio.play()
        const active = { input, source, gain, destination, inputAudio, volume: value }
        output = active
        this.outputs.set(audio, active)
        void playing.catch((error: unknown) => this.fallbackToInput(audio, active, error))
      } catch (error) {
        source?.disconnect(); gain?.disconnect(); destination?.stream.getTracks().forEach((track) => track.stop())
        if (!this.outputs.size) this.closeContext()
        if (audio.srcObject !== input) audio.srcObject = input
        audio.volume = Math.min(1, value)
        this.recordGainFailure(error)
        return
      }
    }
    output.volume = value
    output.gain.gain.setTargetAtTime(value, this.context!.currentTime, 0.01)
    this.applyOutput(audio, output)
    this.resume()
  }

  private createContext() {
    const context = new AudioContext({ latencyHint: 'interactive' })
    this.context = context
    const recordInactive = () => {
      if (context.state !== 'running') {
        clientDiagnostics.record('media', 'playback_gain_context_inactive', 'info', { state: context.state })
      }
    }
    context.onstatechange = () => {
      if (this.context !== context) return
      recordInactive()
      this.outputs.forEach((output, audio) => this.applyOutput(audio, output))
    }
    recordInactive()
    return context
  }

  private applyOutput(audio: HTMLMediaElement, output: Output) {
    // Keep the incoming stream audible while Web Audio is waiting for permission or interrupted.
    const processed = output.destination.stream
    const useGain = this.context?.state === 'running' && (output.volume > 1 || audio.srcObject === processed)
    const stream = useGain ? processed : output.input
    audio.volume = useGain ? 1 : Math.min(1, output.volume)
    if (audio.srcObject === stream) return
    audio.srcObject = stream
    void audio.play().catch((error: unknown) => {
      if (this.outputs.get(audio) !== output || audio.srcObject !== stream) return
      if (!useGain) {
        this.onBlocked()
        return
      }
      this.fallbackToInput(audio, output, error)
    })
  }

  private fallbackToInput(audio: HTMLMediaElement, output: Output, error: unknown) {
    if (this.outputs.get(audio) !== output) return
    this.recordGainFailure(error)
    this.remove(audio)
    const switched = audio.srcObject !== output.input
    if (switched) audio.srcObject = output.input
    audio.volume = Math.min(1, output.volume)
    if (switched || audio.paused) void audio.play().catch(() => { if (audio.srcObject === output.input) this.onBlocked() })
  }

  private recordGainFailure(error: unknown) {
    clientDiagnostics.record('media', 'playback_gain_failed', 'warn', { error_name: error instanceof Error ? error.name : 'Error' })
  }

  resume() {
    const context = this.context
    if (context && context.state !== 'running' && context.state !== 'closed') {
      void context.resume().catch((error: unknown) => { if (this.context === context) this.recordGainFailure(error) })
    }
  }

  remove(audio: HTMLMediaElement) {
    const output = this.outputs.get(audio)
    if (!output) return
    this.outputs.delete(audio)
    output.inputAudio.pause()
    output.inputAudio.srcObject = null
    output.source.disconnect(); output.gain.disconnect()
    output.destination.stream.getTracks().forEach((track) => track.stop())
    if (!this.outputs.size) this.closeContext()
  }

  private closeContext() {
    const context = this.context
    if (!context) return
    this.context = null
    context.onstatechange = null
    void context.close().catch(() => undefined)
  }

  close() { for (const audio of this.outputs.keys()) this.remove(audio) }
}
