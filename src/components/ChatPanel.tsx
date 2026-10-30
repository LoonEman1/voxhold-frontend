import { CustomRoleBadges, useCommunity } from './Community'
import { ComposerTools, PollCard, saveFavorite } from './CommunityFeatures'
import { MessageAttachments, useAttachmentUpload } from './MessageAttachments'
import type { ChatViewport, PendingMessage } from '../services/channelHistory'
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type ReactNode, type MouseEvent as ReactMouseEvent } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { preferNativeContextMenu } from '../lib/contextMenu'
import { useMemberIdentity } from '../hooks/useMemberIdentity'
import type { VoxholdApi } from '../services/api'
import type { Channel, ChannelRead, Message, MessageReply, ServerMember, ServerRole } from '../domain/types'
import { formatDate, formatTime } from '../lib/format'
import { roleMeta } from '../lib/roles'
import { Avatar } from './Avatar'
import { MessageAvatar, MessageHeader } from './MessageIdentity'
import { mentionDirectory, parseMentions, mentionsMe } from '../lib/mentions'
import { MessageMentions } from './MessageMentions'
import { MentionComposer } from './MentionComposer'
import { EmptyState } from './EmptyState'
import { Icon } from './Icon'
import { MessageContextMenu } from './MessageContextMenu'
import { MessageReactions, type ReactorLoader } from './MessageReactions'
import { MessageQuote, ForwardAttribution, readableMessage } from './MessageQuote'
import { rememberReaction } from '../lib/reactionCatalog'

