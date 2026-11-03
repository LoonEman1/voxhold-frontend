import { useEffect, useMemo, useRef, useState } from 'react'
import type { PinnedMessage, SearchMessage, ServerMember, ServerRole } from '../domain/types'
import { formatDate, formatTime, humanError } from '../lib/format'
import type { VoxholdApi } from '../services/api'
import { mentionDirectory } from '../lib/mentions'
import { MentionPreview } from './MessageMentions'
import { Avatar } from './Avatar'
import { EmptyState } from './EmptyState'
import { Icon } from './Icon'
import { useDialogAction } from '../hooks/useDialogAction'

const NO_MEMBERS: ServerMember[] = []
interface MentionContext { members?: ServerMember[]; currentUserId?: number; currentRole?: ServerRole }
interface SearchPanelProps extends MentionContext {
  open: boolean
  api: VoxholdApi
  token: string
  serverId: number
  onClose: () => void
  onOpenMessage: (channelId: number, messageId: number) => void
}

export function MessageSearchPanel({ open, api, token, serverId, onClose, onOpenMessage, members = NO_MEMBERS, currentUserId = 0, currentRole }: SearchPanelProps) {
  const directory = useMemo(() => mentionDirectory(members), [members])
  const [query, setQuery] = useState('')
  const [messages, setMessages] = useState<SearchMessage[]>([])
  const [nextBeforeId, setNextBeforeId] = useState<number | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const panel = useRef<HTMLElement>(null), input = useRef<HTMLInputElement>(null), moreRequest = useRef<AbortController | null>(null)

  useEffect(() => {
    if (!open) return
    const previous = document.activeElement as HTMLElement | null, current = panel.current
    input.current?.focus({ preventScroll: true })
    return () => { if (current?.contains(document.activeElement) && previous?.isConnected) previous.focus({ preventScroll: true }) }
  }, [open])

  useEffect(() => {
    setQuery('')
    setMessages([])
    setNextBeforeId(null)
    setHasMore(false)
    setError('')
  }, [serverId])

  useEffect(() => {
    moreRequest.current?.abort(); moreRequest.current = null
    setLoadingMore(false); setLoading(false)
    if (!open) return
    const normalized = query.trim()
    if (!normalized) {
      setMessages([])
      setNextBeforeId(null)
      setHasMore(false)
      setError('')
      return
    }
    if (!/[\p{L}\p{N}]/u.test(normalized)) {
      setMessages([])
      setHasMore(false)
      setError('Введите хотя бы одну букву или цифру')
      return
    }

    const controller = new AbortController()
    setLoading(true); setError('')
    const timer = window.setTimeout(() => {
      setLoading(true)
      setError('')
      api.messages.search(token, serverId, normalized, undefined, 25, controller.signal)
        .then((page) => {
          if (controller.signal.aborted) return
          setMessages(page.messages)
          setNextBeforeId(page.pagination.next_before_id)
          setHasMore(page.pagination.has_more)
        })
        .catch((caught: unknown) => {
          if (!controller.signal.aborted) setError(humanError(caught))
        })
        .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    }, 300)

    return () => {
      window.clearTimeout(timer)
      controller.abort()
      moreRequest.current?.abort()
    }
  }, [api, open, query, serverId, token])

  const loadMore = async () => {
    const normalized = query.trim()
    if (!open || !nextBeforeId || moreRequest.current || loading || !normalized) return
    const controller = new AbortController()
    moreRequest.current = controller
    setLoadingMore(true)
    setError('')
    try {
      const page = await api.messages.search(token, serverId, normalized, nextBeforeId, 25, controller.signal)
      if (controller.signal.aborted) return
      setMessages((current) => [...current, ...page.messages.filter((message) => !current.some((item) => item.id === message.id))])
      setNextBeforeId(page.pagination.next_before_id)
      setHasMore(page.pagination.has_more)
    } catch (caught) {
      if (!controller.signal.aborted) setError(humanError(caught))
    } finally {
      if (moreRequest.current === controller) { moreRequest.current = null; setLoadingMore(false) }
    }
  }

  return (
    <aside ref={panel} className={`message-panel search-panel ${open ? 'is-open' : ''}`} aria-label="Поиск сообщений" aria-hidden={!open} inert={!open} onKeyDown={(event) => { if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); onClose() } }}>
      <header className="message-panel__header">
        <div><span className="eyebrow">ПО ВСЕМ КАНАЛАМ</span><h2>Поиск сообщений</h2></div>
        <button className="icon-button" onClick={onClose} aria-label="Закрыть поиск"><Icon name="close"/></button>
      </header>
      <div className="message-search-input">
        <Icon name="search" size={17}/>
        <input ref={input} aria-label="Поиск сообщений" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Введите слово или фразу" maxLength={200}/>
        {query && <button onClick={() => setQuery('')} aria-label="Очистить поиск"><Icon name="close" size={14}/></button>}
      </div>
      <div className="message-panel__scroll">
        {loading ? <div className="panel-loading"><span className="spinner"/>Ищем сообщения…</div> : error ? <div className="panel-error" role="alert">{error}</div> : !query.trim() ? <EmptyState icon="search" title="Найдите нужный момент">Поиск работает по всем текстовым каналам этого сервера.</EmptyState> : messages.length === 0 ? <EmptyState icon="search" title="Ничего не найдено">Попробуйте другое слово или начало слова.</EmptyState> : <>
          <div className="search-results-count">Найдено сообщений: {messages.length}{hasMore ? '+' : ''}</div>
          {messages.map((message) => <button className="search-result" key={message.id} onClick={() => onOpenMessage(message.channel_id, message.id)}>
            <div className="search-result__meta"><span><Icon name="hash" size={12}/>{message.channel_name}</span><time>{formatDate(message.created_at)} · {formatTime(message.created_at)}</time></div>
            <div className="search-result__author"><Avatar userId={message.author.user_id} name={message.author.username} size="small"/><b>{message.author.username}</b>{message.edited_at && <small>изменено</small>}</div>
            <MentionPreview content={message.content} directory={directory} currentUserId={currentUserId} currentRole={currentRole}/>
          </button>)}
          {hasMore && <button className="load-older" onClick={() => void loadMore()} disabled={loadingMore}>{loadingMore ? <span className="spinner"/> : 'Показать ещё'}</button>}
        </>}
      </div>
    </aside>
  )
}

