// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import {
  applyStreamPreset,
  matchingStreamPreset,
  DEFAULT_STREAM_PREFERENCES,
  loadStreamPreferences,
  normalizeStreamPreferences,
  saveStreamPreferences,
} from './streamSettings'

describe('stream preferences', () => {
  beforeEach(() => localStorage.clear())

  it('persists supported high quality settings', () => {
    saveStreamPreferences({
      mode: 'p2p',
      codec: 'av1',
      dynamicRange: 'hdr',
      content: 'motion',
      resolution: '1440p',
      frameRate: 60,
      videoBitrateKbps: 12000,
      includeAudio: true,
      audioBitrateKbps: 320,
      playbackVolume: 37,
    })
    expect(loadStreamPreferences()).toEqual({
      mode: 'p2p',
      codec: 'av1',
      dynamicRange: 'hdr',
      content: 'motion',
      resolution: '1440p',
      frameRate: 60,
      videoBitrateKbps: 12000,
      includeAudio: true,
      audioBitrateKbps: 320,
      playbackVolume: 37,
    })
  })

  it('applies content presets without touching resolution or transport', () => {
    const base = { ...DEFAULT_STREAM_PREFERENCES, resolution: '1440p' as const, mode: 'p2p' as const }
    const games = applyStreamPreset(base, 'games')

    expect(games).toMatchObject({ content: 'motion', frameRate: 60, videoBitrateKbps: 12000, resolution: '1440p', mode: 'p2p' })
    expect(matchingStreamPreset(games)).toBe('games')
    expect(matchingStreamPreset(DEFAULT_STREAM_PREFERENCES)).toBe('desktop')
    expect(matchingStreamPreset({ ...games, videoBitrateKbps: 4500 })).toBeNull()
  })

  it('rejects values outside client presets', () => {
    expect(normalizeStreamPreferences({
      mode: 'unknown',
      content: 'cinema',
      resolution: '4k',
      frameRate: 144,
      videoBitrateKbps: 50000,
      audioBitrateKbps: 1000,
    })).toEqual(DEFAULT_STREAM_PREFERENCES)
  })
})
