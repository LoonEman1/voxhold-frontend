import { describe, expect, it } from 'vitest'
import { VoiceGateDSP } from './voiceGateDSP'

describe('sample-clock microphone gate', () => {
  it('opens within an audio block and holds quiet speech tails without UI timers', () => {
    const gate = new VoiceGateDSP()
    const output = new Float32Array(128)
    gate.process(new Float32Array(128).fill(0.2), output, 48_000, 0.15)
    expect(output[127]).toBeGreaterThan(0.1)
    const quiet = new Float32Array(128).fill(0.01)
    for (let block = 0; block < 40; block += 1) gate.process(quiet, output, 48_000, 0.15)
    expect(output[127]).toBeGreaterThan(0.009)
    for (let block = 0; block < 300; block += 1) gate.process(quiet, output, 48_000, 0.15)
    expect(output[127]).toBeLessThan(0.0001)
  })

  it('suppresses background noise and passes it when the threshold is disabled', () => {
    const gate = new VoiceGateDSP()
    const input = new Float32Array(128).fill(0.01)
    const output = new Float32Array(128)
    for (let block = 0; block < 50; block += 1) gate.process(input, output, 48_000, 0.15)
    expect(output[127]).toBe(0)
    for (let block = 0; block < 50; block += 1) gate.process(input, output, 48_000, 0)
    expect(output[127]).toBeCloseTo(0.01, 5)
  })
})
