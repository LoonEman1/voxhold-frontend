import { useEffect, useState } from 'react'
import type { PinnedMessage, SearchMessage } from '../domain/types'
import { formatDate, formatTime, humanError } from '../lib/format'
import type { VoxholdApi } from '../services/api'
import { Avatar } from './Avatar'
import { EmptyState } from './EmptyState'
import { Icon } from './Icon'

interface SearchPanelProps {
  open: boolean
  api: VoxholdApi
  token: string
  serverId: number
  onClose: () => void
  onOpenMessage: (channelId: number, messageId: number) => void
}

export function MessageSearchPanel({ open, api, token, serverId, onClose, onOpenMessage }: SearchPanelProps) {
  const [query, setQuery] = useState('')
  const [messages, setMessages] = useState<SearchMessage[]>([])
  const [nextBeforeId, setNextBeforeId] = useState<number | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    setQuery('')
    setMessages([])
    setNextBeforeId(null)
    setHasMore(false)
    setError('')
  }, [serverId])

  useEffect(() => {
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
    const timer = window.setTimeout(() => {
      setLoading(true)
      setError('')
      api.messages.search(token, serverId, normalized, undefined, 25, controller.signal)
        .then((page) => {
          setMessages(page.messages)
          setNextBeforeId(page.pagination.next_before_id)
          setHasMore(page.pagination.has_more)
        })
        .catch((caught: unknown) => {
          if (!(caught instanceof DOMException && caught.name === 'AbortError')) setError(humanError(caught))
        })
        .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    }, 300)

    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [api, open, query, serverId, token])

  const loadMore = async () => {
    const normalized = query.trim()
    if (!nextBeforeId || loadingMore || !normalized) return
    setLoadingMore(true)
    setError('')
    try {
      const page = await api.messages.search(token, serverId, normalized, nextBeforeId)
      setMessages((current) => [...current, ...page.messages.filter((message) => !current.some((item) => item.id === message.id))])
      setNextBeforeId(page.pagination.next_before_id)
      setHasMore(page.pagination.has_more)
    } catch (caught) {
      setError(humanError(caught))
    } finally {
      setLoadingMore(false)
    }
  }

  return (
    <aside className={`message-panel search-panel ${open ? 'is-open' : ''}`} aria-hidden={!open}>
      <header className="message-panel__header">
        <div><span className="eyebrow">ПО ВСЕМ КАНАЛАМ</span><h2>Поиск сообщений</h2></div>
        <button className="icon-button" onClick={onClose} aria-label="Закрыть поиск"><Icon name="close"/></button>
      </header>
      <div className="message-search-input">
        <Icon name="search" size={17}/>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Введите слово или фразу" maxLength={200} autoFocus={open}/>
        {query && <button onClick={() => setQuery('')} aria-label="Очистить поиск"><Icon name="close" size={14}/></button>}
      </div>
      <div className="message-panel__scroll">
        {loading ? <div className="panel-loading"><span className="spinner"/>Ищем сообщения…</div> : error ? <div className="panel-error" role="alert">{error}</div> : !query.trim() ? <EmptyState icon="search" title="Найдите нужный момент">Поиск работает по всем текстовым каналам этого сервера.</EmptyState> : messages.length === 0 ? <EmptyState icon="search" title="Ничего не найдено">Попробуйте другое слово или начало слова.</EmptyState> : <>
          <div className="search-results-count">Найдено сообщений: {messages.length}{hasMore ? '+' : ''}</div>
          {messages.map((message) => <button className="search-result" key={message.id} onClick={() => onOpenMessage(message.channel_id, message.id)}>
            <div className="search-result__meta"><span><Icon name="hash" size={12}/>{message.channel_name}</span><time>{formatDate(message.created_at)} · {formatTime(message.created_at)}</time></div>
            <div className="search-result__author"><Avatar name={message.author.username} size="small"/><b>{message.author.username}</b>{message.edited_at && <small>изменено</small>}</div>
            <p>{message.content}</p>
          </button>)}
          {hasMore && <button className="load-older" onClick={() => void loadMore()} disabled={loadingMore}>{loadingMore ? <span className="spinner"/> : 'Показать ещё'}</button>}
        </>}
      </div>
    </aside>
  )
}

interface PinsPanelProps {
  open: boolean
  pins: PinnedMessage[]
  loading: boolean
  canManage: boolean
  onClose: () => void
  onOpenMessage: (channelId: number, messageId: number) => void
  onUnpin: (messageId: number) => Promise<void>
}

export function PinnedMessagesPanel({ open, pins, loading, canManage, onClose, onOpenMessage, onUnpin }: PinsPanelProps) {
  const [pendingId, setPendingId] = useState<number | null>(null)
  const [error, setError] = useState('')

  useEffect(() => { if (!open) { setPendingId(null); setError('') } }, [open])

  const unpin = async (messageId: number) => {
    setPendingId(messageId)
    setError('')
    try { await onUnpin(messageId) } catch (caught) { setError(humanError(caught)) } finally { setPendingId(null) }
  }

  return (
    <aside className={`message-panel pins-panel ${open ? 'is-open' : ''}`} aria-hidden={!open}>
      <header className="message-panel__header">
        <div><span className="eyebrow">ВАЖНОЕ В КАНАЛЕ</span><h2>Закреплённые сообщения</h2></div>
        <button className="icon-button" onClick={onClose} aria-label="Закрыть закрепы"><Icon name="close"/></button>
      </header>
      <div className="message-panel__scroll">
        {loading ? <div className="panel-loading"><span className="spinner"/>Загружаем закрепы…</div> : error ? <div className="panel-error" role="alert">{error}</div> : pins.length === 0 ? <EmptyState icon="pin" title="Закрепов пока нет">Администратор может сохранить здесь важное сообщение.</EmptyState> : pins.map((pin) => <article className="pinned-card" key={pin.message.id}>
          <button className="pinned-card__content" onClick={() => onOpenMessage(pin.message.channel_id, pin.message.id)}>
            <div className="pinned-card__author"><Avatar name={pin.message.author.username} size="small"/><span><b>{pin.message.author.username}</b><small>{formatDate(pin.message.created_at)} · {formatTime(pin.message.created_at)}</small></span></div>
            <p>{pin.message.content}</p>
            <small className="pinned-card__by"><Icon name="pin" size={12}/> Закрепил {pin.pinned_by.username}</small>
          </button>
          {canManage && <button className="pinned-card__remove" onClick={() => void unpin(pin.message.id)} disabled={pendingId === pin.message.id} title="Открепить"><Icon name="close" size={14}/></button>}
        </article>)}
      </div>
    </aside>
  )
}
