import { useEffect, useState } from 'react'
import { formatDuration } from '../lib/format'

/** Ticking "m:ss" since a server-provided start time; empty when unknown. */
export function useLiveDuration(startedAtMs: number | undefined) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!startedAtMs) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [startedAtMs])
  return startedAtMs ? formatDuration(now - startedAtMs) : ''
}
