import { expect, it, vi } from 'vitest'
import { applyLiveStreamSettings, streamCaptureConstraints, type LiveStreamTarget } from './liveStreamSettings'
import { DEFAULT_STREAM_PREFERENCES as defaults } from './streamSettings'

function setup() {
  const original = streamCaptureConstraints(defaults)
  const track = { kind: 'video', readyState: 'live', contentHint: 'detail', stop: vi.fn(), getConstraints: () => original, applyConstraints: vi.fn(async (_value: unknown) => {}) }
  const configure = vi.fn(async (_value: unknown) => {})
  const update = vi.fn(async (_value: unknown) => {})
  const current = vi.fn(() => true)
  const target = { capture: { getVideoTracks: () => [track] }, pipeline: { configureCapture: configure }, updateSenders: update, isCurrent: current } as unknown as LiveStreamTarget
  return { target, track, configure, update, current, original }
}
it('changes bitrate without touching capture constraints or stopping its track', async () => {
  const f = setup()
  const value = await applyLiveStreamSettings(f.target, defaults, { ...defaults, videoBitrateKbps: 7300 })
  expect(value.videoBitrateKbps).toBe(7300)
  expect(f.track.applyConstraints).not.toHaveBeenCalled()
  expect(f.configure).not.toHaveBeenCalled()
  expect(f.update).toHaveBeenCalledWith(expect.objectContaining({ videoBitrateKbps: 7300 }), undefined)
  expect(f.track.stop).not.toHaveBeenCalled()
})
it('updates both capture and processing clone before changing RTP limits', async () => {
  const f = setup(), next = { ...defaults, resolution: '720p' as const, frameRate: 15 as const, content: 'motion' as const }
  await applyLiveStreamSettings(f.target, defaults, next)
  const constraints = { width: { ideal: 1280, max: 1280 }, height: { ideal: 720, max: 720 }, frameRate: { ideal: 15, max: 15 } }
  expect(f.track.applyConstraints).toHaveBeenCalledWith(constraints)
  expect(f.configure).toHaveBeenCalledWith(constraints)
  expect(f.update).toHaveBeenCalledWith(next, undefined)
  expect(f.track.contentHint).toBe('motion')
  expect(f.track.stop).not.toHaveBeenCalled()
})
it('restores prior capture, clone and sender limits when an encoder rejects the update', async () => {
  const f = setup()
  f.update.mockRejectedValueOnce(new Error('encoder rejected limits'))
  await expect(applyLiveStreamSettings(f.target, defaults, { ...defaults, resolution: '720p', frameRate: 60 })).rejects.toThrow('encoder rejected limits')
  expect(f.track.applyConstraints).toHaveBeenLastCalledWith(f.original)
  expect(f.configure).toHaveBeenLastCalledWith(f.original)
  expect(f.update).toHaveBeenLastCalledWith(defaults, undefined)
  expect(f.track.stop).not.toHaveBeenCalled()
})
it('never applies a stale update to the next stream after stop/start', async () => {
  const f = setup()
  f.track.applyConstraints.mockImplementation(async () => { f.current.mockReturnValue(false) })
  await expect(applyLiveStreamSettings(f.target, defaults, { ...defaults, resolution: '720p' })).rejects.toThrow('уже завершена')
  expect(f.configure).not.toHaveBeenCalled()
  expect(f.update).not.toHaveBeenCalled()
})
it('rejects live codec and capture-source changes before changing media', async () => {
  const f = setup()
  await expect(applyLiveStreamSettings(f.target, defaults, { ...defaults, codec: 'av1' })).rejects.toThrow('перед запуском')
  expect(f.update).not.toHaveBeenCalled()
  expect(f.track.applyConstraints).not.toHaveBeenCalled()
})