interface ChatPanelProps {
  threadRootId?: number
  canCompose?: boolean
  allowPin?: boolean
  readOnlyLabel?: string
  emptyLabel?: string
  renderComments?: (post: Message, onClose: () => void) => ReactNode
  pendingMessages?: PendingMessage[]
  onRetryPending?: (message: PendingMessage) => void
  onDismissPending?: (id: string) => void
  initialViewport?: ChatViewport
  onViewport?: (viewport: ChatViewport) => void
  channel: Channel | null
  messages: Message[]
  loading: boolean
  loadingOlder: boolean
  hasMore: boolean
  loadingNewer: boolean
  hasNewer: boolean
  currentUserId: number
  currentRole?: ServerRole
  canManage: boolean
  members: ServerMember[]
  pinnedMessageIds: ReadonlySet<number>
  focusVersion?: number
  focusedMessageId: number | null
  channelReads: Readonly<Record<number, ChannelRead>>
  onLoadOlder: () => Promise<void>
  onLoadNewer: () => Promise<void>
  onReturnToLatest: () => Promise<void>
  onReadThrough: (messageId: number) => void
  onSend: (content: string, reply?: MessageReply, attachmentIds?: string[]) => Promise<void>
  onSetReaction?: (messageId: number, emoji: string, active: boolean) => Promise<void>
  onLoadReactors?: ReactorLoader
  onForward?: (message: Message) => void
  onOpenMessage?: (messageId: number) => void
  isMessageDeleted?: (messageId: number) => boolean
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

function readViewport(container: HTMLDivElement): ChatViewport | undefined {
  const rect = container.getBoundingClientRect()
  const row = [...container.querySelectorAll<HTMLElement>('[data-message-id]')].find((element) => element.getBoundingClientRect().bottom > rect.top + 2)
  if (!row) return
  return { messageId: Number(row.dataset.messageId), offset: row.getBoundingClientRect().top - rect.top, following: container.scrollHeight - container.scrollTop - container.clientHeight < 180 }
}

export function ChatPanel({ threadRootId, canCompose: composeOverride, allowPin = true, readOnlyLabel, emptyLabel, renderComments, onSetReaction, onLoadReactors, onForward, onOpenMessage, isMessageDeleted, pendingMessages = [], onRetryPending, onDismissPending, initialViewport, onViewport, channel, messages, loading, loadingOlder, hasMore, loadingNewer, hasNewer, currentUserId, currentRole, canManage, members, pinnedMessageIds, focusedMessageId, focusVersion = 0, channelReads, onLoadOlder, onLoadNewer, onReturnToLatest, onReadThrough, onSend, onEdit, onDelete, onTogglePin, onOpenProfile }: ChatPanelProps) {
 const channelId = channel?.id ?? null
  const canCompose = composeOverride ?? (channel?.can_publish !== false && (channel?.kind !== 'news' || channel.can_publish === true || canManage))
  const attachmentUpload = useAttachmentUpload(channel, canCompose, threadRootId)
  const canReply = canCompose && channel?.kind !== 'news' || channel?.kind === 'news' && !!channel.comments_enabled
  const handledCommentFocus = useRef('')
  const [discussion, setDiscussion] = useState<Message | null>(null)
  const closeDiscussion = useCallback(() => setDiscussion(null), [])
  useEffect(() => {
    const target = messages.find((message) => message.id === focusedMessageId)
    const focusKey = `${channel?.id}:${focusVersion}:${focusedMessageId}`
    if (renderComments && target?.thread_root_id && handledCommentFocus.current !== focusKey) {
      handledCommentFocus.current = focusKey
      const post = messages.find((message) => message.id === target.thread_root_id)
      setDiscussion(post ?? { ...target, id: target.thread_root_id, thread_root_id: undefined, content: target.reply?.message_id === target.thread_root_id ? target.reply.content : 'Публикация', author: target.reply?.message_id === target.thread_root_id ? target.reply.author : target.author })
    }
  }, [channel?.id, channel?.kind, focusVersion, focusedMessageId, messages, renderComments])
  const [replyTarget, setReplyTarget] = useState<MessageReply | null>(null)
  const [composerFocus, setComposerFocus] = useState(0)
  const [messageMenu, setMessageMenu] = useState<{ id: number; x: number; y: number; expanded: boolean } | null>(null)
  const [reactionPending, setReactionPending] = useState<Record<number, Record<string, boolean>>>({})
  const reactionInFlight = useRef(new Set<string>())
  const closeMessageMenu = useCallback(() => setMessageMenu(null), [])

  const [editingId, setEditingId] = useState<number | null>(null)
  const [editDraft, setEditDraft] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null)
  const [pendingActionId, setPendingActionId] = useState<number | null>(null)
  const [actionError, setActionError] = useState<{ id: number; message: string } | null>(null)
  const [showReturnToLatest, setShowReturnToLatest] = useState(false)
  const [returningToLatest, setReturningToLatest] = useState(false)
  const [receiptMessageId, setReceiptMessageId] = useState<number | null>(null)
  const viewportCallback = useRef(onViewport)
  viewportCallback.current = onViewport
  const viewportToRestore = useRef(initialViewport)
  const restoreFrame = useRef<number | null>(null)
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
  const featureContext = useCommunity()
  const featureApi = featureContext?.api, featureToken = featureContext?.token
  const identityMembers = useMemberIdentity(members)
  const directory = useMemo(() => mentionDirectory(identityMembers), [identityMembers])
  const ownRole = currentRole ?? members.find((member) => member.user_id === currentUserId)?.role
  const membersById = useMemo(() => new Map(identityMembers.map((member) => [member.user_id, member])), [identityMembers])
  const displayMessages = useMemo(() => renderComments ? messages.filter((message) => !message.thread_root_id) : messages, [messages, renderComments])
  const virtualized = displayMessages.length > 0
  const getMessageKey = useCallback((index: number) => displayMessages[index]!.id, [displayMessages])
  const estimateMessageSize = useCallback((index: number) => 52 + Math.min(240, Math.floor((displayMessages[index]?.content.length ?? 0) / 80) * 18) + (displayMessages[index]?.reply ? 55 : 0) + (displayMessages[index]?.forward ? 25 : 0) + (displayMessages[index]?.reactions?.length ? 37 : 0), [displayMessages])
  const getScrollElement = useCallback(() => scrollRef.current, [])
  const virtualizer = useVirtualizer({
    count: displayMessages.length,
    getScrollElement,
    getItemKey: getMessageKey,
    estimateSize: estimateMessageSize,
    overscan: 8,
    useAnimationFrameWithResizeObserver: true,
    enabled: virtualized,
    anchorTo: 'end',
    followOnAppend: true,
    scrollEndThreshold: 180,
    initialRect: { width: 800, height: 600 },
  })
  const virtualItems = virtualizer.getVirtualItems()
  const visibleRows = virtualized ? virtualItems.map((item) => ({ index: item.index, key: item.key })) : displayMessages.map((message, index) => ({ index, key: message.id }))

