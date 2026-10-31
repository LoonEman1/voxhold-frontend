// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { RealtimeClient } from './realtime'

class Socket extends EventTarget {
  static OPEN = 1; static CLOSING = 2; static latest: Socket
  readyState = 0; sent: string[] = []
  constructor(_url: string) { super(); Socket.latest = this }
  send(data: string) { this.sent.push(data) }
  open() { this.readyState = 1; this.dispatchEvent(new Event('open')); this.event('ready') }
  event(type: string, request_id?: string) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ type, request_id, data: { code: 'invalid_event' } }) })) }
  close(code = 1000, reason = '') { this.readyState = 3; this.dispatchEvent(new CloseEvent('close', { code, reason, wasClean: true })) }
}
let client: RealtimeClient
const state = vi.fn(), error = vi.fn()
beforeEach(() => {
  vi.useFakeTimers(); vi.spyOn(Math, 'random').mockReturnValue(0)
  vi.stubGlobal('WebSocket', Socket)
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
  state.mockClear(); error.mockClear()
  client = new RealtimeClient({ token: 'test', onMessage: () => {}, onStateChange: state, onUnauthorized: () => {}, onError: error })
  client.connect(); Socket.latest.open()
})
afterEach(() => { client.close(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('abandons an unresponsive socket and reconnects', async () => {
  const old = Socket.latest
  await vi.advanceTimersByTimeAsync(25_000)
  expect(JSON.parse(old.sent.at(-1)!)).toMatchObject({ type: 'ping' })
  await vi.advanceTimersByTimeAsync(10_000)
  expect(state).toHaveBeenCalledWith('offline'); expect(old.readyState).toBe(3)
  await vi.advanceTimersByTimeAsync(1000); expect(Socket.latest).not.toBe(old)
})
it.each(['pong', 'error'])('accepts %s as proof of life, including old backends', async (type) => {
  await vi.advanceTimersByTimeAsync(25_000)
  const ping = JSON.parse(Socket.latest.sent.at(-1)!) as { request_id: string }
  Socket.latest.event(type, ping.request_id)
  await vi.advanceTimersByTimeAsync(10_000)
  expect(state).not.toHaveBeenCalledWith('offline'); expect(error).not.toHaveBeenCalled()
})
it('reconnects immediately on online and gives a resumed tab a fresh ping deadline', async () => {
  Socket.latest.close(1006); const old = Socket.latest
  window.dispatchEvent(new Event('online')); expect(Socket.latest).not.toBe(old); Socket.latest.open()
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' }); document.dispatchEvent(new Event('visibilitychange'))
  await vi.advanceTimersByTimeAsync(31_000)
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' }); document.dispatchEvent(new Event('visibilitychange'))
  const ping = JSON.parse(Socket.latest.sent.at(-1)!) as { request_id: string }
  Socket.latest.event('pong', ping.request_id); state.mockClear()
  await vi.advanceTimersByTimeAsync(10_000); expect(state).not.toHaveBeenCalledWith('offline')
})
it('removes all timers and lifecycle listeners on close', async () => {
  const old = Socket.latest; client.close(); state.mockClear()
  window.dispatchEvent(new Event('online')); document.dispatchEvent(new Event('visibilitychange'))
  await vi.advanceTimersByTimeAsync(100_000)
  expect(Socket.latest).toBe(old); expect(state).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0)
})
