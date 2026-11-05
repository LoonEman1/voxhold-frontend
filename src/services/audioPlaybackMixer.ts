import { clientDiagnostics } from '../platform/clientDiagnostics'

interface Output {
  input: MediaStream
  source: MediaStreamAudioSourceNode
  gain: GainNode
  destination: MediaStreamAudioDestinationNode
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
        const context = this.context ?? new AudioContext({ latencyHint: 'interactive' })
        this.context = context
        source = context.createMediaStreamSource(input)
        gain = context.createGain()
        destination = context.createMediaStreamDestination()
        source.connect(gain); gain.connect(destination)
        output = { input, source, gain, destination }
        this.outputs.set(audio, output)
        audio.srcObject = destination.stream
        const active = output
        void audio.play().catch(() => { if (this.outputs.get(audio) === active) this.onBlocked() })
      } catch (error) {
        this.outputs.delete(audio)
        source?.disconnect(); gain?.disconnect(); destination?.stream.getTracks().forEach((track) => track.stop())
        if (!this.outputs.size) { void this.context?.close().catch(() => undefined); this.context = null }
        audio.srcObject = input; audio.volume = Math.min(1, value)
        clientDiagnostics.record('media', 'playback_gain_failed', 'warn', { error_name: error instanceof Error ? error.name : 'Error' })
        return
      }
    }
    output.gain.gain.setTargetAtTime(value, this.context!.currentTime, 0.01)
    audio.volume = 1
    this.resume()
  }

  resume() {
    const context = this.context
    if (context?.state === 'suspended') void context.resume().catch(() => { if (this.context === context) this.onBlocked() })
  }

  remove(audio: HTMLMediaElement) {
    const output = this.outputs.get(audio)
    if (!output) return
    this.outputs.delete(audio)
    output.source.disconnect(); output.gain.disconnect()
    output.destination.stream.getTracks().forEach((track) => track.stop())
    if (!this.outputs.size) { void this.context?.close().catch(() => undefined); this.context = null }
  }

  close() { for (const audio of this.outputs.keys()) this.remove(audio) }
}
