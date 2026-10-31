const busy = new Set([429, 503])

/** Retry only explicit server-busy answers; mutations with network failures are not replayed. */
export async function retryBusy<T>(signal: AbortSignal, load: () => Promise<T>, attempts = 4, onRetry?: () => void): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
    try { return await load() } catch (error) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
      if (!error || typeof error !== 'object' || !('status' in error) || typeof error.status !== 'number' || !busy.has(error.status) || attempt >= attempts - 1) throw error
      const hinted = 'retryAfterMs' in error && typeof error.retryAfterMs === 'number' && Number.isFinite(error.retryAfterMs) ? Math.min(30_000, Math.max(0, error.retryAfterMs)) : undefined
      onRetry?.()
      await waitForRetry(signal, (hinted ?? 500 * 2 ** attempt) + Math.random() * 250)
    }
  }
}

export function waitForRetry(signal: AbortSignal, delay: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(new DOMException('Aborted', 'AbortError')) }
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve() }, delay)
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
  })
}