  const scheduleReadCheck = () => {
    if (readFrameRef.current !== null) return
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

  // Each effect setup (including StrictMode replay) starts its own channel
  // positioning pass. A replay must not leave a cancelled restore half done.
  useLayoutEffect(() => { previousChannel.current = null }, [channelId])
  useLayoutEffect(() => { previousFocus.current = null }, [focusVersion])

  useLayoutEffect(() => {
    const container = scrollRef.current
    if (!container) return
    if (channelId === null) {
      previousChannel.current = null
      pendingChannelScroll.current = null
      previousMessageCount.current = 0
      return
    }
    const channelChanged = previousChannel.current !== channelId
    if (channelChanged) {
      viewportToRestore.current = initialViewport
      previousChannel.current = channelId
      pendingChannelScroll.current = channelId
      previousMessageCount.current = 0
      previousFocus.current = null
    }
    if (loading || displayMessages.length === 0) return
    if (!focusedMessageId) previousFocus.current = null
    if (focusedMessageId && previousFocus.current !== focusedMessageId) {
      if (virtualized) {
        const index = displayMessages.findIndex((message) => message.id === focusedMessageId)
        if (index >= 0) {
          virtualizer.scrollToIndex(index, { align: 'center' })
          previousFocus.current = focusedMessageId
          pendingChannelScroll.current = null
          previousMessageCount.current = displayMessages.length
          return
        }
      }
      const target = container.querySelector<HTMLElement>(`[data-message-id="${focusedMessageId}"]`)
      if (target) {
        target.scrollIntoView({ block: 'center', behavior: 'auto' })
        previousFocus.current = focusedMessageId
        pendingChannelScroll.current = null
        previousMessageCount.current = displayMessages.length
        return
      }
    }
    if (pendingChannelScroll.current === channelId) {
      const saved = viewportToRestore.current
      viewportToRestore.current = undefined
      const index = saved ? displayMessages.findIndex((message) => message.id === saved.messageId) : -1
      if (saved && !saved.following && index >= 0) {
        virtualizer.scrollToIndex(index, { align: 'start', behavior: 'auto' })
        let attempts = 0, stable = 0
        const restore = () => {
          // An index command keeps reconciling for several frames. Cancel it
          // before applying the saved intra-row offset, otherwise it can undo
          // the offset again after ResizeObserver measures the restored rows.
          virtualizer.cancelScroll()
          const row = container.querySelector<HTMLElement>(`[data-message-id="${saved.messageId}"]`)
          if (row) {
            const delta = row.getBoundingClientRect().top - container.getBoundingClientRect().top - saved.offset
            if (Math.abs(delta) < 0.5) stable++
            else { stable = 0; container.scrollTop += delta }
          }
          if (++attempts < 12 && stable < 3) restoreFrame.current = requestAnimationFrame(restore)
          else restoreFrame.current = null
        }
        restoreFrame.current = requestAnimationFrame(restore)
      } else if (virtualized) virtualizer.scrollToEnd()
      else container.scrollTop = container.scrollHeight
      pendingChannelScroll.current = null
      previousMessageCount.current = displayMessages.length
      return
    }
    const wasNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 180
    if (!virtualized && displayMessages.length > previousMessageCount.current && wasNearBottom) {
      container.scrollTop = container.scrollHeight
    }
    previousMessageCount.current = displayMessages.length
  }, [channelId, focusedMessageId, focusVersion, initialViewport, loading, displayMessages, virtualized, virtualizer])

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
          if (!virtualized) root.scrollTop = previousTop + root.scrollHeight - previousHeight
          autoLoadingOlderRef.current = false
        })
      })
    }, { root, rootMargin: '260px 0px 0px' })
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [hasMore, loading, loadingOlder, onLoadOlder, virtualized])

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
      readFrameRef.current = null
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
    setDiscussion(null)
    setReplyTarget(null); setMessageMenu(null); setReactionPending({}); reactionInFlight.current.clear()
    setEditingId(null)
    setConfirmDeleteId(null)
    setActionError(null)
    setReceiptMessageId(null)
    previousFocus.current = null
    if (channelId === null) {
      previousChannel.current = null
      pendingChannelScroll.current = null
      previousMessageCount.current = 0
    }
  }, [channelId])

  useEffect(() => {
    const container = scrollRef.current
    if (!container) return
    const callback = viewportCallback.current
    const save = () => {
      const value = readViewport(container)
      if (value) callback?.(value)
    }
    const cancelRestore = () => { if (restoreFrame.current !== null) cancelAnimationFrame(restoreFrame.current); restoreFrame.current = null }
    container.addEventListener('scroll', save, { passive: true })
    container.addEventListener('wheel', cancelRestore, { passive: true })
    container.addEventListener('pointerdown', cancelRestore)
    return () => { cancelRestore(); container.removeEventListener('scroll', save); container.removeEventListener('wheel', cancelRestore); container.removeEventListener('pointerdown', cancelRestore) }
  }, [channelId])

  const liveReply = replyTarget ? messages.find((value) => value.id === replyTarget.message_id) : undefined
  const reply = replyTarget ? { ...replyTarget, ...(liveReply ? { author: liveReply.author, content: liveReply.content, revision: liveReply.revision ?? 0 } : {}), deleted: replyTarget.deleted || !!isMessageDeleted?.(replyTarget.message_id) } : null
  const menuMessage = messageMenu ? messages.find((value) => value.id === messageMenu.id) : undefined
  const openMessageMenu = (event: ReactMouseEvent<HTMLElement>, message: Message, expanded = false) => {
    if (event.type === 'contextmenu' && preferNativeContextMenu(event)) return
    if ((event.target as Element).closest('textarea,input,[contenteditable="true"]')) return
    event.preventDefault(); event.stopPropagation()
    const box = event.currentTarget.getBoundingClientRect()
    setMessageMenu({ id: message.id, x: event.clientX || box.right - 12, y: event.clientY || box.bottom + 4, expanded })
  }
  const beginReply = (message: Message) => {
    if (!canReply) return
    if (channel?.kind === 'news') { setDiscussion(message); return }
    setReplyTarget({ message_id: message.id, author: message.author, content: message.content, revision: message.revision ?? 0, deleted: false })
    setComposerFocus((current) => current + 1)
  }
  const react = async (message: Message, emoji: string) => {
    if (!onSetReaction) return
    const key = `${message.id}:${emoji}`
    if (reactionInFlight.current.has(key)) return
    reactionInFlight.current.add(key)
    const active = !(message.reactions?.find((value) => value.emoji === emoji)?.me ?? false)
    setReactionPending((current) => ({ ...current, [message.id]: { ...current[message.id], [emoji]: active } }))
    setActionError(null)
    try { await onSetReaction(message.id, emoji, active); rememberReaction(emoji) }
    catch (caught) { setActionError({ id: message.id, message: caught instanceof Error ? caught.message : 'Не удалось изменить реакцию' }) }
    finally {
      reactionInFlight.current.delete(key)
      setReactionPending((current) => { const next = { ...current }, values = { ...next[message.id] }; delete values[emoji]; if (Object.keys(values).length) next[message.id] = values; else delete next[message.id]; return next })
    }
  }
  const copyMessage = async (message: Message) => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Браузер не разрешил копирование текста')
      await navigator.clipboard.writeText(readableMessage(message.content, members, message.forward?.mention_names))
    } catch (caught) { setActionError({ id: message.id, message: caught instanceof Error ? caught.message : 'Не удалось скопировать текст' }) }
  }

  const saveEdit = async (messageId: number, encoded?: string) => {
    const content = (encoded ?? editDraft).trim()
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

  const rowHandlers = { onOpenMessage, openMessageMenu, beginReply, react, saveEdit, remove, onOpenProfile, setMessageMenu, setEditingId, setEditDraft, setConfirmDeleteId, setReceiptMessageId, setDiscussion }
  const rowHandlersRef = useRef(rowHandlers)
  useLayoutEffect(() => { rowHandlersRef.current = rowHandlers })
  const rowActions = useMemo<MessageRowActions>(() => ({
    onOpenMessage: (id) => rowHandlersRef.current.onOpenMessage?.(id),

    openMessageMenu: (...args) => rowHandlersRef.current.openMessageMenu(...args),
    beginReply: (...args) => rowHandlersRef.current.beginReply(...args),
    react: (...args) => rowHandlersRef.current.react(...args),
    saveEdit: (...args) => rowHandlersRef.current.saveEdit(...args),
    remove: (...args) => rowHandlersRef.current.remove(...args),
    onOpenProfile: (...args) => rowHandlersRef.current.onOpenProfile(...args),
    setMessageMenu: (...args) => rowHandlersRef.current.setMessageMenu(...args),
    setEditingId: (...args) => rowHandlersRef.current.setEditingId(...args),
    setEditDraft: (...args) => rowHandlersRef.current.setEditDraft(...args),
    setConfirmDeleteId: (...args) => rowHandlersRef.current.setConfirmDeleteId(...args),
    setReceiptMessageId: (...args) => rowHandlersRef.current.setReceiptMessageId(...args),
    setDiscussion: (...args) => rowHandlersRef.current.setDiscussion(...args),
  }), [])
  const canReact = !!onSetReaction, canRenderComments = !!renderComments
  const canOpenMessage = !!onOpenMessage
  const rowContext = useMemo(() => channel ? ({ channel, featureApi, featureToken, membersById, directory, currentUserId, ownRole, channelReads,
    canReply, canReact, canRenderComments, onLoadReactors, canOpenMessage }) : null,
    [channel, featureApi, featureToken, membersById, directory, currentUserId, ownRole, channelReads, canReply, canReact, canRenderComments, onLoadReactors, canOpenMessage])

  if (!channel) return <section className="chat-panel"><EmptyState icon="message" title="Выберите канал">Откройте текстовый канал слева, чтобы начать разговор.</EmptyState></section>

  return (
    <section className="chat-panel" onPaste={attachmentUpload.onPaste} onDrop={attachmentUpload.onDrop} onDragOver={attachmentUpload.onDragOver}>
      <div className="messages" ref={scrollRef} onScroll={() => { updateReturnVisibility(); scheduleReadCheck() }}>
        <div className={`message-page-sentinel message-page-sentinel--top ${hasMore ? 'is-active' : ''}`} ref={topSentinelRef}>{loadingOlder && <><span className="spinner"/> Загружаем предыдущие…</>}</div>
        {loading && displayMessages.length === 0 ? <div className="message-skeletons">{Array.from({ length: 5 }).map((_, index) => <div className="message-skeleton" key={index}><i/><span><b/><small/></span></div>)}</div> : messages.length === 0 ? (
          <div className="channel-start"><span><Icon name="hash" size={30}/></span><h2>{emptyLabel ?? (channel.kind === 'news' ? `Новости «${channel.name}»` : `Начало канала #${channel.name}`)}</h2><p>{channel.kind === 'news' ? 'Здесь появятся публикации авторов канала.' : 'Первое сообщение задаёт настроение. Сделайте его хорошим.'}</p></div>
        ) : <>
        {virtualized && <div aria-hidden="true" style={{ height: virtualItems[0]?.start ?? 0 }}/>}
        {visibleRows.map(({ index, key }) => {
          const message = displayMessages[index]!
          return <div key={key} data-index={index} ref={virtualized ? virtualizer.measureElement : undefined}>
            <ChatMessageRow message={message} previous={displayMessages[index - 1]} context={rowContext!} actions={rowActions}
              pinned={pinnedMessageIds.has(message.id)} focused={focusedMessageId === message.id}
              editing={editingId === message.id} editDraft={editingId === message.id ? editDraft : ''}
              pending={pendingActionId === message.id} confirmDelete={confirmDeleteId === message.id}
              error={actionError?.id === message.id ? actionError.message : undefined}
              reactionPending={reactionPending[message.id]} receiptOpen={receiptMessageId === message.id}/>
          </div>
        })}
        {virtualized && <div aria-hidden="true" style={{ height: Math.max(0, virtualizer.getTotalSize() - (virtualItems.at(-1)?.end ?? 0)) }}/>}
        </>}
        {pendingMessages.filter((item) => channel.kind !== 'news' || !item.reply).map((item) => <article className={`message-pending message-pending--${item.status}`} key={item.id} aria-live="polite"><div>{item.reply && <MessageQuote reference={item.reply} membersById={membersById} onOpen={onOpenMessage}/>}</div>{item.forward && <div className="message-forward"><Icon name="forward" size={14}/>Пересылаем от {item.forward.forward?.author.username ?? item.forward.author.username}</div>}<p><MessageMentions content={item.content} mentions={parseMentions(item.content, directory)} currentUserId={currentUserId} currentRole={ownRole}/></p><small>{(item.attachmentIds?.length ?? 0) > 0 && <span>Вложений: {item.attachmentIds!.length} · </span>}{item.status === 'sending' ? 'Отправляется…' : 'Не отправлено'}{item.status === 'failed' && <><button type="button" onClick={() => onRetryPending?.(item)}>Повторить</button><button type="button" onClick={() => onDismissPending?.(item.id)}>Убрать</button></>}</small></article>)}
        <div className={`message-page-sentinel message-page-sentinel--bottom ${hasNewer ? 'is-active' : ''}`} ref={bottomSentinelRef}>{loadingNewer && <><span className="spinner"/> Загружаем следующие…</>}</div>
      </div>
      {showReturnToLatest && <button className="return-to-latest" onClick={() => void returnToLatest()} disabled={returningToLatest} title="Вернуться к актуальным сообщениям">{returningToLatest ? <span className="spinner"/> : <Icon name="chevron" size={17}/>}<span>К новым сообщениям</span></button>}

      {menuMessage && messageMenu && <MessageContextMenu key={menuMessage.id} message={menuMessage} x={messageMenu.x} y={messageMenu.y} expanded={messageMenu.expanded} canEdit={menuMessage.author.user_id === currentUserId && !menuMessage.forward && (channel.kind !== 'news' || canCompose)} canReply={canReply} canDelete={menuMessage.author.user_id === currentUserId || canManage} canPin={canManage && allowPin} pinned={pinnedMessageIds.has(menuMessage.id)} pending={reactionPending[menuMessage.id] ?? {}} onClose={closeMessageMenu} onDiscuss={renderComments && !menuMessage.thread_root_id && (channel.kind === 'text' || channel.comments_enabled || (menuMessage.comment_count ?? 0) > 0) ? () => setDiscussion(menuMessage) : undefined} onReply={() => beginReply(menuMessage)} onReact={onSetReaction ? (emoji) => { void react(menuMessage, emoji) } : undefined} onEdit={() => { setEditingId(menuMessage.id); setEditDraft(menuMessage.content); setConfirmDeleteId(null); setActionError(null) }} onPin={() => { void togglePin(menuMessage.id, pinnedMessageIds.has(menuMessage.id)) }} onCopy={() => { void copyMessage(menuMessage) }} onSave={() => saveFavorite({ kind: 'channel', id: menuMessage.id })} onForward={onForward ? () => onForward(menuMessage) : undefined} onDelete={() => setConfirmDeleteId(menuMessage.id)}/>}
      <ChatComposer key={channel.id} channel={channel} canCompose={canCompose} reply={reply} membersById={membersById}
        upload={attachmentUpload} composerFocus={composerFocus} setReplyTarget={setReplyTarget} onSend={onSend}
        onFocus={() => setComposerFocus((value) => value + 1)} readOnlyLabel={readOnlyLabel}/>
      {discussion && !isMessageDeleted?.(discussion.id) && renderComments?.(messages.find((message) => message.id === discussion.id) ?? discussion, closeDiscussion)}
    </section>
  )
}

