import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import type { Channel, ChannelRead, Message, ServerMember, ServerRole } from '../domain/types'
import { formatDate, formatTime } from '../lib/format'
import { roleMeta } from '../lib/roles'
import { Avatar } from './Avatar'
import { EmptyState } from './EmptyState'
import { Icon } from './Icon'

interface ChatPanelProps {
  channel: Channel | null
  messages: Message[]
  loading: boolean
  loadingOlder: boolean
  hasMore: boolean
  loadingNewer: boolean
  hasNewer: boolean
  currentUserId: number
  canManage: boolean
  members: ServerMember[]
  pinnedMessageIds: ReadonlySet<number>
  focusedMessageId: number | null
  channelReads: Readonly<Record<number, ChannelRead>>
  onLoadOlder: () => Promise<void>
  onLoadNewer: () => Promise<void>
  onReturnToLatest: () => Promise<void>
  onReadThrough: (messageId: number) => void
  onSend: (content: string) => Promise<void>
  onEdit: (messageId: number, content: string) => Promise<void>
  onDelete: (messageId: number) => Promise<void>
  onTogglePin: (messageId: number, pinned: boolean) => Promise<void>
  onOpenProfile: (userId: number, username: string, role: ServerRole) => void
}

function sameDay(left: number, right: number) {
  const a = new Date(left * 1000)
  const b = new Date(right * 1000)
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

export function ChatPanel({ channel, messages, loading, loadingOlder, hasMore, loadingNewer, hasNewer, currentUserId, canManage, members, pinnedMessageIds, focusedMessageId, channelReads, onLoadOlder, onLoadNewer, onReturnToLatest, onReadThrough, onSend, onEdit, onDelete, onTogglePin, onOpenProfile }: ChatPanelProps) {
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState('')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editDraft, setEditDraft] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null)
  const [pendingActionId, setPendingActionId] = useState<number | null>(null)
  const [actionError, setActionError] = useState<{ id: number; message: string } | null>(null)
  const [showReturnToLatest, setShowReturnToLatest] = useState(false)
  const [returningToLatest, setReturningToLatest] = useState(false)
  const [receiptMessageId, setReceiptMessageId] = useState<number | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const topSentinelRef = useRef<HTMLDivElement>(null)
  const bottomSentinelRef = useRef<HTMLDivElement>(null)
  const autoLoadingOlderRef = useRef(false)
  const autoLoadingNewerRef = useRef(false)
  const previousChannel = useRef<number | null>(null)
  const pendingChannelScroll = useRef<number | null>(null)
  const previousMessageCount = useRef(0)
  const previousFocus = useRef<number | null>(null)
  const readFrameRef = useRef<number | null>(null)
  const onReadThroughRef = useRef(onReadThrough)
  onReadThroughRef.current = onReadThrough

  const scheduleReadCheck = () => {
    if (readFrameRef.current !== null) window.cancelAnimationFrame(readFrameRef.current)
    readFrameRef.current = window.requestAnimationFrame(() => {
      readFrameRef.current = null
      const container = scrollRef.current
      if (!container || document.visibilityState !== 'visible' || !document.hasFocus()) return
      const rootRect = container.getBoundingClientRect()
      let latestVisibleMessageId = 0
      container.querySelectorAll<HTMLElement>('[data-message-id]').forEach((element) => {
        const rect = element.getBoundingClientRect()
        if (rect.bottom > rootRect.top && rect.top < rootRect.bottom) {
          latestVisibleMessageId = Math.max(latestVisibleMessageId, Number(element.dataset.messageId) || 0)
        }
      })
      if (latestVisibleMessageId > 0) onReadThroughRef.current(latestVisibleMessageId)
    })
  }

  useLayoutEffect(() => {
    const container = scrollRef.current
    if (!container) return
    if (!channel) {
      previousChannel.current = null
      pendingChannelScroll.current = null
      previousMessageCount.current = 0
      return
    }
    const channelChanged = previousChannel.current !== channel.id
    if (channelChanged) {
      previousChannel.current = channel.id
      pendingChannelScroll.current = channel.id
      previousMessageCount.current = 0
      previousFocus.current = null
    }
    if (loading) return
    if (!focusedMessageId) previousFocus.current = null
    if (focusedMessageId && previousFocus.current !== focusedMessageId) {
      const target = container.querySelector<HTMLElement>(`[data-message-id="${focusedMessageId}"]`)
      if (target) {
        target.scrollIntoView({ block: 'center', behavior: 'auto' })
        previousFocus.current = focusedMessageId
        pendingChannelScroll.current = null
        previousMessageCount.current = messages.length
        return
      }
    }
    if (pendingChannelScroll.current === channel.id) {
      container.scrollTop = container.scrollHeight
      pendingChannelScroll.current = null
      previousMessageCount.current = messages.length
      return
    }
    const wasNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 180
    if (messages.length > previousMessageCount.current && wasNearBottom) {
      container.scrollTop = container.scrollHeight
    }
    previousMessageCount.current = messages.length
  }, [channel, focusedMessageId, loading, messages])

  useEffect(() => {
    const root = scrollRef.current
    const sentinel = topSentinelRef.current
    if (!root || !sentinel || loading || !hasMore || loadingOlder || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver((entries) => {
      if (!entries[0]?.isIntersecting || autoLoadingOlderRef.current) return
      autoLoadingOlderRef.current = true
      const previousHeight = root.scrollHeight
      const previousTop = root.scrollTop
      void onLoadOlder().finally(() => {
        window.requestAnimationFrame(() => {
          root.scrollTop = previousTop + root.scrollHeight - previousHeight
          autoLoadingOlderRef.current = false
        })
      })
    }, { root, rootMargin: '260px 0px 0px' })
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [hasMore, loading, loadingOlder, onLoadOlder])

  useEffect(() => {
    const root = scrollRef.current
    const sentinel = bottomSentinelRef.current
    if (!root || !sentinel || loading || !hasNewer || loadingNewer || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver((entries) => {
      if (!entries[0]?.isIntersecting || autoLoadingNewerRef.current) return
      autoLoadingNewerRef.current = true
      void onLoadNewer().finally(() => { autoLoadingNewerRef.current = false })
    }, { root, rootMargin: '0px 0px 260px' })
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [hasNewer, loading, loadingNewer, onLoadNewer])

  const updateReturnVisibility = () => {
    const container = scrollRef.current
    if (!container) return
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight
    setShowReturnToLatest(distanceFromBottom > Math.max(container.clientHeight, 420))
  }

  useEffect(() => { updateReturnVisibility() }, [hasNewer, loading, messages])

  useEffect(() => {
    if (!loading) scheduleReadCheck()
  }, [loading, messages])

  useEffect(() => {
    const check = () => scheduleReadCheck()
    document.addEventListener('visibilitychange', check)
    window.addEventListener('focus', check)
    return () => {
      document.removeEventListener('visibilitychange', check)
      window.removeEventListener('focus', check)
      if (readFrameRef.current !== null) window.cancelAnimationFrame(readFrameRef.current)
    }
  }, [])

  const returnToLatest = async () => {
    if (returningToLatest) return
    setReturningToLatest(true)
    try {
      await onReturnToLatest()
      window.requestAnimationFrame(() => {
        const container = scrollRef.current
        if (container) container.scrollTop = container.scrollHeight
        setShowReturnToLatest(false)
      })
    } finally {
      setReturningToLatest(false)
    }
  }

  useEffect(() => {
    setDraft('')
    setSendError('')
    setEditingId(null)
    setConfirmDeleteId(null)
    setActionError(null)
    setReceiptMessageId(null)
    previousFocus.current = null
    if (!channel) {
      previousChannel.current = null
      pendingChannelScroll.current = null
      previousMessageCount.current = 0
    }
  }, [channel?.id])

  const submit = async (event?: FormEvent) => {
    event?.preventDefault()
    const content = draft.trim()
    if (!content || sending) return
    setSending(true); setSendError('')
    try { await onSend(content); setDraft('') } catch (error) { setSendError(error instanceof Error ? error.message : 'Не удалось отправить') } finally { setSending(false) }
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void submit() }
  }

  const saveEdit = async (messageId: number) => {
    const content = editDraft.trim()
    if (!content || pendingActionId !== null) return
    setPendingActionId(messageId)
    setActionError(null)
    try {
      await onEdit(messageId, content)
      setEditingId(null)
      setEditDraft('')
    } catch (error) {
      setActionError({ id: messageId, message: error instanceof Error ? error.message : 'Не удалось изменить сообщение' })
    } finally {
      setPendingActionId(null)
    }
  }

  const remove = async (messageId: number) => {
    if (pendingActionId !== null) return
    setPendingActionId(messageId)
    setActionError(null)
    try {
      await onDelete(messageId)
      setConfirmDeleteId(null)
    } catch (error) {
      setActionError({ id: messageId, message: error instanceof Error ? error.message : 'Не удалось удалить сообщение' })
    } finally {
      setPendingActionId(null)
    }
  }

  const togglePin = async (messageId: number, pinned: boolean) => {
    if (pendingActionId !== null) return
    setPendingActionId(messageId)
    setActionError(null)
    try {
      await onTogglePin(messageId, pinned)
    } catch (error) {
      setActionError({ id: messageId, message: error instanceof Error ? error.message : 'Не удалось изменить закреп' })
    } finally {
      setPendingActionId(null)
    }
  }

  if (!channel) return <section className="chat-panel"><EmptyState icon="message" title="Выберите канал">Откройте текстовый канал слева, чтобы начать разговор.</EmptyState></section>
  if (channel.kind === 'voice') return (
    <section className="chat-panel voice-room">
      <div className="voice-orbit"><span><Icon name="volume" size={34}/></span><i/><i/><i/></div>
      <span className="eyebrow">ГОЛОСОВАЯ КОМНАТА</span><h2>{channel.name}</h2><p>Комната готова. Голосовой медиатранспорт появится после подключения WebRTC на сервере.</p><button className="button button--secondary" disabled><Icon name="mic"/> Голос скоро</button>
    </section>
  )

  return (
    <section className="chat-panel">
      <div className="messages" ref={scrollRef} onScroll={() => { updateReturnVisibility(); scheduleReadCheck() }}>
        <div className={`message-page-sentinel message-page-sentinel--top ${hasMore ? 'is-active' : ''}`} ref={topSentinelRef}>{loadingOlder && <><span className="spinner"/> Загружаем предыдущие…</>}</div>
        {loading ? <div className="message-skeletons">{Array.from({ length: 5 }).map((_, index) => <div className="message-skeleton" key={index}><i/><span><b/><small/></span></div>)}</div> : messages.length === 0 ? (
          <div className="channel-start"><span><Icon name="hash" size={30}/></span><h2>Начало канала #{channel.name}</h2><p>Первое сообщение задаёт настроение. Сделайте его хорошим.</p></div>
        ) : messages.map((message, index) => {
          const role = members.find((member) => member.user_id === message.author.user_id)?.role ?? 'member'
          const mine = message.author.user_id === currentUserId
          const readers = mine ? members.filter((member) => member.user_id !== currentUserId && (channelReads[member.user_id]?.last_read_message_id ?? 0) >= message.id) : []
          const pinned = pinnedMessageIds.has(message.id)
          const previous = messages[index - 1]
          const showDate = !previous || !sameDay(previous.created_at, message.created_at)
          const grouped = previous && previous.author.user_id === message.author.user_id && message.created_at - previous.created_at < 300 && !showDate
          return (
            <div key={message.id}>
              {showDate && <div className="date-divider"><span>{formatDate(message.created_at)}</span></div>}
              <article data-message-id={message.id} className={`message ${grouped ? 'message--grouped' : ''} ${mine ? 'message--mine' : ''} ${pinned ? 'message--pinned' : ''} ${focusedMessageId === message.id ? 'message--focused' : ''}`}>
                {!grouped && <button className="message__avatar-button" onClick={() => onOpenProfile(message.author.user_id, message.author.username, role)} aria-label={`Открыть профиль ${message.author.username}`}><Avatar name={message.author.username}/></button>}
                <div className="message__body">
                  {!grouped && <header><button className={`message__author message__author--${role}`} onClick={() => onOpenProfile(message.author.user_id, message.author.username, role)}>{message.author.username}</button><span className={`role-badge role-badge--${role}`}>{roleMeta[role].shortLabel}</span>{mine && <span className="you-tag">вы</span>}<time dateTime={new Date(message.created_at * 1000).toISOString()}>{formatTime(message.created_at)}</time></header>}
                  {pinned && <span className="message__pin-label"><Icon name="pin" size={11}/> Закреплено</span>}
                  {editingId === message.id ? <div className="message-editor">
                    <textarea value={editDraft} onChange={(event) => setEditDraft(event.target.value)} onKeyDown={(event) => {
                      if (event.key === 'Escape') setEditingId(null)
                      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void saveEdit(message.id) }
                    }} maxLength={5120} rows={3} autoFocus/>
                    <div><small>Ctrl + Enter — сохранить</small><button className="button button--ghost button--small" onClick={() => setEditingId(null)}>Отмена</button><button className="button button--primary button--small" onClick={() => void saveEdit(message.id)} disabled={!editDraft.trim() || pendingActionId === message.id}>{pendingActionId === message.id ? <span className="spinner"/> : 'Сохранить'}</button></div>
                  </div> : <p>{message.content}{message.edited_at && <span className="message__edited"> (изменено)</span>}</p>}
                  {actionError?.id === message.id && <div className="message__error">{actionError.message}</div>}
                </div>
                {mine && editingId !== message.id && <>
                  <button type="button" className={`message__delivery ${readers.length ? 'is-read' : ''}`} title={readers.length ? `Прочитали: ${readers.map((reader) => reader.username).join(', ')}` : 'Сообщение сохранено на сервере'} aria-label={readers.length ? `Прочитано: ${readers.map((reader) => reader.username).join(', ')}` : 'Доставлено на сервер'} onClick={() => setReceiptMessageId((current) => current === message.id ? null : message.id)}><span><Icon name="check" size={11}/>{readers.length > 0 && <Icon name="check" size={11}/>}</span></button>
                  {receiptMessageId === message.id && <div className="message-readers"><header><b>{readers.length ? 'Прочитали' : 'Статус сообщения'}</b><button onClick={() => setReceiptMessageId(null)} aria-label="Закрыть"><Icon name="close" size={12}/></button></header>{readers.length ? readers.map((reader) => <div key={reader.user_id}><Avatar name={reader.username} size="small"/><span><b>{reader.username}</b><small>{roleMeta[reader.role].label}</small></span></div>) : <p><Icon name="check" size={13}/> Сохранено на сервере. Пока никто не прочитал.</p>}</div>}
                </>}
                {grouped && <time className="message__hover-time">{formatTime(message.created_at)}</time>}
                {editingId !== message.id && (mine || canManage) && <div className="message__actions">
                  {canManage && <button onClick={() => void togglePin(message.id, pinned)} disabled={pendingActionId === message.id} title={pinned ? 'Открепить' : 'Закрепить'} className={pinned ? 'is-active' : ''}><Icon name="pin" size={14}/></button>}
                  {mine && <button onClick={() => { setEditingId(message.id); setEditDraft(message.content); setConfirmDeleteId(null); setActionError(null) }} title="Редактировать"><Icon name="edit" size={14}/></button>}
                  {(mine || canManage) && <button className="is-danger" onClick={() => setConfirmDeleteId(message.id)} title="Удалить"><Icon name="trash" size={14}/></button>}
                </div>}
                {confirmDeleteId === message.id && <div className="message-delete-confirm"><span>Удалить сообщение?</span><button onClick={() => setConfirmDeleteId(null)}>Нет</button><button className="is-danger" onClick={() => void remove(message.id)} disabled={pendingActionId === message.id}>Да</button></div>}
              </article>
            </div>
          )
        })}
        <div className={`message-page-sentinel message-page-sentinel--bottom ${hasNewer ? 'is-active' : ''}`} ref={bottomSentinelRef}>{loadingNewer && <><span className="spinner"/> Загружаем следующие…</>}</div>
      </div>
      {showReturnToLatest && <button className="return-to-latest" onClick={() => void returnToLatest()} disabled={returningToLatest} title="Вернуться к актуальным сообщениям">{returningToLatest ? <span className="spinner"/> : <Icon name="chevron" size={17}/>}<span>К новым сообщениям</span></button>}
      <form className="composer" onSubmit={submit}>
        <button type="button" className="composer__action" aria-label="Добавить файл" title="Вложения появятся позже"><Icon name="add"/></button>
        <textarea rows={1} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKeyDown} placeholder={`Написать в #${channel.name}`} maxLength={5120} aria-label={`Сообщение в ${channel.name}`} />
        <button type="button" className="composer__emoji" aria-label="Эмодзи"><Icon name="emoji"/></button>
        <button type="submit" className="composer__send" disabled={!draft.trim() || sending} aria-label={sending ? 'Отправляется' : 'Отправить'}>{sending ? <span className="spinner"/> : <Icon name="send"/>}</button>
        {sendError && <div className="composer__error">{sendError}</div>}
      </form>
    </section>
  )
}
