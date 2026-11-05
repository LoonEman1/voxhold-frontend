// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { canRestrictOwnAudio, capturedAudioIncludesOwnPlayback, captureScreen } from './screenCapture'
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
  it('asks the browser to keep its own voice chat out of system audio', async () => {
    const getDisplayMedia = vi.fn(async () => capture('monitor', { restrictOwnAudio: true }))
    installMediaDevices({ getDisplayMedia } as unknown as Partial<MediaDevices>)

    const pending = captureScreen(DEFAULT_STREAM_PREFERENCES)
    // A lazy module/ICE fetch before this call would lose transient user activation.
    expect(getDisplayMedia).toHaveBeenCalledOnce()
    const media = await pending

    expect(getDisplayMedia).toHaveBeenCalledWith(expect.objectContaining({
      audio: expect.objectContaining({ restrictOwnAudio: true, echoCancellation: false }),
      systemAudio: 'include',
    }))
    expect(media.getAudioTracks()[0]?.contentHint).toBe('music')
    expect(capturedAudioIncludesOwnPlayback(media)).toBe(false)
  })

  it('warns only when whole-system audio still carries the page playback', () => {
    expect(capturedAudioIncludesOwnPlayback(capture('monitor', {}))).toBe(true)
    expect(capturedAudioIncludesOwnPlayback(capture('window', { restrictOwnAudio: false }))).toBe(true)
    expect(capturedAudioIncludesOwnPlayback(capture('monitor', { restrictOwnAudio: true }))).toBe(false)
    expect(capturedAudioIncludesOwnPlayback(capture('browser', {}))).toBe(false)
    expect(capturedAudioIncludesOwnPlayback(capture('monitor', null))).toBe(false)
  })

  it('detects support for restrictOwnAudio', () => {
    installMediaDevices({ getSupportedConstraints: () => ({ restrictOwnAudio: true }) } as unknown as Partial<MediaDevices>)
    expect(canRestrictOwnAudio()).toBe(true)
    installMediaDevices({ getSupportedConstraints: () => ({}) } as unknown as Partial<MediaDevices>)
    expect(canRestrictOwnAudio()).toBe(false)
  })

  it('requests window-only audio and retries a restriction that the picker did not apply', async () => {
    const media = capture('monitor', { restrictOwnAudio: false })
    const audio = media.getAudioTracks()[0]!
    const applyConstraints = vi.fn(async () => { Object.assign(audio.getSettings(), { restrictOwnAudio: true }) })
    Object.assign(audio, { applyConstraints })
    const getDisplayMedia = vi.fn(async () => media)
    installMediaDevices({ getDisplayMedia, getSupportedConstraints: () => ({ restrictOwnAudio: true }) } as unknown as Partial<MediaDevices>)
    expect(await captureScreen(DEFAULT_STREAM_PREFERENCES)).toBe(media)
    expect(getDisplayMedia).toHaveBeenCalledWith(expect.objectContaining({ windowAudio: 'window' }))
    expect(applyConstraints).toHaveBeenCalledWith({ restrictOwnAudio: true })
    expect(capturedAudioIncludesOwnPlayback(media)).toBe(false)
    expect(audio.stop).not.toHaveBeenCalled()
  })

  it.each(['unsupported', 'ignored', 'rejected'])('preserves game audio and reports the echo risk when exclusion is %s', async (support) => {
    const media = capture('monitor', {})
    const audio = media.getAudioTracks()[0]!
    const applyConstraints = support === 'rejected' ? vi.fn().mockRejectedValue(new Error('Unavailable')) : vi.fn().mockResolvedValue(undefined)
    Object.assign(audio, { applyConstraints })
    installMediaDevices({ getDisplayMedia: vi.fn(async () => media), getSupportedConstraints: () => ({ restrictOwnAudio: support !== 'unsupported' }) } as unknown as Partial<MediaDevices>)
    expect(await captureScreen(DEFAULT_STREAM_PREFERENCES)).toBe(media)
    expect(media.getAudioTracks()).toEqual([audio])
    expect(audio.stop).not.toHaveBeenCalled()
    expect(capturedAudioIncludesOwnPlayback(media)).toBe(true)
    expect(applyConstraints).toHaveBeenCalledTimes(support === 'unsupported' ? 0 : 1)
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
