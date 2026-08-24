// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_VOICE_PREFERENCES,
  loadVoicePreferences,
  normalizeVoicePreferences,
  saveVoicePreferences,
  shortcutFromKeyboardEvent,
  shortcutLabel,
  shortcutMatches,
} from './voiceSettings'

describe('voice preferences', () => {
  beforeEach(() => localStorage.clear())

  it('persists settings and restores validated values', () => {
    saveVoicePreferences({
      ...DEFAULT_VOICE_PREFERENCES,
      inputDeviceId: 'usb-mic',
      outputVolume: 42,
      bitrateKbps: 128,
      inputMode: 'push_to_talk',
    })

    expect(loadVoicePreferences()).toMatchObject({
      inputDeviceId: 'usb-mic',
      outputVolume: 42,
      bitrateKbps: 128,
      inputMode: 'push_to_talk',
    })
  })

  it('repairs outdated or unsafe stored values', () => {
    expect(normalizeVoicePreferences({ inputVolume: 999, outputVolume: -20, bitrateKbps: 999, muteShortcut: '' })).toMatchObject({
      inputVolume: 200,
      outputVolume: 0,
      bitrateKbps: 64,
      muteShortcut: DEFAULT_VOICE_PREFERENCES.muteShortcut,
    })
  })

  it('validates noise suppression mode and gate threshold', () => {
    expect(normalizeVoicePreferences({ noiseSuppressionMode: 'threshold', noiseGateThreshold: 250 })).toMatchObject({
      noiseSuppressionMode: 'threshold',
      noiseGateThreshold: 100,
    })
    expect(normalizeVoicePreferences({ noiseSuppressionMode: 'bogus', noiseGateThreshold: -5 })).toMatchObject({
      noiseSuppressionMode: 'auto',
      noiseGateThreshold: 0,
    })
    expect(normalizeVoicePreferences(null)).toMatchObject({
      noiseSuppressionMode: DEFAULT_VOICE_PREFERENCES.noiseSuppressionMode,
      noiseGateThreshold: DEFAULT_VOICE_PREFERENCES.noiseGateThreshold,
    })
  })
})

describe('voice shortcuts', () => {
  const event = { code: 'KeyM', ctrlKey: true, shiftKey: true, altKey: false, metaKey: false }

  it('records physical keys with modifiers and matches them exactly', () => {
    expect(shortcutFromKeyboardEvent(event)).toBe('Control+Shift+KeyM')
    expect(shortcutMatches(event, 'Control+Shift+KeyM')).toBe(true)
    expect(shortcutMatches({ ...event, shiftKey: false }, 'Control+Shift+KeyM')).toBe(false)
  })

  it('formats shortcuts for the settings UI', () => {
    expect(shortcutLabel('Control+Shift+KeyM')).toBe('Ctrl + Shift + M')
    expect(shortcutLabel('Space')).toBe('Пробел')
  })
})
