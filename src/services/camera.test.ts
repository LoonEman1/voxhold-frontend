import { afterEach, expect, it, vi } from 'vitest'
import { CameraCapture, cameraConstraints, configureCameraSender } from './camera'

afterEach(() => vi.unstubAllGlobals())
function stream() {
  const track = Object.assign(new EventTarget(), { kind: 'video', stop: vi.fn(), applyConstraints: vi.fn().mockResolvedValue(undefined), contentHint: '' })
  return { track, media: { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream }
}
it('releases a camera granted after the caller cancels or leaves', async () => {
  let grant!: (value: MediaStream) => void
  const getUserMedia = vi.fn(() => new Promise<MediaStream>((resolve) => { grant = resolve }))
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } })
  const changed = vi.fn(), camera = new CameraCapture(changed), captured = stream()
  const starting = camera.start('medium')
  expect(getUserMedia).toHaveBeenCalledWith({ audio: false, video: cameraConstraints('medium') })
  camera.stop()
  grant(captured.media)
  expect(await starting).toBeNull()
  expect(captured.track.stop).toHaveBeenCalledOnce()
  expect(changed).not.toHaveBeenCalled()
})
it('changes resolution on the same track and releases it when the device ends', async () => {
  const captured = stream(), changed = vi.fn()
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn().mockResolvedValue(captured.media) } })
  const camera = new CameraCapture(changed)
  await camera.start('low')
  await camera.setQuality('high')
  expect(camera.stream).toBe(captured.media)
  expect(captured.track.applyConstraints).toHaveBeenCalledWith(cameraConstraints('high'))
  expect(camera.quality).toBe('high')
  captured.track.dispatchEvent(new Event('ended'))
  expect(changed).toHaveBeenLastCalledWith(null)
  expect(captured.track.stop).toHaveBeenCalledOnce()
})
it('keeps the previous preset when applying new constraints fails', async () => {
  const captured = stream()
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn().mockResolvedValue(captured.media) } })
  const camera = new CameraCapture(vi.fn())
  await camera.start('medium')
  captured.track.applyConstraints.mockRejectedValueOnce(new Error('unsupported'))
  await expect(camera.setQuality('high')).rejects.toThrow('unsupported')
  expect(camera.quality).toBe('medium')
  camera.stop()
})
it('applies a bounded encoder rate independently of microphone settings', async () => {
  const setParameters = vi.fn().mockResolvedValue(undefined)
  await configureCameraSender({ getParameters: () => ({ encodings: [{}] }), setParameters } as unknown as RTCRtpSender, 'high')
  expect(setParameters).toHaveBeenCalledWith({ encodings: [{ maxBitrate: 2_500_000, maxFramerate: 30 }], degradationPreference: 'balanced' })
})