interface MessageRowContext {
  channel: Channel; featureApi?: VoxholdApi; featureToken?: string; membersById: ReadonlyMap<number, ServerMember>
  directory: ReturnType<typeof mentionDirectory>; currentUserId: number; ownRole?: ServerRole
  channelReads: Readonly<Record<number, ChannelRead>>; canReply: boolean; canReact: boolean; canRenderComments: boolean
  onLoadReactors?: ReactorLoader; canOpenMessage: boolean
}
interface MessageRowActions {
  onOpenMessage: (id: number) => void
  openMessageMenu: (event: ReactMouseEvent<HTMLElement>, message: Message, expanded?: boolean) => void
  beginReply: (message: Message) => void; react: (message: Message, emoji: string) => Promise<void>
  saveEdit: (id: number, content?: string) => Promise<void>; remove: (id: number) => Promise<void>
  onOpenProfile: (id: number, name: string, role: ServerRole) => void
  setMessageMenu: (value: { id: number; x: number; y: number; expanded: boolean } | null) => void
  setEditingId: (value: number | null) => void; setEditDraft: (value: string) => void
  setConfirmDeleteId: (value: number | null) => void; setDiscussion: (value: Message | null) => void
  setReceiptMessageId: (value: number | null | ((current: number | null) => number | null)) => void
}
interface MessageRowProps {
  message: Message; previous?: Message; context: MessageRowContext; actions: MessageRowActions
  pinned: boolean; focused: boolean; editing: boolean; editDraft: string; pending: boolean; confirmDelete: boolean
  error?: string; reactionPending?: Record<string, boolean>; receiptOpen: boolean
}
const ChatMessageRow = memo(function ChatMessageRow({ message, previous, context, actions, pinned, focused, editing, editDraft, pending, confirmDelete, error, reactionPending, receiptOpen }: MessageRowProps) {
  const { channel, featureApi, featureToken, membersById, directory, currentUserId, ownRole, channelReads, canReply, canReact, canRenderComments, onLoadReactors, canOpenMessage } = context
  const featureContext = featureApi && featureToken ? { api: featureApi, token: featureToken } : null
          const role = membersById.get(message.author.user_id)?.role ?? 'member'
          const mine = message.author.user_id === currentUserId
          const mentions = parseMentions(message.content, directory).map((mention) => message.forward && mention.userId && message.forward.mention_names?.[mention.userId] ? { ...mention, label: message.forward.mention_names[mention.userId]! } : mention)
          const mentioned = !mine && !message.forward && (mentionsMe(mentions, currentUserId, ownRole) || !!message.reply && !message.reply.deleted && message.reply.author.user_id === currentUserId)
          const readers = mine ? [...membersById.values()].filter((member) => member.user_id !== currentUserId && (channelReads[member.user_id]?.last_read_message_id ?? 0) >= message.id) : []
          const showDate = !previous || !sameDay(previous.created_at, message.created_at)
          const grouped = channel.kind !== 'news' && !message.reply && !message.forward && !previous?.reply && !previous?.forward && previous && previous.author.user_id === message.author.user_id && message.created_at - previous.created_at < 300 && !showDate
  return <>
              {showDate && <div className="date-divider"><span>{formatDate(message.created_at)}</span></div>}
              <article data-message-id={message.id} onContextMenu={(event) => actions.openMessageMenu(event, message)} onKeyDown={(event) => { if (event.key === 'ContextMenu' || event.key === 'F10' && event.shiftKey) { event.preventDefault(); const box = event.currentTarget.getBoundingClientRect(); actions.setMessageMenu({ id: message.id, x: box.left + 40, y: box.top + 20, expanded: false }) } }} className={`message ${mentioned ? 'message--mentioned' : ''} ${grouped ? 'message--grouped' : ''} ${mine ? 'message--mine' : ''} ${pinned ? 'message--pinned' : ''} ${focused ? 'message--focused' : ''}`}>
                {!grouped && <MessageAvatar userId={message.author.user_id} name={message.author.username} onOpen={() => actions.onOpenProfile(message.author.user_id, message.author.username, role)}/>}
                <div className="message__body">
                  {!grouped && <MessageHeader name={message.author.username} createdAt={message.created_at} mine={mine} role={role} badges={<CustomRoleBadges userId={message.author.user_id}/>} onOpen={() => actions.onOpenProfile(message.author.user_id, message.author.username, role)}/>}
                  {pinned && <span className="message__pin-label"><Icon name="pin" size={11}/> Закреплено</span>}
                  {message.forward && <ForwardAttribution message={message}/>}
                  {message.reply && <MessageQuote reference={message.reply} membersById={membersById} onOpen={canOpenMessage ? actions.onOpenMessage : undefined}/>}
                  {editing ? <div className="message-editor">
                    <MentionComposer draft={editDraft} onChange={actions.setEditDraft} onSubmit={(event, content) => { event?.preventDefault(); void actions.saveEdit(message.id, content) }} sending={pending} channelName={channel.name} membersById={membersById} error="" submitLabel="Сохранить" inputLabel="Редактирование сообщения" submitOnEnter={false} onCancel={() => actions.setEditingId(null)}/>
                    <small className="message-editor__hint">Ctrl + Enter — сохранить · Esc — отмена</small>
                  </div> : <p><MessageMentions content={message.content} mentions={mentions} currentUserId={message.forward ? 0 : currentUserId} currentRole={message.forward ? undefined : ownRole} canOpenProfile={(id) => membersById.has(id)} onOpenProfile={(id) => { const member = membersById.get(id); if (member) actions.onOpenProfile(id, member.username, member.role) }}/>{message.edited_at && <span className="message__edited"> (изменено)</span>}</p>}
                  <MessageAttachments channelId={channel.id} attachments={message.attachments}/>{message.poll && featureContext && <PollCard initial={message.poll} api={featureContext.api} token={featureContext.token}/>}
                  {!editing && <MessageReactions message={message} currentUserId={currentUserId} pending={reactionPending} onReact={canReact ? (emoji) => { void actions.react(message, emoji) } : undefined} loadReactors={onLoadReactors}/>}
                  {canRenderComments && !message.thread_root_id && (channel.kind === 'text' ? (message.comment_count ?? 0) > 0 : channel.comments_enabled || (message.comment_count ?? 0) > 0) && <button type="button" className="news-post-comments" onClick={() => actions.setDiscussion(message)}><Icon name="chat" size={16}/><span>{channel.kind === 'text' ? 'Обсуждение' : 'Комментарии'}{(message.comment_count ?? 0) > 0 ? ` · ${message.comment_count}` : ''}</span>{channel.kind === 'news' && !channel.comments_enabled && <Icon name="lock" size={13}/>}<Icon name="chevron" size={14}/></button>}
                  {!!error && <div className="message__error">{error}</div>}
                </div>
                {mine && !editing && <>
                  <button type="button" className={`message__delivery ${readers.length ? 'is-read' : ''}`} title={readers.length ? `Прочитали: ${readers.map((reader) => reader.username).join(', ')}` : 'Сообщение сохранено на сервере'} aria-label={readers.length ? `Прочитано: ${readers.map((reader) => reader.username).join(', ')}` : 'Доставлено на сервер'} onClick={() => actions.setReceiptMessageId((current) => current === message.id ? null : message.id)}><span><Icon name="check" size={11}/>{readers.length > 0 && <Icon name="check" size={11}/>}</span></button>
                  {receiptOpen && <div className="message-readers"><header><b>{readers.length ? 'Прочитали' : 'Статус сообщения'}</b><button onClick={() => actions.setReceiptMessageId(null)} aria-label="Закрыть"><Icon name="close" size={12}/></button></header>{readers.length ? readers.map((reader) => <div key={reader.user_id}><Avatar userId={reader.user_id} name={reader.username} size="small"/><span><b>{reader.username}</b><small>{roleMeta[reader.role].label}</small></span></div>) : <p><Icon name="check" size={13}/> Сохранено на сервере. Пока никто не прочитал.</p>}</div>}
                </>}
                {grouped && <time className="message__hover-time">{formatTime(message.created_at)}</time>}
                {!editing && <div className="message__actions">
                  {canReply && <button type="button" onClick={() => actions.beginReply(message)} title="Ответить" aria-label="Ответить на сообщение"><Icon name="reply" size={15}/></button>}
                  {canReact && <button type="button" onClick={(event) => actions.openMessageMenu(event, message, true)} title="Поставить реакцию" aria-label="Поставить реакцию"><Icon name="emoji" size={15}/></button>}
                  <button type="button" onClick={(event) => actions.openMessageMenu(event, message)} title="Действия с сообщением" aria-label="Действия с сообщением"><Icon name="more" size={15}/></button>
                </div>}
                {confirmDelete && <div className="message-delete-confirm"><span>Удалить сообщение?</span><button onClick={() => actions.setConfirmDeleteId(null)}>Нет</button><button className="is-danger" onClick={() => void actions.remove(message.id)} disabled={pending}>Да</button></div>}
              </article>
  </>
})

