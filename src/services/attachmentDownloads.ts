const limit = 4
let active = 0
const queue: (() => void)[] = []

// Keep gallery/history mounts below the API burst budget. Aborted queued work
// is rejected without fetching; slots are returned even when a request fails.
export async function attachmentDownload<T>(signal: AbortSignal, fetch: () => Promise<T>): Promise<T> {
  await new Promise<void>((resolve, reject) => {
    const abort = () => {
      const index = queue.indexOf(start)
      if (index >= 0) queue.splice(index, 1)
      reject(new DOMException('Download aborted', 'AbortError'))
    }
    const start = () => { signal.removeEventListener('abort', abort); active++; resolve() }
    if (signal.aborted) { abort(); return }
    if (active < limit) start()
    else { queue.push(start); signal.addEventListener('abort', abort, { once: true }) }
  })
  try {
    if (signal.aborted) throw new DOMException('Download aborted', 'AbortError')
    return await fetch()
  } finally { active--; queue.shift()?.() }
}
