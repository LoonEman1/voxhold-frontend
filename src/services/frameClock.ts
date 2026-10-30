/** A disposable worker clock for hidden-tab canvas capture, with a timer fallback. */
export function startFrameClock(intervalMs: number, tick: () => void): () => void {
  let stopped = false, worker: Worker | undefined, timer: number | null = null
  const run = () => { if (!stopped) tick() }
  const fallback = () => {
    if (stopped || timer !== null) return
    worker?.terminate(); worker = undefined
    timer = window.setInterval(run, intervalMs)
  }
  if (typeof Worker !== 'undefined') {
    try {
      worker = new Worker(new URL('./frameClock.worker.ts', import.meta.url), { type: 'module' })
      worker.onmessage = run
      worker.onerror = (event) => { event.preventDefault(); fallback() }
      worker.postMessage({ intervalMs })
    } catch { fallback() }
  } else fallback()
  return () => {
    if (stopped) return
    stopped = true
    worker?.terminate(); worker = undefined
    if (timer !== null) window.clearInterval(timer)
  }
}
