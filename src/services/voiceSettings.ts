export type VoiceInputMode = 'voice_activity' | 'push_to_talk'
export const VOICE_BITRATES = [24, 32, 48, 64, 96, 128] as const
export type VoiceBitrate = typeof VOICE_BITRATES[number]

export interface VoicePreferences {
  inputDeviceId: string
  outputDeviceId: string
  inputVolume: number
  outputVolume: number
  bitrateKbps: VoiceBitrate
  echoCancellation: boolean
  noiseSuppression: boolean
  autoGainControl: boolean
  inputMode: VoiceInputMode
  muteShortcut: string
  deafenShortcut: string
  pushToTalkShortcut: string
}

export const DEFAULT_VOICE_PREFERENCES: VoicePreferences = {
  inputDeviceId: '',
  outputDeviceId: '',
  inputVolume: 100,
  outputVolume: 100,
  bitrateKbps: 64,
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  inputMode: 'voice_activity',
  muteShortcut: 'Control+Shift+KeyM',
  deafenShortcut: 'Control+Shift+KeyD',
  pushToTalkShortcut: 'Space',
}

const STORAGE_KEY = 'voxhold.voice.preferences.v1'

function numberInRange(value: unknown, fallback: number, min: number, max: number) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, Math.round(value)))
    : fallback
}

export function normalizeVoicePreferences(value: unknown): VoicePreferences {
  const source = value && typeof value === 'object' ? value as Partial<VoicePreferences> : {}
  return {
    inputDeviceId: typeof source.inputDeviceId === 'string' ? source.inputDeviceId : '',
    outputDeviceId: typeof source.outputDeviceId === 'string' ? source.outputDeviceId : '',
    inputVolume: numberInRange(source.inputVolume, DEFAULT_VOICE_PREFERENCES.inputVolume, 0, 200),
    outputVolume: numberInRange(source.outputVolume, DEFAULT_VOICE_PREFERENCES.outputVolume, 0, 100),
    bitrateKbps: VOICE_BITRATES.includes(source.bitrateKbps as VoiceBitrate) ? source.bitrateKbps as VoiceBitrate : DEFAULT_VOICE_PREFERENCES.bitrateKbps,
    echoCancellation: typeof source.echoCancellation === 'boolean' ? source.echoCancellation : true,
    noiseSuppression: typeof source.noiseSuppression === 'boolean' ? source.noiseSuppression : true,
    autoGainControl: typeof source.autoGainControl === 'boolean' ? source.autoGainControl : true,
    inputMode: source.inputMode === 'push_to_talk' ? 'push_to_talk' : 'voice_activity',
    muteShortcut: validShortcut(source.muteShortcut, DEFAULT_VOICE_PREFERENCES.muteShortcut),
    deafenShortcut: validShortcut(source.deafenShortcut, DEFAULT_VOICE_PREFERENCES.deafenShortcut),
    pushToTalkShortcut: validShortcut(source.pushToTalkShortcut, DEFAULT_VOICE_PREFERENCES.pushToTalkShortcut),
  }
}

function validShortcut(value: unknown, fallback: string) {
  return typeof value === 'string' && value.length > 0 && value.length <= 80 ? value : fallback
}

export function loadVoicePreferences(): VoicePreferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return normalizeVoicePreferences(raw ? JSON.parse(raw) : null)
  } catch {
    return { ...DEFAULT_VOICE_PREFERENCES }
  }
}

export function saveVoicePreferences(preferences: VoicePreferences) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeVoicePreferences(preferences)))
  } catch {
    // Voice remains usable when storage is unavailable (private mode or Wails policy).
  }
}

const modifierCodes = new Set(['ControlLeft', 'ControlRight', 'ShiftLeft', 'ShiftRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight'])

export function shortcutFromKeyboardEvent(event: Pick<KeyboardEvent, 'code' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'metaKey'>): string | null {
  if (!event.code || modifierCodes.has(event.code)) return null
  const parts: string[] = []
  if (event.ctrlKey) parts.push('Control')
  if (event.altKey) parts.push('Alt')
  if (event.shiftKey) parts.push('Shift')
  if (event.metaKey) parts.push('Meta')
  parts.push(event.code)
  return parts.join('+')
}

export function shortcutMatches(event: Pick<KeyboardEvent, 'code' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'metaKey'>, shortcut: string) {
  return shortcutFromKeyboardEvent(event) === shortcut
}

export function shortcutLabel(shortcut: string) {
  const names: Record<string, string> = {
    Control: 'Ctrl',
    Alt: 'Alt',
    Shift: 'Shift',
    Meta: 'Win',
    Space: 'Пробел',
    Enter: 'Enter',
    Escape: 'Esc',
    Tab: 'Tab',
    ArrowUp: '↑',
    ArrowDown: '↓',
    ArrowLeft: '←',
    ArrowRight: '→',
  }
  return shortcut.split('+').map((part) => names[part] ?? part.replace(/^Key/, '').replace(/^Digit/, '')).join(' + ')
}

export function isEditableKeyboardTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}
