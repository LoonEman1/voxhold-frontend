// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { canRestrictOwnAudio, captureAudioMayIncludeVoice, captureScreen } from './screenCapture'
import { DEFAULT_STREAM_PREFERENCES } from './streamSettings'

class FakeTrack {
  contentHint = ''
  constructor(readonly kind: 'audio' | 'video', private readonly settings: Record<string, unknown> = {}) {}
  getSettings() { return this.settings }
  stop = vi.fn()
}

class FakeMediaStream {
  constructor(private readonly tracks: FakeTrack[]) {}
  getTracks() { return [...this.tracks] }
  removeTrack(track: FakeTrack) { this.tracks.splice(this.tracks.indexOf(track), 1) }
  getVideoTracks() { return this.tracks.filter((track) => track.kind === 'video') }
  getAudioTracks() { return this.tracks.filter((track) => track.kind === 'audio') }
}

function capture(surface: string, audioSettings: Record<string, unknown> | null) {
  const tracks = [new FakeTrack('video', { displaySurface: surface, width: 1920, height: 1080 })]
  if (audioSettings) tracks.push(new FakeTrack('audio', audioSettings))
  return new FakeMediaStream(tracks) as unknown as MediaStream
}

function installMediaDevices(value: Partial<MediaDevices>) {
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value })
}

afterEach(() => {
  Reflect.deleteProperty(navigator, 'mediaDevices')
})

describe('screen capture audio', () => {
  it('requests browser exclusion before selecting the screen and preserves protected system audio', async () => {
    const media = capture('monitor', { deviceId: 'loopbackWithoutChrome', restrictOwnAudio: true })
    const getDisplayMedia = vi.fn(async () => media)
    installMediaDevices({ getDisplayMedia } as unknown as Partial<MediaDevices>)
    const pending = captureScreen(DEFAULT_STREAM_PREFERENCES)
    expect(getDisplayMedia).toHaveBeenCalledOnce()
    expect(await pending).toBe(media)
    expect(getDisplayMedia).toHaveBeenCalledWith(expect.objectContaining({
      audio: expect.objectContaining({ restrictOwnAudio: true, echoCancellation: false }),
      systemAudio: 'include', windowAudio: 'window',
    }))
    expect(media.getAudioTracks()[0]?.contentHint).toBe('music')
    expect(captureAudioMayIncludeVoice(media)).toBe(false)
  })

  it('recognizes ordinary system loopback even when settings report own-audio exclusion', async () => {
    const media = capture('monitor', { deviceId: 'loopback', restrictOwnAudio: true })
    const track = media.getAudioTracks()[0]!
    const applyConstraints = vi.fn()
    Object.assign(track, { applyConstraints })
    installMediaDevices({ getDisplayMedia: vi.fn(async () => media) } as unknown as Partial<MediaDevices>)
    await captureScreen(DEFAULT_STREAM_PREFERENCES)
    expect(media.getAudioTracks()).toEqual([track])
    expect(captureAudioMayIncludeVoice(media)).toBe(true)
    expect(applyConstraints).not.toHaveBeenCalled()
  })

  it('warns on an unknown mixed source without browser exclusion', () => {
    expect(captureAudioMayIncludeVoice(capture('monitor', {}))).toBe(true)
    expect(captureAudioMayIncludeVoice(capture('window', { restrictOwnAudio: false }))).toBe(true)
    expect(captureAudioMayIncludeVoice(capture('browser', {}))).toBe(false)
    expect(captureAudioMayIncludeVoice(capture('monitor', null))).toBe(false)
  })

  it('drops audio when turned off even if a browser returns a track', async () => {
    const media = capture('monitor', {})
    const audio = media.getAudioTracks()[0]!
    installMediaDevices({ getDisplayMedia: vi.fn(async () => media) } as unknown as Partial<MediaDevices>)
    await captureScreen({ ...DEFAULT_STREAM_PREFERENCES, includeAudio: false })
    expect(media.getAudioTracks()).toEqual([])
    expect(audio.stop).toHaveBeenCalledOnce()
  })

  it('detects support for restrictOwnAudio', () => {
    installMediaDevices({ getSupportedConstraints: () => ({ restrictOwnAudio: true }) } as unknown as Partial<MediaDevices>)
    expect(canRestrictOwnAudio()).toBe(true)
    installMediaDevices({ getSupportedConstraints: () => ({}) } as unknown as Partial<MediaDevices>)
    expect(canRestrictOwnAudio()).toBe(false)
  })
})

it('releases capture if loading or probing HDR fails after the picker succeeds', async () => {
  vi.doMock('./hdrCapabilities', () => ({ detectHDRCapabilities: async () => { throw new Error('HDR failed') }, probeCapturedHDRTrack: vi.fn(), rememberHDRCaptureProbe: vi.fn() }))
  const media = capture('monitor', null)
  installMediaDevices({ getDisplayMedia: vi.fn(async () => media) } as unknown as Partial<MediaDevices>)
  try {
    await expect(captureScreen({ ...DEFAULT_STREAM_PREFERENCES, mode: 'server', dynamicRange: 'hdr' })).rejects.toThrow('HDR failed')
    expect(media.getVideoTracks()[0]!.stop).toHaveBeenCalledOnce()
  } finally { vi.doUnmock('./hdrCapabilities') }
})
