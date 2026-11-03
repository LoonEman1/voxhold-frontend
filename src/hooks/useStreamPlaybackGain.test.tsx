// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi, type Mock } from 'vitest'
import { useStreamPlaybackGain } from './useStreamPlaybackGain'

const control = vi.hoisted(() => ({
  fail: false, suspended: false,
  instances: [] as { input: MediaStream; stream: MediaStream; suspended: boolean; setVolume: Mock<(value: number) => void>; resume: Mock<() => Promise<void>>; close: Mock<() => void> }[],
}))
vi.mock('../services/streamAudioGain', () => ({ StreamAudioGain: class {
  state: typeof control.instances[number]
  constructor(input: MediaStream) {
    if (control.fail) throw new Error('Unavailable')
    this.state = { input, stream: {} as MediaStream, suspended: control.suspended, setVolume: vi.fn(), resume: vi.fn().mockResolvedValue(undefined), close: vi.fn() }
    control.instances.push(this.state)
  }
  get stream() { return this.state.stream }
  get suspended() { return this.state.suspended }
  setVolume(value: number) { this.state.setVolume(value) }
  resume() { return this.state.resume() }
  close() { this.state.close() }
} }))
const input = () => { const audio = { kind: 'audio' }; return { getAudioTracks: () => [audio] } as unknown as MediaStream }
beforeEach(() => { control.instances.length = 0; control.fail = false; control.suspended = false })
afterEach(cleanup)

it('creates no audio graph below 100%, then keeps the same media while adjusting amplification', async () => {
  const media = input()
  const { result, rerender, unmount } = renderHook(({ volume }) => useStreamPlaybackGain(media, volume, false), { initialProps: { volume: 37 } })
  expect(control.instances).toHaveLength(0)
  expect(result.current.media).toBe(media)
  expect(result.current.elementVolume).toBe(0.37)
  rerender({ volume: 175 })
  expect(control.instances).toHaveLength(1)
  const mixer = control.instances[0]!
  expect(result.current.media).toBe(mixer.stream)
  expect(result.current.elementVolume).toBe(1)
  rerender({ volume: 200 }); rerender({ volume: 37 })
  expect(control.instances).toHaveLength(1)
  expect(result.current.media).toBe(mixer.stream)
  expect(mixer.setVolume).toHaveBeenLastCalledWith(37)
  await act(async () => {})
  unmount()
  expect(mixer.close).toHaveBeenCalledOnce()
})

it('releases the old graph on source change or switching to publisher preview', async () => {
  const media = input(), next = input()
  const { result, rerender } = renderHook(({ source, publisher }) => useStreamPlaybackGain(source, 200, publisher), { initialProps: { source: media, publisher: false } })
  const first = control.instances[0]!
  rerender({ source: next, publisher: false })
  expect(first.close).toHaveBeenCalledOnce()
  expect(control.instances).toHaveLength(2)
  expect(result.current.media).toBe(control.instances[1]!.stream)
  rerender({ source: next, publisher: true })
  expect(control.instances[1]!.close).toHaveBeenCalledOnce()
  expect(result.current.media).toBe(next)
  expect(result.current.elementVolume).toBe(0)
  await act(async () => {})
})

it('keeps ordinary playback available when Web Audio cannot be created', () => {
  control.fail = true
  const media = input()
  const { result } = renderHook(() => useStreamPlaybackGain(media, 200, false))
  expect(result.current.media).toBe(media)
  expect(result.current.elementVolume).toBe(1)
  expect(result.current.error).toContain('Не удалось усилить звук')
})

it('allows an explicit user gesture to resume a blocked audio graph', async () => {
  const { result } = renderHook(() => useStreamPlaybackGain(inputMedia, 200, false))
  const mixer = control.instances[0]!
  mixer.suspended = true; mixer.resume.mockRejectedValue(new Error('Not allowed'))
  act(() => result.current.resume())
  await waitFor(() => expect(result.current.blocked).toBe(true))
  mixer.suspended = false; mixer.resume.mockResolvedValue(undefined)
  act(() => result.current.resume())
  await waitFor(() => expect(result.current.blocked).toBe(false))
})
const inputMedia = input()

it('amplifies audio arriving after video on the same remote stream and releases removed audio', async () => {
  let audio: MediaStreamTrack[] = []
  const media = Object.assign(new EventTarget(), { getAudioTracks: () => audio }) as unknown as MediaStream
  const { result } = renderHook(() => useStreamPlaybackGain(media, 175, false))
  expect(control.instances).toHaveLength(0)
  audio = [{ kind: 'audio' } as MediaStreamTrack]
  act(() => { media.dispatchEvent(new Event('voxhold:tracks-changed')) })
  expect(control.instances).toHaveLength(1)
  expect(result.current.media).toBe(control.instances[0]!.stream)
  audio = []
  act(() => { media.dispatchEvent(new Event('removetrack')) })
  expect(control.instances[0]!.close).toHaveBeenCalledOnce()
  expect(result.current.media).toBe(media)
  await act(async () => {})
})
