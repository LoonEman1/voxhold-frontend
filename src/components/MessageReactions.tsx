import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Message, MessageReaction, ReactorPage } from '../domain/types'
import { humanError } from '../lib/format'
import { reactionLabel, reactionOrder } from '../lib/reactionCatalog'
import { Avatar } from './Avatar'

export type ReactorLoader = (messageId: number, emoji: string, signal: AbortSignal, after?: number) => Promise<ReactorPage>
interface Cached { page: ReactorPage; at: number }
// Loader identity scopes names to the instance/account/channel, without retaining
// an old login. Each live scope retains at most 256 first pages for 20 seconds.
const caches = new WeakMap<ReactorLoader, Map<string, Cached>>()
function cacheFor(loader: ReactorLoader) {
  let cache = caches.get(loader)
  if (!cache) { cache = new Map(); caches.set(loader, cache) }
  return cache
}

export function visibleReactions(message: Message, pending: Readonly<Record<string, boolean>>): MessageReaction[] {
  const values = new Map((message.reactions ?? []).map((value) => [value.emoji, value]))
  for (const [emoji, me] of Object.entries(pending)) {
    const current = values.get(emoji) ?? { emoji, count: 0, me: false }
    values.set(emoji, { emoji, count: Math.max(0, current.count + Number(me) - Number(current.me)), me })
  }
  return [...values.values()].filter((value) => value.count > 0).sort((left, right) => reactionOrder(left.emoji) - reactionOrder(right.emoji))
}

