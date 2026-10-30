/**
 * Calls `tick` every `intervalMs`, also while the page is hidden. Background
 * tabs stop video frame callbacks and throttle window timers to about 1 Hz;
 * a dedicated worker's timer keeps its rate. Returns the stop function.
 */
export function startFrameClock(intervalMs: number, tick: () => void): () => void {
  if (typeof Worker !== 'undefined') {
    try {
      const worker = new Worker(new URL('./frameClock.worker.ts', import.meta.url), { type: 'module' })
      worker.onmessage = () => tick()
      worker.postMessage({ intervalMs })
      return () => worker.terminate()
    } catch {
      // Workers can be blocked by policy; a throttled window timer still ticks.
    }
  }
  const timer = window.setInterval(tick, intervalMs)
  return () => window.clearInterval(timer)
}
