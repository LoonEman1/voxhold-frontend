import { afterEach, describe, expect, it, vi } from 'vitest'
import { readPeerStats } from './peerStats'

afterEach(() => vi.useRealTimers())

describe('shared WebRTC stats reads', () => {
  it('shares in-flight and recent reports, then refreshes for the next interval', async () => {
    vi.useFakeTimers({ toFake: ['performance'] })
    const report = new Map() as unknown as RTCStatsReport
    const getStats = vi.fn(async () => report)
    const peer = { getStats } as unknown as RTCPeerConnection
    const [quality, watchdog] = await Promise.all([readPeerStats(peer), readPeerStats(peer)])
    expect(quality).toBe(watchdog)
    await readPeerStats(peer)
    expect(getStats).toHaveBeenCalledOnce()
    vi.advanceTimersByTime(600)
    await readPeerStats(peer)
    expect(getStats).toHaveBeenCalledTimes(2)
  })

  it('retries failures instead of caching a rejected promise', async () => {
    const getStats = vi.fn().mockRejectedValueOnce(new Error('closed')).mockResolvedValueOnce(new Map())
    const peer = { getStats } as unknown as RTCPeerConnection
    await expect(readPeerStats(peer)).rejects.toThrow('closed')
    await expect(readPeerStats(peer)).resolves.toBeInstanceOf(Map)
  })
})
