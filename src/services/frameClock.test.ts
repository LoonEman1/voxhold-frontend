// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { startFrameClock } from './frameClock'

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllTimers(); vi.useRealTimers() })
it('ignores queued ticks after stopping and terminates the worker once', () => {
  const workers: FakeWorker[] = []
  class FakeWorker {
    onmessage: (() => void) | null = null
    onerror: ((event: ErrorEvent) => void) | null = null
    postMessage = vi.fn(); terminate = vi.fn()
    constructor() { workers.push(this) }
  }
  vi.stubGlobal('Worker', FakeWorker)
  const tick = vi.fn(), stop = startFrameClock(33, tick), worker = workers[0]!
  const queued = worker.onmessage!
  queued(); expect(tick).toHaveBeenCalledOnce()
  stop(); stop(); queued()
  expect(tick).toHaveBeenCalledOnce(); expect(worker.terminate).toHaveBeenCalledOnce()
})
it('falls back after an asynchronous worker startup failure and disposes its timer', () => {
  vi.useFakeTimers()
  const workers: FakeWorker[] = []
  class FakeWorker {
    onmessage: (() => void) | null = null
    onerror: ((event: ErrorEvent) => void) | null = null
    postMessage() {} terminate = vi.fn()
    constructor() { workers.push(this) }
  }
  vi.stubGlobal('Worker', FakeWorker)
  const tick = vi.fn(), stop = startFrameClock(33, tick), fail = workers[0]!.onerror!
  fail(new ErrorEvent('error', { cancelable: true })); fail(new ErrorEvent('error', { cancelable: true }))
  vi.advanceTimersByTime(99)
  expect(tick).toHaveBeenCalledTimes(3); expect(workers[0]!.terminate).toHaveBeenCalledOnce()
  stop(); vi.advanceTimersByTime(99); expect(tick).toHaveBeenCalledTimes(3)
})
it('uses a disposable window clock if creating a worker is blocked', () => {
  vi.useFakeTimers()
  vi.stubGlobal('Worker', class { constructor() { throw new DOMException('blocked', 'SecurityError') } })
  const tick = vi.fn(), stop = startFrameClock(20, tick)
  vi.advanceTimersByTime(40); expect(tick).toHaveBeenCalledTimes(2)
  stop(); vi.advanceTimersByTime(40); expect(tick).toHaveBeenCalledTimes(2)
})