export function MessageReactions({ message, currentUserId, pending = {}, onReact, loadReactors }: {
  message: Message; currentUserId: number; pending?: Readonly<Record<string, boolean>>; onReact?: (emoji: string) => void; loadReactors?: ReactorLoader
}) {
  const [open, setOpen] = useState<string | null>(null)
  const [page, setPage] = useState<ReactorPage | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [retry, setRetry] = useState(0), [position, setPosition] = useState({ x: 12, y: 12 })
  const anchor = useRef<HTMLButtonElement | null>(null), popover = useRef<HTMLDivElement | null>(null)
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null), closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const moreController = useRef<AbortController | null>(null), suppressFocus = useRef(false)
  const id = useId()
  const reactions = useMemo(() => visibleReactions(message, pending), [message, pending])
  useEffect(() => { if (open && !reactions.some((reaction) => reaction.emoji === open)) setOpen(null) }, [open, reactions])
  const keep = () => { if (closeTimer.current) clearTimeout(closeTimer.current) }
  const dismiss = () => {
    setOpen(null); suppressFocus.current = true
    anchor.current?.focus({ preventScroll: true })
    queueMicrotask(() => { suppressFocus.current = false })
  }
  const show = (emoji: string, element: HTMLButtonElement) => {
    keep(); if (openTimer.current) clearTimeout(openTimer.current)
    anchor.current = element
    openTimer.current = setTimeout(() => setOpen(emoji), 180)
  }
  const hide = () => {
    if (openTimer.current) clearTimeout(openTimer.current)
    keep(); closeTimer.current = setTimeout(() => setOpen(null), 140)
  }
  useEffect(() => () => { if (openTimer.current) clearTimeout(openTimer.current); if (closeTimer.current) clearTimeout(closeTimer.current); moreController.current?.abort() }, [])
  useLayoutEffect(() => {
    if (!open || !anchor.current || !popover.current) return
    const button = anchor.current.getBoundingClientRect(), box = popover.current.getBoundingClientRect()
    const y = button.bottom + 8 + box.height <= window.innerHeight - 12 ? button.bottom + 8 : button.top - box.height - 8
    setPosition({ x: Math.max(12, Math.min(button.left, window.innerWidth - box.width - 12)), y: Math.max(12, y) })
  }, [open, page, busy, error])
  useEffect(() => {
    moreController.current?.abort()
    if (!open) return
    const controller = new AbortController()
    setPage(null); setError(''); setBusy(true)
    const closeOnOutside = (event: Event) => { if (!popover.current?.contains(event.target as Node) && !anchor.current?.contains(event.target as Node)) setOpen(null) }
    document.addEventListener('pointerdown', closeOnOutside, true); document.addEventListener('scroll', closeOnOutside, true); window.addEventListener('resize', closeOnOutside)
    const cache = loadReactors ? cacheFor(loadReactors) : null
    const key = `${message.id}:${open}:${message.reactions_revision ?? 0}`
    const cached = cache?.get(key)
    if (cached && Date.now() - cached.at < 20_000) { setPage(cached.page); setBusy(false) }
    else if (loadReactors) {
      void loadReactors(message.id, open, controller.signal).then((value) => {
        if (controller.signal.aborted) return
        setPage(value); setBusy(false)
        cache!.delete(key); cache!.set(key, { page: value, at: Date.now() })
        while (cache!.size > 256) cache!.delete(cache!.keys().next().value!)
      }).catch((caught: unknown) => { if (!controller.signal.aborted) { setError(humanError(caught)); setBusy(false) } })
    } else { setBusy(false); setError('Список участников недоступен') }
    return () => { controller.abort(); moreController.current?.abort(); document.removeEventListener('pointerdown', closeOnOutside, true); document.removeEventListener('scroll', closeOnOutside, true); window.removeEventListener('resize', closeOnOutside) }
  }, [open, loadReactors, message.id, message.reactions_revision, retry])
  const more = async () => {
    if (!open || !loadReactors || busy || !page?.has_more || !page.next_user_id) return
    const controller = new AbortController(); moreController.current = controller
    setBusy(true); setError('')
    try {
      const next = await loadReactors(message.id, open, controller.signal, page.next_user_id)
      if (!controller.signal.aborted) setPage((current) => ({ ...next, users: [...new Map([...(current?.users ?? []), ...next.users].map((user) => [user.user_id, user])).values()] }))
    } catch (caught) { if (!controller.signal.aborted) setError(humanError(caught)) }
    finally { if (!controller.signal.aborted) setBusy(false) }
  }
  if (!reactions.length) return null
  return <div className="message-reactions" aria-label="Реакции на сообщение">{reactions.map((reaction) => <button type="button" key={reaction.emoji} className={`message-reaction ${reaction.me ? 'is-mine' : ''} ${Object.hasOwn(pending, reaction.emoji) ? 'is-pending' : ''}`} aria-pressed={reaction.me} aria-label={`${reactionLabel(reaction.emoji)}: ${reaction.count}${reaction.me ? ', ваша реакция' : ''}`} aria-describedby={open === reaction.emoji ? id : undefined} disabled={!onReact || Object.hasOwn(pending, reaction.emoji)} onPointerEnter={(event) => show(reaction.emoji, event.currentTarget)} onPointerLeave={hide} onFocus={(event) => { if (!suppressFocus.current) show(reaction.emoji, event.currentTarget) }} onBlur={(event) => { if (!popover.current?.contains(event.relatedTarget as Node)) hide() }} onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); dismiss() } }} onClick={() => onReact?.(reaction.emoji)}><span>{reaction.emoji}</span><b>{reaction.count}</b></button>)}
    {open && createPortal(<div ref={popover} id={id} className="reaction-people" role="dialog" aria-label={`Кто поставил реакцию «${reactionLabel(open)}»`} style={{ left: position.x, top: position.y }} onPointerEnter={keep} onPointerLeave={hide} onFocus={keep} onBlur={(event) => { if (!popover.current?.contains(event.relatedTarget as Node)) hide() }} onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); dismiss() } }}><header><span>{open}</span><div><b>{reactionLabel(open)}</b><small>Участников: {message.reactions?.find((value) => value.emoji === open)?.count ?? 0}</small></div></header><div className="reaction-people__list">{page?.users.map((user) => <div key={user.user_id}><Avatar userId={user.user_id} name={user.username} size="small"/><span>{user.username}</span>{user.user_id === currentUserId && <small>вы</small>}</div>)}{busy && !page && <p role="status"><span className="spinner"/>Загружаем участников…</p>}{!busy && page?.users.length === 0 && <p>Реакцию уже убрали</p>}</div>{error && <div className="reaction-people__error" role="alert">{error}<button type="button" onClick={() => { if (page?.has_more) void more(); else { if (loadReactors && open) cacheFor(loadReactors).delete(`${message.id}:${open}:${message.reactions_revision ?? 0}`); setRetry((value) => value + 1) } }}>Повторить</button></div>}{page?.has_more && <button className="reaction-people__more" type="button" disabled={busy} onClick={() => void more()}>{busy ? 'Загружаем…' : 'Показать ещё'}</button>}</div>, document.fullscreenElement ?? document.body)}
  </div>
}
