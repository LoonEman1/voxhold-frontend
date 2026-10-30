import { afterEach, expect, it, vi } from 'vitest'
import { createFetchTransport } from './transport'

afterEach(() => vi.unstubAllGlobals())
it('accepts a successful HEAD without parsing a JSON body', async () => {
  const fetch = vi.fn(async () => new Response(null, { status: 200, headers: { 'Content-Type': 'application/json', 'Content-Length': '4000' } }))
  vi.stubGlobal('fetch', fetch)
  const result = await createFetchTransport().request({ method: 'HEAD', path: '/api/v1/attachments/file/content' })
  expect(result).toEqual({ status: 200, data: null })
  expect(fetch).toHaveBeenCalledWith('/api/v1/attachments/file/content', expect.objectContaining({ method: 'HEAD' }))
})