interface PinsPanelProps extends MentionContext {
  docked?: boolean
  open: boolean
  pins: PinnedMessage[]
  loading: boolean
  canManage: boolean
  onClose: () => void
  onOpenMessage: (channelId: number, messageId: number) => void
  onUnpin: (messageId: number) => Promise<void>
}

export function PinnedMessagesPanel({ docked = false, open, pins, loading, canManage, onClose, onOpenMessage, onUnpin, members = NO_MEMBERS, currentUserId = 0, currentRole }: PinsPanelProps) {
  const directory = useMemo(() => mentionDirectory(members), [members])
  const { pending, error, run } = useDialogAction(open, pins[0]?.message.channel_id)
  const unpin = (messageId: number) => run(() => onUnpin(messageId), () => {})

  return (
    <aside className={`message-panel pins-panel ${docked ? 'message-panel--docked' : ''} ${open ? 'is-open' : ''}`} aria-hidden={!open} inert={!open}>
      <header className="message-panel__header">
        <div><span className="eyebrow">ВАЖНОЕ В КАНАЛЕ</span><h2>Закреплённые сообщения</h2></div>
        <button className="icon-button" onClick={onClose} aria-label="Закрыть закрепы"><Icon name="close"/></button>
      </header>
      {error && <div className="panel-error" role="alert">{error}</div>}
      <div className="message-panel__scroll">
        {loading ? <div className="panel-loading"><span className="spinner"/>Загружаем закрепы…</div> : pins.length === 0 ? <EmptyState icon="pin" title="Закрепов пока нет">Администратор может сохранить здесь важное сообщение.</EmptyState> : pins.map((pin) => <article className="pinned-card" key={pin.message.id}>
          <button className="pinned-card__content" onClick={() => onOpenMessage(pin.message.channel_id, pin.message.id)}>
            <div className="pinned-card__author"><Avatar userId={pin.message.author.user_id} name={pin.message.author.username} size="small"/><span><b>{pin.message.author.username}</b><small>{formatDate(pin.message.created_at)} · {formatTime(pin.message.created_at)}</small></span></div>
            <MentionPreview content={pin.message.content} directory={directory} currentUserId={currentUserId} currentRole={currentRole}/>
            <small className="pinned-card__by"><Icon name="pin" size={12}/> Закрепил {pin.pinned_by.username}</small>
          </button>
          {canManage && <button className="pinned-card__remove" onClick={() => void unpin(pin.message.id)} disabled={pending} aria-label={`Открепить сообщение от ${pin.message.author.username}`} title="Открепить"><Icon name="close" size={14}/></button>}
        </article>)}
      </div>
    </aside>
  )
}
