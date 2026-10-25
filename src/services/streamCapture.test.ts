// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { canRestrictOwnAudio, capturedAudioIncludesOwnPlayback, captureScreen } from './stream'
import { DEFAULT_STREAM_PREFERENCES } from './streamSettings'

class FakeTrack {
  contentHint = ''
  constructor(readonly kind: 'audio' | 'video', private readonly settings: Record<string, unknown> = {}) {}
  getSettings() { return this.settings }
  stop() {}
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

    const media = await captureScreen(DEFAULT_STREAM_PREFERENCES)

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
})
