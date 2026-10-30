/// <reference lib="webworker" />

// Dedicated worker timers keep their rate while the page is hidden; window
// timers of a background tab are throttled to about once per second.
let timer: ReturnType<typeof setInterval> | undefined

self.onmessage = ({ data }: MessageEvent<{ intervalMs?: number }>) => {
  if (timer !== undefined) clearInterval(timer)
  timer = undefined
  if (data.intervalMs && data.intervalMs > 0) timer = setInterval(() => self.postMessage(0), data.intervalMs)
}
