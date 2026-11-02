import { afterEach, describe, expect, it, vi } from 'vitest'
import { E2EEMediaTransform } from './mediaTransform'

class FakeWorker {
  static latest: FakeWorker
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: (() => void) | null = null
  onmessageerror: (() => void) | null = null
  postMessage = vi.fn()
  terminate = vi.fn()
  constructor() { FakeWorker.latest = this }
  reply(data: unknown) { this.onmessage?.({ data } as MessageEvent) }
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('media worker readiness', () => {
  it('resolves key installation only after the worker applies that exact command', async () => {
    vi.stubGlobal('Worker', FakeWorker)
    const events = vi.fn(), media = new E2EEMediaTransform('script', events)
    const worker = FakeWorker.latest
    worker.reply({ type: 'ready' })
    await media.ready
    let installed = false
    const applying = media.addReceiveKey('alice', 0, new Uint8Array(32)).then(() => { installed = true })
    await Promise.resolve()
    expect(installed).toBe(false)
    const request = worker.postMessage.mock.calls[0]![0] as { id: number; command: { type: string } }
    expect(request.command.type).toBe('receiveKey')
    worker.reply({ type: 'applied', id: request.id + 1 })
    await Promise.resolve()
    expect(installed).toBe(false)
    worker.reply({ type: 'applied', id: request.id })
    await applying
    expect(installed).toBe(true)
    expect(events).not.toHaveBeenCalled()
    worker.reply({ type: 'firstFrame', direction: 'recv' })
    expect(events).toHaveBeenCalledWith({ type: 'firstFrame', direction: 'recv' })
    media.close()
  })

  it('rejects failed installations and pending RPCs on close without reporting a normal shutdown as an error', async () => {
    vi.stubGlobal('Worker', FakeWorker)
    const media = new E2EEMediaTransform('streams'), error = vi.fn()
    media.setHandlers(vi.fn(), error)
    FakeWorker.latest.reply({ type: 'ready' })
    const failed = media.setSendKey(0, new Uint8Array(32))
    FakeWorker.latest.reply({ type: 'commandError', id: 1 })
    await expect(failed).rejects.toThrow('installation failed')
    const pending = media.addReceiveKey('alice', 0, new Uint8Array(32))
    media.close()
    await expect(pending).rejects.toThrow('closed')
    expect(error).not.toHaveBeenCalled()
    expect(FakeWorker.latest.terminate).toHaveBeenCalledOnce()
    FakeWorker.latest.reply({ type: 'firstFrame', direction: 'recv' })
    expect(error).not.toHaveBeenCalled()
  })

  it('bounds worker startup and reports a crashed worker instead of claiming readiness', async () => {
    vi.stubGlobal('Worker', FakeWorker)
    vi.useFakeTimers()
    const media = new E2EEMediaTransform('script'), error = vi.fn()
    media.setHandlers(vi.fn(), error)
    const rejected = expect(media.ready).rejects.toThrow('did not start')
    await vi.advanceTimersByTimeAsync(5_000)
    await rejected
    expect(error).toHaveBeenCalledOnce()
    media.close()
  })

  it('never retries an ambiguous timed-out installation in the same worker', async () => {
    vi.stubGlobal('Worker', FakeWorker)
    vi.useFakeTimers()
    const media = new E2EEMediaTransform('script')
    FakeWorker.latest.reply({ type: 'ready' })
    const first = expect(media.addReceiveKey('alice', 0, new Uint8Array(32))).rejects.toThrow('timed out')
    await vi.advanceTimersByTimeAsync(5_000)
    await first
    FakeWorker.latest.reply({ type: 'applied', id: 1 })
    await expect(media.addReceiveKey('alice', 0, new Uint8Array(32))).rejects.toThrow('timed out')
    expect(FakeWorker.latest.postMessage).toHaveBeenCalledTimes(1)
    expect(FakeWorker.latest.terminate).toHaveBeenCalledOnce()
    media.close()
  })
})
