import { afterEach, expect, it, vi } from 'vitest'
import { createFetchTransport, parseRetryAfter } from './transport'
import { createApi } from '../services/api'

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

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
  await expect(createApi(createFetchTransport()).instance.get()).rejects.toMatchObject({ status: 429, retryAfterMs: 2000 })
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
