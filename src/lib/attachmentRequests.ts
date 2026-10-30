let active = 0
const waiting = new Set<() => void>()

/** Bound image decoding/download pressure across all mounted chat views. */
export async function attachmentRequest<T>(signal: AbortSignal, load: () => Promise<T>): Promise<T> {
  while (active >= 2) {
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => { waiting.delete(wake); signal.removeEventListener('abort', abort) }
      const wake = () => { cleanup(); resolve() }
      const abort = () => { cleanup(); reject(new DOMException('Aborted', 'AbortError')) }
      waiting.add(wake)
      signal.addEventListener('abort', abort, { once: true })
      if (signal.aborted) abort()
    })
  }
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
  active++
  try { return await load() }
  finally { active--; waiting.values().next().value?.() }
}
