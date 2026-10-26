import { VoiceGateDSP } from './voiceGateDSP'

declare const sampleRate: number
declare class AudioWorkletProcessor {
  readonly port: MessagePort
}
declare function registerProcessor(name: string, processor: typeof VoiceGateProcessor): void

class VoiceGateProcessor extends AudioWorkletProcessor {
  private readonly gate = new VoiceGateDSP()
  private threshold = 0
  private samplesSinceReport = 0
  private peakLevel = 0
  private active = true

  constructor() {
    super()
    this.port.onmessage = ({ data }) => {
      if (data.type === 'close') this.active = false
      if (data.type === 'threshold') this.threshold = Math.min(1, Math.max(0, data.value))
    }
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]) {
    if (!this.active) return false
    const input = inputs[0]?.[0]
    const output = outputs[0]?.[0]
    if (!output) return true
    if (!input) { output.fill(0); return true }
    this.peakLevel = Math.max(this.peakLevel, this.gate.process(input, output, sampleRate, this.threshold))
    this.samplesSinceReport += input.length
    if (this.samplesSinceReport >= sampleRate * 0.09) {
      this.port.postMessage({ level: this.peakLevel })
      this.samplesSinceReport = 0
      this.peakLevel = 0
    }
    return true
  }
}

registerProcessor('voxhold-voice-gate', VoiceGateProcessor)
