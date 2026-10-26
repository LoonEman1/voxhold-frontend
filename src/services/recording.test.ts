import { afterEach, describe, expect, it, vi } from 'vitest'
import { recordingMIME } from './recording'
import { recordingFilename } from './recordingStore'
import type { ChannelRecording } from '../domain/types'
afterEach(() => vi.unstubAllGlobals())
describe('recording compatibility', () => {
  it('prefers supported VP8 and otherwise falls back to MP4 without forcing VP9', () => {
    vi.stubGlobal('MediaRecorder', { isTypeSupported: (value: string) => value.includes('mp4') })
    expect(recordingMIME()).toBe('video/mp4;codecs=avc1.42E01E,mp4a.40.2')
    vi.stubGlobal('MediaRecorder', { isTypeSupported: (value: string) => value.includes('webm') })
    expect(recordingMIME()).toBe('video/webm;codecs=vp8,opus')
  })
  it('disables recording when the browser has no usable recorder', () => {
    vi.stubGlobal('MediaRecorder', undefined); expect(recordingMIME()).toBe(null)
    vi.stubGlobal('MediaRecorder', { isTypeSupported: () => false }); expect(recordingMIME()).toBe(null)
  })
  it('creates filesystem-safe names independent from user/channel names', () => {
    const record = { id: 'a'.repeat(32), created_at: 1_700_000_000, mime_type: 'video/mp4' } as ChannelRecording
    expect(recordingFilename(record)).toMatch(/^voxhold-[\dT-Z-]+-aaaaaaaa\.mp4$/)
    expect(recordingFilename(record)).not.toMatch(/[/:\\]/)
  })
})
