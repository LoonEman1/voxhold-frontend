/** Sample-clock gate: UI timers never decide whether speech is transmitted. */
export class VoiceGateDSP {
  private gain = 0
  private holdSamples = 0

  process(input: Float32Array, output: Float32Array, sampleRate: number, threshold: number) {
    let energy = 0
    for (const sample of input) energy += sample * sample
    const level = Math.min(1, Math.sqrt(energy / Math.max(1, input.length)) * 4.5)
    const open = threshold <= 0 || level > threshold + 0.02
    if (open) this.holdSamples = Math.round(sampleRate * 0.18)
    else if (level < Math.max(0, threshold - 0.02)) this.holdSamples = Math.max(0, this.holdSamples - input.length)
    const target = open || this.holdSamples > 0 ? 1 : 0
    const coefficient = 1 - Math.exp(-1 / (sampleRate * (target ? 0.003 : 0.06)))
    for (let index = 0; index < output.length; index += 1) {
      this.gain += (target - this.gain) * coefficient
      output[index] = (input[index] ?? 0) * this.gain
    }
    return level
  }
}
