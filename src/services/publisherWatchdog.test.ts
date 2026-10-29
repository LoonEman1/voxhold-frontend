// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { PublisherWatchdog } from './publisherWatchdog'

afterEach(() => vi.useRealTimers())
function fixture() {
  vi.useFakeTimers()
  let frames = 1
  const peer = { connectionState: 'connected', getStats: vi.fn(async () => new Map([['video', { id: 'video', type: 'outbound-rtp', kind: 'video', timestamp: performance.now(), framesEncoded: frames }]])) }
  return { peer, setFrames: (value: number) => { frames = value }, asPeer: peer as unknown as RTCPeerConnection }
}
it('repairs a connected publisher that stopped encoding and stops after disposal', async () => {
  const f = fixture(), recover = vi.fn(async () => undefined), monitor = new PublisherWatchdog(f.asPeer, recover)
  monitor.start(); await vi.advanceTimersByTimeAsync(14_000)
  expect(recover).toHaveBeenCalledOnce()
  f.setFrames(10); await vi.advanceTimersByTimeAsync(2_000)
  monitor.stop(); await vi.advanceTimersByTimeAsync(30_000)
  expect(recover).toHaveBeenCalledOnce()
})
it('keeps a steadily encoding publisher and a disconnected transport out of pipeline repair', async () => {
  const f = fixture(), recover = vi.fn(async () => undefined), monitor = new PublisherWatchdog(f.asPeer, recover)
  monitor.start()
  for (let i = 0; i < 10; i++) { f.setFrames(i + 1); await vi.advanceTimersByTimeAsync(2_000) }
  f.peer.connectionState = 'disconnected'; await vi.advanceTimersByTimeAsync(30_000)
  expect(recover).not.toHaveBeenCalled(); monitor.stop()
})
it('allows only one asynchronous repair while preserving the monitoring budget', async () => {
  const f = fixture(); let finish!: () => void
  const recover = vi.fn(() => new Promise<void>((resolve) => { finish = resolve })), monitor = new PublisherWatchdog(f.asPeer, recover)
  monitor.start(); await vi.advanceTimersByTimeAsync(30_000)
  expect(recover).toHaveBeenCalledOnce()
  finish(); await vi.advanceTimersByTimeAsync(1); monitor.stop()
})
