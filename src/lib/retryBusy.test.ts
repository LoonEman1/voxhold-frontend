import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ApiError } from '../services/api'
import { retryBusy } from './retryBusy'

beforeEach(() => { vi.useFakeTimers(); vi.spyOn(Math, 'random').mockReturnValue(0) })
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

it('honours Retry-After for busy responses', async () => {
  const load = vi.fn().mockRejectedValueOnce(new ApiError('busy', 429, 2000)).mockResolvedValue('ok')
  const result = retryBusy(new AbortController().signal, load)
  await vi.advanceTimersByTimeAsync(1999); expect(load).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(1); await expect(result).resolves.toBe('ok')
})
it('does not replay non-busy errors', async () => {
  const error = new ApiError('gone', 404), load = vi.fn().mockRejectedValue(error)
  await expect(retryBusy(new AbortController().signal, load)).rejects.toBe(error)
  expect(load).toHaveBeenCalledTimes(1)
})
it('aborts while waiting and never schedules another request', async () => {
  const controller = new AbortController(), load = vi.fn().mockRejectedValue(new ApiError('busy', 503))
  const result = retryBusy(controller.signal, load)
  const checked = expect(result).rejects.toMatchObject({ name: 'AbortError' })
  await vi.advanceTimersByTimeAsync(1); controller.abort(); await checked
  await vi.runAllTimersAsync(); expect(load).toHaveBeenCalledTimes(1)
})
it('caps attempts and rejects already-cancelled work before loading', async () => {
  const error = new ApiError('busy', 503), load = vi.fn().mockRejectedValue(error)
  const checked = expect(retryBusy(new AbortController().signal, load, 3)).rejects.toBe(error)
  await vi.runAllTimersAsync(); await checked; expect(load).toHaveBeenCalledTimes(3)
  const controller = new AbortController(); controller.abort(); load.mockClear()
  await expect(retryBusy(controller.signal, load)).rejects.toMatchObject({ name: 'AbortError' })
  expect(load).not.toHaveBeenCalled()
})
