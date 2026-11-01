import { useEffect, useState } from 'react'
import type { ServerMember } from '../domain/types'

interface TypingDetail { channel_id: number; user_id: number; expires_at: number }

/** Text for the typing line, or an empty string when nobody is typing. */
export function typingText(names: string[]): string {
  if (names.length === 0) return ''
  if (names.length === 1) return `${names[0]} печатает…`
  if (names.length === 2) return `${names[0]} и ${names[1]} печатают…`
  return 'Несколько человек печатают…'
}

/** Shows who is typing in the channel; entries expire on their own or when the author posts. */
export function TypingIndicator({ channelId, currentUserId, membersById }: { channelId: number; currentUserId: number; membersById: ReadonlyMap<number, ServerMember> }) {
  const [typing, setTyping] = useState<Map<number, number>>(new Map())
  useEffect(() => {
    setTyping(new Map())
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<TypingDetail>).detail
      if (!detail || detail.channel_id !== channelId || detail.user_id === currentUserId) return
      setTyping((current) => {
        const next = new Map(current)
        // The server's expires_at only marks a live event (0 = posted): its
        // clock may differ from ours, so the 6 s lifetime is counted locally.
        if (detail.expires_at > 0) next.set(detail.user_id, Date.now() + 6000)
        else next.delete(detail.user_id)
        return next
      })
    }
    window.addEventListener('voxhold:typing', listener)
    const timer = window.setInterval(() => {
      setTyping((current) => {
        const now = Date.now()
        if (![...current.values()].some((until) => until <= now)) return current
        return new Map([...current].filter(([, until]) => until > now))
      })
    }, 1000)
    return () => { window.removeEventListener('voxhold:typing', listener); window.clearInterval(timer) }
  }, [channelId, currentUserId])
  const names = [...typing.keys()].map((id) => membersById.get(id)?.username ?? 'Участник')
  const text = typingText(names)
  return <div className="typing-indicator" aria-live="polite" role="status" style={{ minHeight: '1.25em', fontSize: '0.8rem', opacity: 0.75, padding: '0 16px' }}>{text}</div>
}
