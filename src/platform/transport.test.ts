import { afterEach, expect, it, vi } from 'vitest'
import { createFetchTransport, parseRetryAfter } from './transport'
import { createApi } from '../services/api'

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

it('parses seconds and HTTP dates with bounded server delays', () => {
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-31T00:00:00Z'))
  expect(parseRetryAfter('2')).toBe(2000)
  expect(parseRetryAfter('60')).toBe(30000)
  expect(parseRetryAfter('Sat, 31 Oct 2026 00:00:05 GMT')).toBe(5000)
  expect(parseRetryAfter('Fri, 30 Oct 2026 23:59:00 GMT')).toBe(0)
  for (const value of [null, '', ' ', '-1', 'invalid']) expect(parseRetryAfter(value)).toBeUndefined()
})
it('carries Retry-After through fetch and ApiError', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'busy' }), { status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': '2' } })))
  await expect(createApi(createFetchTransport()).community.request('test', '/busy', 'POST')).rejects.toMatchObject({ status: 429, retryAfterMs: 2000 })
})
it('reads Retry-After on HEAD and XMLHttpRequest uploads', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 503, headers: { 'Retry-After': '1' } })))
  await expect(createFetchTransport().request({ path: '/file', method: 'HEAD' })).resolves.toMatchObject({ retryAfterMs: 1000 })
  class FakeXHR {
    status = 429; responseText = '{"error":"busy"}'; upload = {}; onload = () => {}; timeout = 0
    open() {} setRequestHeader() {} getResponseHeader() { return '3' } send() { this.onload() }
  }
  vi.stubGlobal('XMLHttpRequest', FakeXHR)
  await expect(createFetchTransport().request({ path: '/upload', method: 'PUT', rawBody: new Blob(['x']), onUploadProgress: () => {} })).resolves.toMatchObject({ status: 429, retryAfterMs: 3000 })
})

it('retries idempotent GET busy responses and network failures', async () => {
  vi.useFakeTimers(); vi.spyOn(Math, 'random').mockReturnValue(0)
  const fetch = vi.fn().mockResolvedValueOnce(new Response(null, { status: 503 })).mockRejectedValueOnce(new TypeError('network')).mockResolvedValueOnce(new Response('{"ok":true}', { headers: { 'Content-Type': 'application/json' } }))
  vi.stubGlobal('fetch', fetch)
  const result = createFetchTransport().request({ path: '/read' })
  await vi.advanceTimersByTimeAsync(0); await vi.runAllTimersAsync()
  await expect(result).resolves.toMatchObject({ status: 200, data: { ok: true } }); expect(fetch).toHaveBeenCalledTimes(3)
})
it('never retries writes or rate limits with long or missing hints', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 503 })); vi.stubGlobal('fetch', fetch)
  await createFetchTransport().request({ path: '/write', method: 'POST' }); expect(fetch).toHaveBeenCalledTimes(1)
  fetch.mockClear().mockResolvedValue(new Response(null, { status: 429, headers: { 'Retry-After': '11' } }))
  await createFetchTransport().request({ path: '/read' }); expect(fetch).toHaveBeenCalledTimes(1)
  fetch.mockClear().mockResolvedValue(new Response(null, { status: 429 }))
  await createFetchTransport().request({ path: '/read' }); expect(fetch).toHaveBeenCalledTimes(1)
})
it('cancels a backoff without issuing another request', async () => {
  vi.useFakeTimers()
  const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 503 })); vi.stubGlobal('fetch', fetch)
  const controller = new AbortController(), result = createFetchTransport().request({ path: '/read', signal: controller.signal })
  const checked = expect(result).rejects.toMatchObject({ name: 'AbortError' })
  await vi.advanceTimersByTimeAsync(0); controller.abort(); await checked
  await vi.runAllTimersAsync(); expect(fetch).toHaveBeenCalledTimes(1)
})
it('bounds a stalled fetch by the logical timeout and unwraps it as a network error', async () => {
  const fetch = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init.signal!.addEventListener('abort', () => reject(init.signal!.reason), { once: true })
  }))
  vi.stubGlobal('fetch', fetch)
  const transport = createFetchTransport()
  await expect(transport.request({ path: '/slow', timeoutMs: 20 })).rejects.toMatchObject({ name: 'TimeoutError' })
  expect(fetch).toHaveBeenCalledTimes(1)
  const api = createApi({ request: (request) => transport.request({ ...request, timeoutMs: 20 }) })
  await expect(api.instance.get()).rejects.toMatchObject({ status: 0 })
})

it('retries a rate limit with a short Retry-After hint', async () => {
  vi.useFakeTimers(); vi.spyOn(Math, 'random').mockReturnValue(0)
  const fetch = vi.fn().mockResolvedValueOnce(new Response(null, { status: 429, headers: { 'Retry-After': '1' } })).mockResolvedValueOnce(new Response(null, { status: 204 }))
  vi.stubGlobal('fetch', fetch)
  const result = createFetchTransport().request({ path: '/read' })
  await vi.advanceTimersByTimeAsync(0); await vi.advanceTimersByTimeAsync(999); expect(fetch).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(1); await expect(result).resolves.toMatchObject({ status: 204 }); expect(fetch).toHaveBeenCalledTimes(2)
})
