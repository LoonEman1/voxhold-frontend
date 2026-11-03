// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import {
  applyStreamPreset,
  matchingStreamPreset,
  DEFAULT_STREAM_PREFERENCES,
  loadStreamPreferences,
  normalizeStreamPreferences,
  normalizeStreamVideoBitrate,
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
      publishVolume: 175,
      playbackMuted: false,
      playbackVolume: 200,
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
      publishVolume: 175,
      playbackMuted: false,
      playbackVolume: 200,
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
    })).toEqual({ ...DEFAULT_STREAM_PREFERENCES, videoBitrateKbps: 16000 })
  })

  it('persists custom tenths of Mbit/s and clamps to the supported capture range', () => {
    for (const [value, expected] of [[7300, 7300], [7349, 7300], [7350, 7400], [50000, 16000], [0, 500], [-1, 500], [NaN, 6000], [Infinity, 6000]]) {
      expect(normalizeStreamVideoBitrate(value)).toBe(expected)
    }
    saveStreamPreferences({ ...DEFAULT_STREAM_PREFERENCES, videoBitrateKbps: 7300 })
    expect(loadStreamPreferences().videoBitrateKbps).toBe(7300)
  })
})
