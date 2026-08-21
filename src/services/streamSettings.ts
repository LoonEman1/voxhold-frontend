import type { StreamCodec, StreamMode } from '../domain/types'

export const STREAM_RESOLUTIONS = [
  { id: '720p', label: '1280 × 720', width: 1280, height: 720 },
  { id: '1080p', label: '1920 × 1080', width: 1920, height: 1080 },
  { id: '1440p', label: '2560 × 1440', width: 2560, height: 1440 },
] as const
export const STREAM_FRAME_RATES = [30, 60] as const
export const STREAM_VIDEO_BITRATES = [2500, 4500, 6000, 8000, 12000, 16000] as const
export const STREAM_AUDIO_BITRATES = [64, 96, 128, 192, 256, 320] as const

export type StreamResolution = typeof STREAM_RESOLUTIONS[number]['id']
export type StreamFrameRate = typeof STREAM_FRAME_RATES[number]
export type StreamVideoBitrate = typeof STREAM_VIDEO_BITRATES[number]
export type StreamAudioBitrate = typeof STREAM_AUDIO_BITRATES[number]
export type StreamCodecPreference = 'auto' | StreamCodec

export interface StreamPreferences {
  mode: StreamMode
  codec: StreamCodecPreference
  resolution: StreamResolution
  frameRate: StreamFrameRate
  videoBitrateKbps: StreamVideoBitrate
  includeAudio: boolean
  audioBitrateKbps: StreamAudioBitrate
  playbackVolume: number
}

export const DEFAULT_STREAM_PREFERENCES: StreamPreferences = {
  mode: 'server',
  codec: 'auto',
  resolution: '1080p',
  frameRate: 30,
  videoBitrateKbps: 6000,
  includeAudio: true,
  audioBitrateKbps: 128,
  playbackVolume: 100,
}

const STORAGE_KEY = 'voxhold.stream.preferences.v1'

export function normalizeStreamPreferences(value: unknown): StreamPreferences {
  const source = value && typeof value === 'object' ? value as Partial<StreamPreferences> : {}
  return {
    mode: source.mode === 'p2p' ? 'p2p' : 'server',
    codec: source.codec === 'vp8' || source.codec === 'vp9' || source.codec === 'h264' || source.codec === 'av1'
      ? source.codec
      : 'auto',
    resolution: STREAM_RESOLUTIONS.some((item) => item.id === source.resolution)
      ? source.resolution as StreamResolution
      : DEFAULT_STREAM_PREFERENCES.resolution,
    frameRate: STREAM_FRAME_RATES.includes(source.frameRate as StreamFrameRate)
      ? source.frameRate as StreamFrameRate
      : DEFAULT_STREAM_PREFERENCES.frameRate,
    videoBitrateKbps: STREAM_VIDEO_BITRATES.includes(source.videoBitrateKbps as StreamVideoBitrate)
      ? source.videoBitrateKbps as StreamVideoBitrate
      : DEFAULT_STREAM_PREFERENCES.videoBitrateKbps,
    includeAudio: source.includeAudio !== false,
    audioBitrateKbps: STREAM_AUDIO_BITRATES.includes(source.audioBitrateKbps as StreamAudioBitrate)
      ? source.audioBitrateKbps as StreamAudioBitrate
      : DEFAULT_STREAM_PREFERENCES.audioBitrateKbps,
    playbackVolume: typeof source.playbackVolume === 'number' && Number.isFinite(source.playbackVolume)
      ? Math.max(0, Math.min(100, Math.round(source.playbackVolume)))
      : DEFAULT_STREAM_PREFERENCES.playbackVolume,
  }
}

export function loadStreamPreferences(): StreamPreferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return normalizeStreamPreferences(raw ? JSON.parse(raw) : null)
  } catch {
    return { ...DEFAULT_STREAM_PREFERENCES }
  }
}

export function saveStreamPreferences(value: StreamPreferences) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeStreamPreferences(value)))
  } catch {
    // Screen sharing still works when persistent browser storage is blocked.
  }
}

export function selectedStreamResolution(value: StreamPreferences) {
  return STREAM_RESOLUTIONS.find((item) => item.id === value.resolution)
    ?? STREAM_RESOLUTIONS[1]
}
