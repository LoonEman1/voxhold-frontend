import { describe, expect, it, vi } from 'vitest'
import { UI_SOUND_SPECS, UISoundPlayer } from './uiSounds'

function fakeContext() {
  const oscillators: Array<{ frequency: { value: number }; start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }> = []
  const gains: Array<{ gain: { value: number } }> = []
  const param = () => ({ value: 0, setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() })
  const context = {
    state: 'running',
    currentTime: 10,
    destination: {},
    resume: vi.fn(async () => undefined),
    setSinkId: vi.fn(async () => undefined),
    createGain: vi.fn(() => {
      const node = { gain: param(), connect: vi.fn() }
      gains.push(node)
      return node
    }),
    createOscillator: vi.fn(() => {
      const node = { type: '', frequency: { value: 0 }, connect: vi.fn(), start: vi.fn(), stop: vi.fn() }
      oscillators.push(node)
      return node
    }),
  }
  return { context, oscillators, gains }
}

describe('UISoundPlayer', () => {
  it('schedules the tones of a cue at the requested volume', () => {
    const { context, oscillators, gains } = fakeContext()
    const player = new UISoundPlayer(() => context as unknown as AudioContext)

    player.play('self_join', 50)

    const spec = UI_SOUND_SPECS.self_join
    expect(oscillators.map((item) => item.frequency.value)).toEqual(spec.tones.map((tone) => tone.frequency))
    expect(oscillators[0]?.start).toHaveBeenCalledWith(10.01)
    expect(gains[0]?.gain.value).toBeCloseTo(spec.gain * 0.5)
  })

  it('stays silent at zero volume and routes to the selected output once', () => {
    const { context } = fakeContext()
    const player = new UISoundPlayer(() => context as unknown as AudioContext)

    player.play('mute', 0, 'speakers')
    expect(context.createOscillator).not.toHaveBeenCalled()

    player.play('mute', 80, 'speakers')
    player.play('unmute', 80, 'speakers')
    expect(context.setSinkId).toHaveBeenCalledOnce()
    expect(context.setSinkId).toHaveBeenCalledWith('speakers')
  })

  it('uses rising tones for on/in and falling tones for off/out', () => {
    const rises = (sound: keyof typeof UI_SOUND_SPECS) => {
      const tones = UI_SOUND_SPECS[sound].tones
      return (tones.at(-1)?.frequency ?? 0) > (tones[0]?.frequency ?? 0)
    }
    expect(['self_join', 'user_join', 'unmute', 'undeafen'].every((sound) => rises(sound as keyof typeof UI_SOUND_SPECS))).toBe(true)
    expect(['self_leave', 'user_leave', 'mute', 'deafen'].some((sound) => rises(sound as keyof typeof UI_SOUND_SPECS))).toBe(false)
  })
})