function ChatComposer({ channel, canCompose, reply, membersById, upload, composerFocus, setReplyTarget, onSend, onFocus, readOnlyLabel }: {
  channel: Channel; canCompose: boolean; reply: MessageReply | null; membersById: ReadonlyMap<number, ServerMember>
  upload: ReturnType<typeof useAttachmentUpload>; composerFocus: number; onFocus: () => void; readOnlyLabel?: string
  setReplyTarget: (value: MessageReply | null | ((current: MessageReply | null) => MessageReply | null)) => void
  onSend: ChatPanelProps['onSend']
}) {
  const featureContext = useCommunity()
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState('')
  useEffect(() => { setSendError('') }, [composerFocus])
  const submit = async (event?: FormEvent, encoded?: string) => {
    event?.preventDefault()
    const content = (encoded ?? draft).trim()
    if ((!content && !upload.hasItems) || sending || !canCompose) return
    if (reply?.deleted) { setSendError('Исходное сообщение удалено. Уберите ответ, чтобы отправить текст.'); return }
    const reference = reply
    setSending(true); setSendError('')
    setDraft(''); setReplyTarget(null)
    try { const ids = await upload.prepare(); await (ids.length ? onSend(content, reference ?? undefined, ids) : reference ? onSend(content, reference) : onSend(content)); upload.commit(ids) }
    catch (error) { setDraft((current) => current || content); setReplyTarget((current) => current ?? reference); setSendError(error instanceof Error ? error.message : 'Не удалось отправить') }
    finally { upload.release(); setSending(false) }
  }

  return <>
      {reply && <aside className={`composer-reply ${reply.deleted ? 'is-deleted' : ''}`}><Icon name="reply" size={19}/><div><b>{reply.deleted ? 'Исходное сообщение удалено' : `Ответ ${reply.author.username}`}</b><p>{reply.deleted ? 'Уберите ответ, чтобы отправить текст' : readableMessage(reply.content, membersById)}</p></div><button className="icon-button" type="button" onClick={() => { setReplyTarget(null); setSendError(''); onFocus() }} aria-label="Отменить ответ"><Icon name="close" size={17}/></button></aside>}
      {upload.control}
      {canCompose && featureContext && <ComposerTools api={featureContext.api} token={featureContext.token} destination={{kind:'channel',id:channel.id,server_id:channel.server_id}} content={draft} prepare={upload.prepare} commit={upload.commit} release={upload.release} onSent={() => setDraft('')}/>}
      {canCompose ? <MentionComposer hasAttachments={upload.hasItems} focusKey={composerFocus} submitDisabled={!!reply?.deleted} draft={draft} onChange={setDraft} onSubmit={(event, content) => void submit(event, content)} sending={sending} channelName={channel.name} membersById={membersById} error={sendError}/> : <div className="news-readonly"><Icon name="news" size={19}/><p>{readOnlyLabel ?? 'Публикуют назначенные авторы. Вы можете читать новости и ставить реакции.'}</p></div>}
  </>
}
