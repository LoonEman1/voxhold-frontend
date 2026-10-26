// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ClientDiagnostics, sanitizeDiagnosticDetails } from './clientDiagnostics'

describe('client diagnostics', () => {
  beforeEach(() => {
    sessionStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('batches synchronous storage work and persists pending events on disposal', () => {
    vi.useFakeTimers()
    const writes = vi.spyOn(Storage.prototype, 'setItem')
    const diagnostics = new ClientDiagnostics()
    writes.mockClear()
    for (let index = 0; index < 20; index += 1) diagnostics.record('media', 'quality', 'info', { index })
    expect(writes).not.toHaveBeenCalled()
    vi.advanceTimersByTime(250)
    expect(writes).toHaveBeenCalledOnce()
    diagnostics.record('media', 'quality', 'info', { index: 21 })
    diagnostics.dispose()
    expect(writes).toHaveBeenCalledTimes(2)
    expect(sessionStorage.getItem('voxhold.diagnostics.pending.v1')).toContain('21')
    vi.advanceTimersByTime(1000)
    expect(writes).toHaveBeenCalledTimes(2)
  })

  it('redacts signaling and user content recursively', () => {
    expect(sanitizeDiagnosticDetails({
      route: '/api/v1/messages',
      sdp_bytes: 123,
      token: 'access-token',
      nested: {
        content: 'private message',
        candidate: 'candidate with an IP address',
        packets: 42,
      },
    })).toEqual({
      route: '/api/v1/messages',
      sdp_bytes: 123,
      token: '[redacted]',
      nested: {
        content: '[redacted]',
        candidate: '[redacted]',
        packets: 42,
      },
    })
  })

  it('flushes a bounded sanitized batch to the authenticated endpoint', async () => {
    const request = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(null, { status: 202 }))
    vi.stubGlobal('fetch', request)
    const diagnostics = new ClientDiagnostics()
    diagnostics.configure('/backend/')
    diagnostics.record('webrtc', 'voice_rtp_stats', 'info', {
      bytes: 100,
      sdp: 'private SDP',
    })
    diagnostics.setToken('session-token')

    await diagnostics.flush()
    await vi.waitFor(() => expect(request).toHaveBeenCalled())

    expect(request).toHaveBeenCalled()
    const [url, init] = request.mock.calls.at(-1)!
    expect(url).toBe('/backend/api/v1/diagnostics/client-events')
    expect(init?.headers).toEqual(expect.objectContaining({
      Authorization: 'Bearer session-token',
    }))
    const body = JSON.parse(String(init?.body)) as {
      events: Array<{ name: string; details: Record<string, unknown> }>
    }
    const mediaEvent = body.events.find((event) => event.name === 'voice_rtp_stats')
    expect(mediaEvent?.details).toEqual({ bytes: 100, sdp: '[redacted]' })
    diagnostics.dispose()
  })
})
