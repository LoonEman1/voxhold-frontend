import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { VoxholdApi } from '../api'
import type { LocalDevice, SeenKeys } from './deviceKeys'

const state = vi.hoisted(() => ({
  devices: new Map<number, LocalDevice>(), seen: new Map<number, SeenKeys>(), writes: 0, generated: 0,
  workers: [] as Array<{ mode: string; close: ReturnType<typeof vi.fn>; ready: Promise<void> }>, failWorker: false,
}))
vi.mock('./deviceKeys', async (original) => {
  const actual = await original<typeof import('./deviceKeys')>()
  return { ...actual,
    createDevice: async (userId: number) => { const device = await actual.createDevice(userId); state.generated++; return device },
    IndexedDBStore: class {
      async getDevice(id: number) { return state.devices.get(id) }
      async putDevice(device: LocalDevice) { state.writes++; state.devices.set(device.userId, device) }
      async deleteDevice(id: number) { state.devices.delete(id) }
      async getSeen(id: number) { return state.seen.get(id) }
      async putSeen(seen: SeenKeys) { state.writes++; state.seen.set(seen.userId, seen) }
    },
  }
})
vi.mock('./mediaTransform', () => ({
  e2eeTransformMode: () => 'script',
  E2EEMediaTransform: class {
    close = vi.fn()
    ready = state.failWorker ? Promise.reject(new Error('worker failed')) : Promise.resolve()
    constructor(readonly mode: string) { state.workers.push(this) }
    setHandlers() {}
    async setSendKey() {}
    async addReceiveKey() {}
    removeSender() {}
  },
}))

beforeEach(() => {
  vi.resetModules()
  vi.stubGlobal('indexedDB', {})
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  state.devices.clear(); state.seen.clear(); state.workers.length = 0; state.writes = state.generated = 0; state.failWorker = false
})
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })
function options(token = 'first', room = 'voice:1') {
  const register = vi.fn(async (_token: string, _deviceId: string, _publicKey: string): Promise<void> => undefined), devices = vi.fn(async () => [])
  const api = { e2ee: { registerDevice: register, revokeDevice: vi.fn(), devices } } as unknown as VoxholdApi
  return { api, token, userId: 1, room, transport: { sendKey: vi.fn(), requestKey: vi.fn() }, onKeyChanged: vi.fn(), register, devices }
}
async function turnUntil(check: () => boolean) {
  const deadline = performance.now() + 3_000
  while (!check() && performance.now() < deadline) await new Promise<void>((done) => (globalThis as unknown as { setImmediate: (done: () => void) => void }).setImmediate(done))
  expect(check()).toBe(true)
}

describe('call preparation', () => {
  it('rejects a canceled or logged-out join before creating a worker or registering a device', async () => {
    const runtime = await import('./runtime'), config = options(), controller = new AbortController()
    controller.abort()
    await expect(runtime.openCallE2EE({ ...config, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    await expect(runtime.openCallE2EE({ ...config, token: '' })).rejects.toThrow('Сессия истекла')
    expect(state.workers).toHaveLength(0)
    expect(config.register).not.toHaveBeenCalled()
    expect(state.writes).toBe(0)
  })
  it('warms without registering/persisting identity, then consumes the worker and registers on every actual join', async () => {
    const runtime = await import('./runtime'), config = options()
    const release = runtime.prewarmCallE2EE(config, [{ userId: 2, deviceId: 'peer' }])
    await turnUntil(() => state.generated === 1)
    expect(config.devices).toHaveBeenCalledOnce()
    expect(config.register).not.toHaveBeenCalled()
    expect(state.writes).toBe(0)
    const call = await runtime.openCallE2EE(config)
    release()
    expect(state.workers).toHaveLength(1)
    expect(state.workers[0]!.close).not.toHaveBeenCalled()
    expect(config.register).toHaveBeenCalledOnce()
    call.e2ee.close()
    const next = await runtime.openCallE2EE(config)
    expect(config.register).toHaveBeenCalledTimes(2)
    expect(state.workers).toHaveLength(2)
    next.e2ee.close()
  })

  it('does not reuse preparation across a token/room change and an obsolete release does not close the new worker', async () => {
    const runtime = await import('./runtime'), first = options()
    const releaseOld = runtime.prewarmCallE2EE(first)
    const second = { ...first, token: 'second', room: 'voice:2' }
    const releaseNew = runtime.prewarmCallE2EE(second)
    expect(state.workers[0]!.close).toHaveBeenCalledOnce()
    releaseOld()
    expect(state.workers[1]!.close).not.toHaveBeenCalled()
    releaseNew()
    await turnUntil(() => state.generated === 2)
    expect(state.workers[1]!.close).toHaveBeenCalledOnce()
    expect(state.writes).toBe(0)
    expect(first.register).not.toHaveBeenCalled()
  })

  it('expires unused workers and replaces a device that was revoked after preparation', async () => {
    const runtime = await import('./runtime'), config = options()
    const release = runtime.prewarmCallE2EE(config)
    await turnUntil(() => state.generated === 1)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(state.workers[0]!.close).toHaveBeenCalledOnce()
    release()
    config.register.mockRejectedValueOnce(Object.assign(new Error('revoked'), { status: 409 }))
    const call = await runtime.openCallE2EE(config)
    expect(state.workers).toHaveLength(2)
    expect(config.register).toHaveBeenCalledTimes(2)
    expect(config.register.mock.calls[0]![1]).not.toBe(config.register.mock.calls[1]![1])
    call.e2ee.close()
  })

  it('discards a failed warm worker and retries on a real join', async () => {
    const runtime = await import('./runtime'), config = options()
    state.failWorker = true
    const release = runtime.prewarmCallE2EE(config)
    await turnUntil(() => state.workers[0]!.close.mock.calls.length > 0)
    release()
    state.failWorker = false
    const call = await runtime.openCallE2EE(config)
    expect(state.workers).toHaveLength(2)
    call.e2ee.close()
  })

  it('closes consumed preparation immediately when a join is canceled during device registration', async () => {
    const runtime = await import('./runtime'), config = options(), controller = new AbortController()
    let complete!: () => void
    config.register.mockImplementationOnce(() => new Promise<void>((resolve) => { complete = resolve }))
    const joining = runtime.openCallE2EE({ ...config, signal: controller.signal })
    await turnUntil(() => config.register.mock.calls.length === 1)
    controller.abort()
    await expect(joining).rejects.toMatchObject({ name: 'AbortError' })
    expect(state.workers[0]!.close).toHaveBeenCalled()
    // Simulate logout clearing the key before the in-flight HTTP reply.
    state.devices.clear()
    const writes = state.writes
    complete()
    await vi.advanceTimersByTimeAsync(0)
    expect(state.devices.size).toBe(0)
    expect(state.writes).toBe(writes)
  })

  it('keeps cancellation attached after keys are prepared while capture may still be pending', async () => {
    const runtime = await import('./runtime'), config = options(), controller = new AbortController()
    const call = await runtime.openCallE2EE({ ...config, signal: controller.signal })
    controller.abort()
    expect(state.workers[0]!.close).toHaveBeenCalledOnce()
    call.e2ee.close()
  })
})
