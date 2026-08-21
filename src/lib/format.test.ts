import { describe, expect, it } from 'vitest'
import { colorFor, initials } from './format'

describe('display helpers', () => {
  it('creates stable short initials', () => {
    expect(initials('niko')).toBe('NI')
    expect(initials('')).toBe('VX')
  })

  it('creates deterministic supported colors', () => {
    expect(colorFor('mira')).toBe(colorFor('mira'))
    expect(['violet', 'lime', 'coral', 'cyan', 'amber']).toContain(colorFor('mira'))
  })
})
