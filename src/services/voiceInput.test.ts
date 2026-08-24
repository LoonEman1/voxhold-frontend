// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BrowserVoiceInput } from './voiceInput'
import { DEFAULT_VOICE_PREFERENCES } from './voiceSettings'

class FakeTrack extends EventTarget {
  readonly id = crypto.randomUUID()
  readonly kind = 'audio'
  enabled = true
  readyState = 'live'
  stop = vi.fn(() => { this.readyState = 'ended' })
}

class FakeMediaStream {
  private tracks: FakeTrack[]
  constructor(tracks: FakeTrack[] = []) { this.tracks = [...tracks] }
  getTracks() { return [...this.tracks] }
  getAudioTracks() { return [...this.tracks] }
}

function mediaDevicesStub(getUserMedia: ReturnType<typeof vi.fn>) {
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia },
  })
}

describe('BrowserVoiceInput', () => {
  beforeEach(() => {
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('starts once, reports the track and closes exactly once', async () => {
    const track = new FakeTrack()
    const getUserMedia = vi.fn(async () => new FakeMediaStream([track]))
    mediaDevicesStub(getUserMedia)
    const input = new BrowserVoiceInput()

    await input.start(DEFAULT_VOICE_PREFERENCES)
    await input.start(DEFAULT_VOICE_PREFERENCES)
    expect(input.currentTrack()).toBe(track)
    expect(input.isHealthy).toBe(true)

    input.setState(false)
    expect(track.enabled).toBe(false)
    input.setState(true)
    expect(track.enabled).toBe(true)

    input.close()
    input.close()
    expect(track.stop).toHaveBeenCalledOnce()
    expect(getUserMedia).toHaveBeenCalledOnce()
    expect(input.currentTrack()).toBeNull()
  })

  it('reacquires the default device when the selected one disappears', async () => {
    const selected = new FakeTrack()
    const fallback = new FakeTrack()
    let calls = 0
    const getUserMedia = vi.fn(async (constraints: { audio: { deviceId?: { exact: string } } }) => {
      calls += 1
      if (calls === 1) return new FakeMediaStream([selected])
      // The selected device is gone; the exact-constraint attempt must fail...
      if (constraints.audio.deviceId?.exact) throw new DOMException('gone', 'NotFoundError')
      // ...and the default-device fallback must succeed.
      return new FakeMediaStream([fallback])
    })
    mediaDevicesStub(getUserMedia)

    const onReplaced = vi.fn()
    const input = new BrowserVoiceInput({ onReplaced })
    await input.start({ ...DEFAULT_VOICE_PREFERENCES, inputDeviceId: 'device-1' })

    selected.dispatchEvent(new Event('ended'))
    await vi.waitFor(() => { expect(input.currentTrack()).toBe(fallback) })
    expect(onReplaced).toHaveBeenCalledWith(fallback)
    expect(getUserMedia).toHaveBeenCalledTimes(3)
    expect(selected.stop).toHaveBeenCalledOnce()
    expect(fallback.stop).not.toHaveBeenCalled()
  })

  it('keeps remote outputs usable and reports unavailability when reacquire fails', async () => {
    const first = new FakeTrack()
    let calls = 0
    const getUserMedia = vi.fn(async () => {
      calls += 1
      if (calls === 1) return new FakeMediaStream([first])
      throw new DOMException('busy', 'NotReadableError')
    })
    mediaDevicesStub(getUserMedia)

    const onUnavailable = vi.fn()
    const input = new BrowserVoiceInput({ onUnavailable })
    await input.start(DEFAULT_VOICE_PREFERENCES)

    first.dispatchEvent(new Event('ended'))
    await vi.waitFor(() => { expect(onUnavailable).toHaveBeenCalledOnce() })
    // The old chain is kept but its track is disabled: silence keeps flowing
    // to the sender while receiving other participants continues.
    expect(first.enabled).toBe(false)

    // A later retry succeeds when the device comes back.
    const restored = new FakeTrack()
    getUserMedia.mockImplementation(async () => new FakeMediaStream([restored]))
    await input.retry()
    expect(input.currentTrack()).toBe(restored)
    expect(input.isHealthy).toBe(true)
    expect(first.stop).toHaveBeenCalledOnce()
  })

  it('rebuilds the chain only when the device/processing preferences change', async () => {
    const track = new FakeTrack()
    const getUserMedia = vi.fn(async () => new FakeMediaStream([track]))
    mediaDevicesStub(getUserMedia)
    const input = new BrowserVoiceInput()
    await input.start(DEFAULT_VOICE_PREFERENCES)

    // Volume-only changes must not recreate the capture.
    await input.applyPreferences({ ...DEFAULT_VOICE_PREFERENCES, inputVolume: 42 })
    expect(getUserMedia).toHaveBeenCalledOnce()
    expect(input.currentTrack()).toBe(track)

    await input.applyPreferences({ ...DEFAULT_VOICE_PREFERENCES, echoCancellation: !DEFAULT_VOICE_PREFERENCES.echoCancellation })
    expect(getUserMedia).toHaveBeenCalledTimes(2)
  })
})
