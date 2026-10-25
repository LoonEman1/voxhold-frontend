import { describe, expect, it } from 'vitest'
import { colorFor, formatDuration, initials, viewerLabel } from './format'

describe('display helpers', () => {
  it('creates stable short initials', () => {
    expect(initials('niko')).toBe('NI')
    expect(initials('')).toBe('VX')
  })

  it('formats live durations', () => {
    expect(formatDuration(0)).toBe('0:00')
    expect(formatDuration(65_400)).toBe('1:05')
    expect(formatDuration(3_726_000)).toBe('1:02:06')
    expect(formatDuration(-5_000)).toBe('0:00')
  })

  it('declines viewer counts', () => {
    expect(viewerLabel(0)).toBe('пока без зрителей')
    expect(viewerLabel(1)).toBe('1 зритель')
    expect(viewerLabel(3)).toBe('3 зрителя')
    expect(viewerLabel(5)).toBe('5 зрителей')
    expect(viewerLabel(12)).toBe('12 зрителей')
    expect(viewerLabel(21)).toBe('21 зритель')
  })

  it('creates deterministic supported colors', () => {
    expect(colorFor('mira')).toBe(colorFor('mira'))
    expect(['violet', 'lime', 'coral', 'cyan', 'amber']).toContain(colorFor('mira'))
  })
})
