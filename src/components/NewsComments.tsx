import { useThreadFollow } from './ThreadFollow'
import { useEffect, useRef, useState } from 'react'
import type { Channel, Message, MessageReply, ServerMember, ServerRole } from '../domain/types'
import type { VoxholdApi } from '../services/api'
import type { ChannelHistoryStore, PendingMessage } from '../services/channelHistory'
import { newerMessage, resolveReplyReferences, withReactions } from '../lib/messageRevisions'
import { humanError } from '../lib/format'
import { ChatPanel } from './ChatPanel'
import { Icon } from './Icon'
import { readableMessage } from './MessageQuote'

export function NewsComments({ api, token, store, channel, post, currentUserId, currentRole, canManage, members, pending, focusId, onClose, onOpenProfile }: {
  api: VoxholdApi; token: string; store: ChannelHistoryStore; channel: Channel; post: Message
  currentUserId: number; currentRole?: ServerRole; canManage: boolean; members: ServerMember[]; pending: PendingMessage[]
  focusId?: number | null; onClose: () => void; onOpenProfile: (id: number, username: string, role: ServerRole) => void
}) {
  const [messages, setMessages] = useState<Message[]>([]), [loading, setLoading] = useState(true)
  const [hasMore, setHasMore] = useState(false), [older, setOlder] = useState(false), [error, setError] = useState('')
  const [removed, setRemoved] = useState(false), [revision, setRevision] = useState(0)
  const [focused, setFocused] = useState(focusId ?? null)
  const [rootPost, setRootPost] = useState(post)
  useEffect(() => { setRootPost(post) }, [post])
  useEffect(() => { setFocused(focusId ?? null) }, [focusId])
  const live = useRef(new Map<number, Message>()), deleted = useRef(new Set<number>())
  const controller = useRef<AbortController | null>(null)
  const cursor = useRef<number | null>(null)
  const thread = useThreadFollow(api, token, channel.id, post.id)
  const markRead = thread.markRead
  const merge = (values: Message[], incoming: Message[]) => {
    const map = new Map(values.map((value) => [value.id, value]))
    for (const value of incoming) if (!deleted.current.has(value.id)) map.set(value.id, newerMessage(map.get(value.id), value))
    return resolveReplyReferences([...map.values()].filter((value) => !deleted.current.has(value.id)).sort((a, b) => a.id - b.id), [...live.current.values()], deleted.current)
  }
  useEffect(() => store.observe((event) => {
    if (event.channelId !== channel.id) return
    if (event.type === 'message' && event.message.thread_root_id === post.id) {
      live.current.set(event.message.id, newerMessage(live.current.get(event.message.id), event.message))
      setMessages((current) => merge(current, [event.message]))
    } else if (event.type === 'message' && event.message.id === post.id) {
      setRootPost((current) => newerMessage(current, event.message))
    } else if (event.type === 'deleted') {
      deleted.current.add(event.id); live.current.delete(event.id)
      if (event.id === post.id) setRemoved(true)
      setMessages((current) => resolveReplyReferences(current.filter((value) => value.id !== event.id), [], deleted.current))
    } else if (event.type === 'reactions') {
      setMessages((current) => current.map((value) => value.id === event.reactions.message_id ? withReactions(value, event.reactions) : value))
    } else if (event.type === 'reset') setRevision((n) => n + 1)
  }), [store, channel.id, post.id])
  useEffect(() => {
    const request = new AbortController(); controller.current = request
    setLoading(true); setError('')
    void api.messages.context(token, channel.server_id, channel.id, post.id, 0, 0, request.signal).then((context) => {
      if (!request.signal.aborted) { const root = context.messages.find((value) => value.id === post.id); if (root) setRootPost(root) }
    }).catch(() => undefined)
    void api.messages.comments(token, channel.server_id, channel.id, post.id, undefined, request.signal).then((page) => {
      if (request.signal.aborted) return
      setMessages(merge(page.messages, [...live.current.values()])); setHasMore(page.pagination.has_more); cursor.current = page.pagination.next_before_id
    }).catch((caught: unknown) => { if (!request.signal.aborted) setError(humanError(caught)) }).finally(() => { if (!request.signal.aborted) setLoading(false) })
    return () => request.abort()
  }, [api, token, channel.server_id, channel.id, post.id, revision])
  useEffect(() => { const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); onClose() } }; document.addEventListener('keydown', key); return () => document.removeEventListener('keydown', key) }, [onClose])
  const loadOlder = async () => {
    if (!cursor.current || older) return
    setOlder(true); setError('')
    try {
      const signal = controller.current?.signal
      const page = await api.messages.comments(token, channel.server_id, channel.id, post.id, cursor.current, signal)
      if (signal?.aborted) return
      setMessages((current) => merge(current, page.messages)); cursor.current = page.pagination.next_before_id; setHasMore(page.pagination.has_more)
    } catch (caught) { if (!controller.current?.signal.aborted) setError(humanError(caught)) } finally { setOlder(false) }
  }
  const postReply: MessageReply = { message_id: rootPost.id, author: rootPost.author, content: rootPost.content, revision: rootPost.revision ?? 0, deleted: removed }
  return <aside className="news-comments" aria-label="Комментарии к публикации">
    <header className="news-comments__header"><div><Icon name="chat" size={21}/><b>Комментарии</b>{channel.kind === 'news' && !channel.comments_enabled && <small>Только чтение</small>}</div><button type="button" className="icon-button" onClick={onClose} aria-label="Закрыть комментарии"><Icon name="close"/></button></header>
    <div className="news-comments__post"><b>Публикация · {rootPost.author.username}</b><p>{readableMessage(rootPost.content, members, rootPost.forward?.mention_names)}</p></div>
    {thread.control}
    {error && <div className="form-error" role="alert">{error}<button type="button" onClick={() => setRevision((n) => n + 1)}>Повторить</button></div>}
    {removed ? <p className="news-readonly">Публикация удалена. Обсуждение закрыто.</p> : <ChatPanel threadRootId={post.id} channel={{ ...channel, kind: 'text' }} messages={messages} loading={loading} loadingOlder={older} hasMore={hasMore} loadingNewer={false} hasNewer={false} currentUserId={currentUserId} currentRole={currentRole} canManage={canManage} members={members} pinnedMessageIds={new Set()} focusedMessageId={focused} channelReads={{}} canCompose={(channel.kind === 'text' || !!channel.comments_enabled)} readOnlyLabel="Комментарии отключены. История обсуждения доступна для чтения." emptyLabel="Комментариев пока нет" pendingMessages={pending.filter((item) => item.threadRootId === post.id || item.reply && (item.reply.message_id === post.id || messages.some((value) => value.id === item.reply?.message_id)))} onLoadOlder={loadOlder} onLoadNewer={async () => undefined} onReturnToLatest={async () => undefined} onReadThrough={markRead} onSend={async (content, reply) => { await store.send(channel.server_id, channel.id, content, undefined, reply ?? postReply, undefined, undefined, post.id) }} onRetryPending={(item) => { void store.send(channel.server_id, channel.id, item.content, item.id) }} onDismissPending={(id) => store.dismiss(channel.id, id)} onSetReaction={async (id, emoji, active) => { const state = await api.messages.setReaction(token, channel.server_id, channel.id, id, emoji, active); store.reactions(state) }} onLoadReactors={(id, emoji, signal, after) => api.messages.reactors(token, channel.server_id, channel.id, id, emoji, signal, after)} onEdit={async (id, content) => { const value = await api.messages.update(token, channel.server_id, channel.id, id, content); store.receive(value) }} onDelete={async (id) => { await api.messages.delete(token, channel.server_id, channel.id, id); store.remove(channel.id, id) }} onTogglePin={async () => undefined} allowPin={false} onOpenMessage={setFocused} isMessageDeleted={(id) => store.isDeleted(channel.id, id)} onOpenProfile={onOpenProfile}/>}
  </aside>
}
