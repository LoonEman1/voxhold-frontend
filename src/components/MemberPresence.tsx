import { useEffect, useState } from 'react'
import { relativeTime } from '../lib/format'

const exact = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'long', timeStyle: 'short' })

/** One clock per mounted list, rather than a timer per member. */
export function usePresenceClock(enabled = true) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (!enabled) return
    setNow(Date.now())
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') setNow(Date.now()) }, 30_000)
    const visible = () => { if (document.visibilityState === 'visible') setNow(Date.now()) }
    document.addEventListener('visibilitychange', visible)
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', visible) }
  }, [enabled])
  return now
}

export function MemberPresence({ online, lastSeenAt, now = Date.now() }: { online: boolean; lastSeenAt: number | null; now?: number }) {
  if (online) return <span className="member-presence member-presence--online">Сейчас в сети</span>
  if (!lastSeenAt || !Number.isFinite(lastSeenAt)) return <span className="member-presence">Нет данных об активности</span>
  const date = new Date(lastSeenAt * 1000)
  const relative = now - lastSeenAt * 1000 < 60_000 ? 'только что' : relativeTime(lastSeenAt, now)
  return <time className="member-presence" dateTime={date.toISOString()} title={`Последний раз в сети: ${exact.format(date)}`}>Был в сети {relative}</time>
}
