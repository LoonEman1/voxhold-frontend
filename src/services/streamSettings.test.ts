// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import {
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
      resolution: '1440p',
      frameRate: 60,
      videoBitrateKbps: 12000,
      includeAudio: true,
      audioBitrateKbps: 320,
      playbackVolume: 37,
    })
  })

  it('rejects values outside client presets', () => {
    expect(normalizeStreamPreferences({
      mode: 'unknown',
      resolution: '4k',
      frameRate: 144,
      videoBitrateKbps: 50000,
      audioBitrateKbps: 1000,
    })).toEqual(DEFAULT_STREAM_PREFERENCES)
  })
})
