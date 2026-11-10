import type { Message, MessageSyncPage, MessageReactions, MessageReply } from '../domain/types'
import type { VoxholdApi } from './api'
import { newerMessage, resolveReplyReferences, withReactions } from '../lib/messageRevisions'
import { humanError } from '../lib/format'

export const MAX_CACHED_CHANNELS = 8
export const MAX_CHANNEL_MESSAGES = 1_000
export type HistoryUpdate = { type: 'message'; channelId: number; message: Message } | { type: 'deleted'; channelId: number; id: number } | { type: 'reactions'; channelId: number; reactions: MessageReactions } | { type: 'reset'; channelId: number }
export interface ChatViewport { messageId: number; offset: number; following: boolean }
export interface ForwardSource { server_id: number; channel_id: number; message_id: number; content: string; created_at: number; author: Message['author']; forward?: Message['forward'] }
export interface PendingMessage { id: string; content: string; status: 'sending' | 'failed'; error?: string; retryable?: boolean; attempts?: number; attachmentIds?: string[]; reply?: MessageReply; forward?: ForwardSource; threadRootId?: number }
export interface ChannelHistoryState {
  messages: Message[]
  cursor: number | null
  nextBeforeId: number | null
  hasMore: boolean
  hasNewer: boolean
  loading: boolean
  loadingOlder: boolean
  loadingNewer: boolean
  pending: PendingMessage[]
}
interface Entry {
  serverId: number
  state: ChannelHistoryState
  listeners: Set<() => void>
  controller: AbortController
  historyController: AbortController
  tombstones: Set<number>
  reactionSnapshots: Map<number, MessageReactions>
  live: Map<number, { version: number; message: Message }>
  version: number
  viewport?: ChatViewport
  sync?: Promise<void>
  dispatchTail: Promise<void>
  sendControllers: Map<string, AbortController>
  retryTimers: Map<string, ReturnType<typeof setTimeout>>
  syncAgain: boolean
  contextGeneration: number
  contextRequest?: { messageId: number; controller: AbortController; promise: Promise<void> }
  forceSnapshot: boolean
  notificationTimer?: ReturnType<typeof setTimeout>
}
const initial = (): ChannelHistoryState => ({ messages: [], cursor: null, nextBeforeId: null, hasMore: false, hasNewer: false, loading: false, loadingOlder: false, loadingNewer: false, pending: [] })
export const EMPTY_HISTORY = initial()

const MAX_PENDING_MESSAGES = 20
const SEND_RETRY_DELAYS = [2_000, 5_000, 12_000]
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null
const isId = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0
const isText = (value: unknown, max: number): value is string => typeof value === 'string' && value.length <= max
const isAuthor = (value: unknown) => isRecord(value) && isId(value.user_id) && isText(value.username, 256)
const isReply = (value: unknown): value is MessageReply => isRecord(value) && isId(value.message_id) && isAuthor(value.author) && isText(value.content, 5120) && typeof value.revision === 'number' && Number.isFinite(value.revision) && typeof value.deleted === 'boolean'
const isForwardAttribution = (value: unknown) => isRecord(value) && isAuthor(value.author) && typeof value.created_at === 'number' && Number.isFinite(value.created_at) && (value.mention_names === undefined || isRecord(value.mention_names) && Object.values(value.mention_names).every((name) => isText(name, 256)))
const isForward = (value: unknown): value is ForwardSource => isRecord(value) && isId(value.server_id) && isId(value.channel_id) && isId(value.message_id) && isText(value.content, 5120) && typeof value.created_at === 'number' && Number.isFinite(value.created_at) && isAuthor(value.author) && (value.forward === undefined || isForwardAttribution(value.forward))
interface StoredOutboxItem { serverId: number; channelId: number; pending: PendingMessage }
function restoreOutboxItem(value: unknown): StoredOutboxItem | undefined {
  if (!isRecord(value) || !isId(value.serverId) || !isId(value.channelId) || !isRecord(value.pending)) return
  const item = value.pending
  if (!isText(item.id, 128) || !item.id || !isText(item.content, 5120) || (item.status !== 'sending' && item.status !== 'failed') || (item.error !== undefined && !isText(item.error, 2000)) || (item.retryable !== undefined && typeof item.retryable !== 'boolean')) return
  if (item.reply !== undefined && !isReply(item.reply) || item.forward !== undefined && !isForward(item.forward) || item.threadRootId !== undefined && !isId(item.threadRootId)) return
  if (item.attachmentIds !== undefined && (!Array.isArray(item.attachmentIds) || item.attachmentIds.length > 10 || !item.attachmentIds.every((id) => isText(id, 128) && !!id))) return
  const sending = item.status === 'sending'
  return { serverId: value.serverId, channelId: value.channelId, pending: {
    id: item.id, content: item.content, status: 'failed',
    error: sending ? 'Отправка прервана перезапуском' : item.error as string | undefined,
    retryable: item.retryable !== false,
    ...(typeof item.attempts === 'number' && Number.isInteger(item.attempts) && item.attempts >= 0 && item.attempts <= SEND_RETRY_DELAYS.length + 1 ? { attempts: item.attempts } : {}),
    ...(item.attachmentIds ? { attachmentIds: [...item.attachmentIds] as string[] } : {}),
    ...(item.reply ? { reply: item.reply } : {}), ...(item.forward ? { forward: item.forward } : {}), ...(item.threadRootId ? { threadRootId: item.threadRootId } : {}),
  } }
}
function readOutbox(key: string): StoredOutboxItem[] {
  try {
    const raw = localStorage.getItem(key)
    if (!raw || raw.length > 500_000) return []
    const saved: unknown = JSON.parse(raw)
    if (!isRecord(saved) || saved.version !== 1 || !Array.isArray(saved.items)) return []
    const result: StoredOutboxItem[] = [], ids = new Set<string>()
    for (const value of saved.items) {
      const item = restoreOutboxItem(value)
      if (!item || ids.has(`${item.channelId}:${item.pending.id}`)) continue
      ids.add(`${item.channelId}:${item.pending.id}`); result.push(item)
      if (result.length === MAX_PENDING_MESSAGES) break
    }
    return result
  } catch { return [] }
}
function retryableSendError(error: unknown) {
  const status = isRecord(error) && typeof error.status === 'number' ? error.status : 0
  return status === 0 || status >= 500 || status === 408 || status === 425 || status === 429
}

/** A per-login, bounded cache. Requests always retain their original channel. */
export class ChannelHistoryStore {
  private observers = new Set<(event: HistoryUpdate) => void>()
  observe(listener: (event: HistoryUpdate) => void) { this.observers.add(listener); return () => { this.observers.delete(listener) } }
  private emit(event: HistoryUpdate) { this.observers.forEach((listener) => listener(event)) }
  private entries = new Map<number, Entry>()
  private closed = false
  private mounts = 0
  private readonly storageKey?: string
  constructor(private api: VoxholdApi, private token: string, private userId = 0) {
    const scope = api.storageScope
    if (!scope || userId <= 0) return
    this.storageKey = `voxhold.outbox.v1:${scope}:${userId}`
    for (const item of readOutbox(this.storageKey)) {
      const entry = this.entry(item.serverId, item.channelId)
      if (entry.serverId !== item.serverId) continue
      entry.state = { ...entry.state, pending: [...entry.state.pending, item.pending] }
    }
  }
  private persistOutbox() {
    if (!this.storageKey) return
    try {
      const items = [...this.entries].flatMap(([channelId, entry]) => entry.state.pending.map((pending): StoredOutboxItem => ({ serverId: entry.serverId, channelId, pending })))
      if (items.length) localStorage.setItem(this.storageKey, JSON.stringify({ version: 1, items }))
      else localStorage.removeItem(this.storageKey)
    } catch { /* The in-memory outbox remains authoritative when storage is unavailable. */ }
  }
  retain() {
    this.mounts++
    if (this.token) for (const [channelId, entry] of this.entries) {
      for (const item of entry.state.pending) {
        if (item.status === 'failed' && item.retryable && !entry.retryTimers.has(item.id)) {
          const retryIndex = Math.min(SEND_RETRY_DELAYS.length - 1, Math.max(0, (item.attempts ?? 1) - 1))
          this.scheduleRetry(entry, channelId, item.id, item.content, SEND_RETRY_DELAYS[retryIndex]!)
        }
      }
    }
    return () => { this.mounts--; queueMicrotask(() => { if (this.mounts === 0) this.close() }) }
  }

  entry(serverId: number, channelId: number): Entry {
    let entry = this.entries.get(channelId)
    if (!entry) {
      entry = { serverId, state: initial(), listeners: new Set(), controller: new AbortController(), historyController: new AbortController(), tombstones: new Set(), reactionSnapshots: new Map(), live: new Map(), version: 0, dispatchTail: Promise.resolve(), sendControllers: new Map(), retryTimers: new Map(), syncAgain: false, contextGeneration: 0, forceSnapshot: false }
      const retryTimers = entry.retryTimers
      entry.controller.signal.addEventListener('abort', () => {
        retryTimers.forEach((timer) => clearTimeout(timer))
        retryTimers.clear()
      }, { once: true })
      this.entries.set(channelId, entry)
    }
    return entry
  }
  snapshot = (channelId: number | null) => channelId ? this.entries.get(channelId)?.state ?? EMPTY_HISTORY : EMPTY_HISTORY
  subscribe(serverId: number, channelId: number, listener: () => void) {
    const entry = this.entry(serverId, channelId)
    entry.listeners.add(listener)
    this.entries.delete(channelId); this.entries.set(channelId, entry)
    this.trim()
    return () => { entry.listeners.delete(listener); this.trim() }
  }
  update(channelId: number, patch: Partial<ChannelHistoryState>, deferNotification = false) {
    const entry = this.entries.get(channelId)
    if (!entry || this.closed || entry.controller.signal.aborted) return
    const pendingChanged = patch.pending !== undefined && patch.pending !== entry.state.pending
    const oldPending = entry.state.pending
    entry.state = { ...entry.state, ...patch }
    if (pendingChanged) {
      const ids = new Set(entry.state.pending.map((item) => item.id))
      for (const item of oldPending) if (!ids.has(item.id)) {
        clearTimeout(entry.retryTimers.get(item.id))
        entry.retryTimers.delete(item.id)
        entry.sendControllers.get(item.id)?.abort()
      }
      this.persistOutbox()
    }
    if (deferNotification) {
      if (entry.notificationTimer === undefined) entry.notificationTimer = setTimeout(() => {
        entry.notificationTimer = undefined
        if (!this.closed && this.entries.get(channelId) === entry) entry.listeners.forEach((listener) => listener())
      }, 8)
      return
    }
    clearTimeout(entry.notificationTimer); entry.notificationTimer = undefined
    entry.listeners.forEach((listener) => listener())
  }
  viewport(channelId: number | null, value?: ChatViewport) {
    const entry = channelId ? this.entries.get(channelId) : undefined
    if (entry && value) entry.viewport = value
    return entry?.viewport
  }
  private trim() {
    let retained = this.entries.size
    for (const [id, entry] of this.entries) {
      if (retained <= MAX_CACHED_CHANNELS) break
      if (entry.listeners.size) continue
      if (entry.state.pending.length) {
        // Outbox entries survive LRU eviction, without retaining their history.
        entry.historyController.abort()
        entry.historyController = new AbortController()
        entry.contextRequest?.controller.abort(); entry.contextRequest = undefined
        entry.contextGeneration++
        entry.sync = undefined
        entry.state = { ...initial(), pending: entry.state.pending }
        entry.viewport = undefined; entry.live.clear(); entry.tombstones.clear(); entry.reactionSnapshots.clear()
        retained--; continue
      }
      clearTimeout(entry.notificationTimer); entry.controller.abort(); entry.historyController.abort(); this.entries.delete(id)
      retained--
    }
  }
  private merge(entry: Entry, incoming: Message[], reset = false, preferOlder = false) {
    // Ordinary append: retain existing objects and skip rebuilding/sorting maps.
    // Quotes and an out-of-order quote target keep the full reconciliation path.
    const next = incoming[0]
    const current = entry.state.messages
    if (!reset && !preferOlder && incoming.length === 1 && next && !next.reply &&
      next.id > (current.at(-1)?.id ?? 0) && !entry.tombstones.has(next.id) &&
      !current.some((message) => message.reply?.message_id === next.id)) {
      const reactions = entry.reactionSnapshots.get(next.id)
      const messages = current.concat(reactions ? withReactions(next, reactions) : next)
      return { messages: messages.slice(-MAX_CHANNEL_MESSAGES), truncated: messages.length > MAX_CHANNEL_MESSAGES }
    }
    const values = new Map((reset ? [] : entry.state.messages).map((message) => [message.id, message]))
    const previous = new Map(entry.state.messages.map((message) => [message.id, message]))
    incoming.forEach((message) => {
      if (!entry.tombstones.has(message.id)) values.set(message.id, newerMessage(values.get(message.id) ?? previous.get(message.id), entry.reactionSnapshots.has(message.id) ? withReactions(message, entry.reactionSnapshots.get(message.id)!) : message))
    })
    const sorted = resolveReplyReferences([...values.values()].filter((message) => !entry.tombstones.has(message.id)).sort((a, b) => a.id - b.id), [...entry.live.values()].map((value) => value.message).concat(incoming, [...values.values()]), entry.tombstones)
    const truncated = sorted.length > MAX_CHANNEL_MESSAGES
    return { messages: preferOlder ? sorted.slice(0, MAX_CHANNEL_MESSAGES) : sorted.slice(-MAX_CHANNEL_MESSAGES), truncated }
  }
  receive(message: Message) {
    if (this.closed) return
    this.emit({ type: 'message', channelId: message.channel_id, message })
    const entry = this.entries.get(message.channel_id)
    if (!entry || entry.tombstones.has(message.id)) return
    message = newerMessage(entry.live.get(message.id)?.message ?? (message.id > (entry.state.messages.at(-1)?.id ?? 0) ? undefined : entry.state.messages.find((value) => value.id === message.id)), message)
    entry.version++
    entry.live.set(message.id, { version: entry.version, message })
    while (entry.live.size > MAX_CHANNEL_MESSAGES) entry.live.delete(entry.live.keys().next().value!)
    const current = entry.state
    const pending = message.client_message_id && message.author.user_id === this.userId ? current.pending.filter((item) => item.id !== message.client_message_id) : current.pending
    const last = current.messages.at(-1)?.id ?? 0
    if (current.messages.length && message.id < current.messages[0]!.id) {
      const messages = resolveReplyReferences(current.messages, [message], entry.tombstones)
      if (pending !== current.pending || messages.some((value, index) => value !== current.messages[index])) this.update(message.channel_id, { pending, messages }, true)
      return
    }
    if (!current.messages.some((item) => item.id === message.id) && (current.hasNewer || (current.messages.length >= MAX_CHANNEL_MESSAGES && entry.viewport?.following === false)) && message.id > last) {
      this.update(message.channel_id, { hasNewer: true, pending }, true); return
    }
    const { messages, truncated } = this.merge(entry, [message])
    this.update(message.channel_id, { messages, pending, ...(truncated ? { hasMore: true, nextBeforeId: messages[0]!.id } : {}) }, true)
  }
  reactions(event: MessageReactions) {
    if (this.closed) return
    this.emit({ type: 'reactions', channelId: event.channel_id, reactions: event })
    const entry = this.entries.get(event.channel_id)
    const current = entry?.state.messages.find((value) => value.id === event.message_id)
    if (!entry || this.closed || entry.tombstones.has(event.message_id)) return
    if (event.revision <= (entry.reactionSnapshots.get(event.message_id)?.revision ?? 0)) return
    entry.reactionSnapshots.set(event.message_id, event)
    while (entry.reactionSnapshots.size > MAX_CHANNEL_MESSAGES) entry.reactionSnapshots.delete(entry.reactionSnapshots.keys().next().value!)
    if (!current) return
    const next = withReactions(current, event)
    if (next === current) return
    entry.version++
    entry.live.set(next.id, { version: entry.version, message: next })
    this.update(event.channel_id, { messages: entry.state.messages.map((value) => value.id === next.id ? next : value) })
  }
  isDeleted(channelId: number, messageId: number) { return this.entries.get(channelId)?.tombstones.has(messageId) ?? false }
  remove(channelId: number, messageId: number) {
    this.emit({ type: 'deleted', channelId, id: messageId })
    const entry = this.entries.get(channelId)
    if (!entry) return
    entry.version++; entry.live.delete(messageId); entry.reactionSnapshots.delete(messageId); entry.tombstones.add(messageId)
    // Bound tombstones too; oldest evicted messages cannot be in the window.
    while (entry.tombstones.size > MAX_CHANNEL_MESSAGES * 2) entry.tombstones.delete(entry.tombstones.values().next().value!)
    this.update(channelId, { messages: resolveReplyReferences(entry.state.messages.filter((message) => message.id !== messageId), [], entry.tombstones) })
  }
  async syncCached(serverId: number) {
    await Promise.all([...this.entries].filter(([, entry]) => entry.serverId === serverId).map(([id]) => this.sync(serverId, id).catch(() => undefined)))
  }
  sync(serverId: number, channelId: number): Promise<void> {
    const entry = this.entry(serverId, channelId)
    if (entry.sync) { entry.syncAgain = true; return entry.sync }
    const controller = entry.historyController
    const run = async () => {
      do {
        entry.syncAgain = false
        let more: boolean
        do {
          const version = entry.version
          const generation = entry.contextGeneration
          const after = entry.forceSnapshot ? undefined : entry.state.cursor ?? undefined
          entry.forceSnapshot = false
          const page = await this.api.messages.sync(this.token, serverId, channelId, after, controller.signal)
          if (this.closed || controller.signal.aborted) return
          this.applySync(channelId, entry, page, version, generation)
          more = page.has_more
        } while (more)
      } while (entry.syncAgain)
    }
    const promise = run().finally(() => {
      if (entry.sync === promise) {
        entry.sync = undefined
        if (this.entries.get(channelId) === entry) this.update(channelId, { loading: false })
        this.trim()
      }
    })
    entry.sync = promise
    if (entry.state.cursor === null && entry.state.messages.length === 0) this.update(channelId, { loading: true })
    return promise
  }
  private applySync(channelId: number, entry: Entry, page: MessageSyncPage, version: number, generation: number) {
    page.messages.forEach((message) => this.emit({ type: 'message', channelId, message }))
    if (page.reset) this.emit({ type: 'reset', channelId })
    page.deleted_ids.forEach((id) => this.remove(channelId, id))
    // A reset is authoritative. Replay only live events that raced its request.
    const reset = page.reset && generation === entry.contextGeneration && !(entry.state.cursor === null && entry.state.hasNewer)
    if (reset) {
      const present = new Set(page.messages.map((message) => message.id))
      const first = page.messages[0]?.id ?? 0, last = page.messages.at(-1)?.id ?? Infinity
      entry.state.messages.forEach((message) => {
        if (message.id >= first && message.id <= last && !present.has(message.id) && (entry.live.get(message.id)?.version ?? 0) <= version) this.remove(channelId, message.id)
      })
    }
    const preserveWindow = !reset && entry.viewport?.following === false && entry.state.messages.length >= MAX_CHANNEL_MESSAGES
    const incoming = reset ? [...page.messages, ...[...entry.live.values()].filter((item) => item.version > version).map((item) => item.message)] : page.messages.filter((message) => {
      const first = entry.state.messages[0]?.id ?? 0, last = entry.state.messages.at(-1)?.id ?? Infinity
      return (!entry.state.hasNewer && !preserveWindow && message.id >= first) || (message.id >= first && message.id <= last)
    })
    const { messages, truncated } = this.merge(entry, incoming, reset)
    const acknowledged = new Set(page.messages.flatMap((message) => message.client_message_id && message.author.user_id === this.userId ? [message.client_message_id] : []))
    const pending = acknowledged.size ? entry.state.pending.filter((item) => !acknowledged.has(item.id)) : entry.state.pending
    this.update(channelId, {
      messages, pending, cursor: page.cursor,
      ...(reset ? { hasMore: page.has_older, hasNewer: false, nextBeforeId: page.has_older ? messages[0]?.id ?? null : null } : {}),
      ...(truncated ? { hasMore: true, nextBeforeId: messages[0]!.id } : {}),
      ...(preserveWindow && page.messages.some((message) => message.id > (messages.at(-1)?.id ?? 0)) ? { hasNewer: true } : {}),
    })
  }
  context(serverId: number, channelId: number, messageId: number): Promise<void> {
    const entry = this.entry(serverId, channelId)
    if (entry.contextRequest?.messageId === messageId) return entry.contextRequest.promise
    const generation = ++entry.contextGeneration
    entry.contextRequest?.controller.abort()
    entry.contextRequest = undefined
    // A virtualized row may be outside the viewport but already in memory.
    // Preserve the window and pagination when jumping to a loaded message.
    if (entry.state.messages.some((message) => message.id === messageId)) {
      this.update(channelId, { loading: false, loadingOlder: false, loadingNewer: false })
      return Promise.resolve()
    }
    const controller = new AbortController()
    const signal = AbortSignal.any([controller.signal, entry.historyController.signal])
    this.update(channelId, { loading: true, loadingOlder: false, loadingNewer: false })
    const run = async () => {
      try {
        const page = await this.api.messages.context(this.token, serverId, channelId, messageId, 25, 25, signal)
        if (signal.aborted || generation !== entry.contextGeneration) return
        const { messages } = this.merge(entry, page.messages, true)
        this.update(channelId, { messages, nextBeforeId: messages[0]?.id ?? null, hasMore: page.target_index >= 25, hasNewer: page.messages.length - page.target_index - 1 >= 25 })
      } catch (error) {
        if (!signal.aborted && generation === entry.contextGeneration) throw error
      } finally {
        if (generation === entry.contextGeneration && this.entries.get(channelId) === entry) {
          entry.contextRequest = undefined
          this.update(channelId, { loading: false })
        }
        this.trim()
      }
    }
    const promise = run()
    entry.contextRequest = { messageId, controller, promise }
    return promise
  }
  async older(serverId: number, channelId: number) {
    const entry = this.entry(serverId, channelId)
    if (!entry.state.nextBeforeId || entry.state.loadingOlder) return
    const generation = entry.contextGeneration
    this.update(channelId, { loadingOlder: true })
    try {
      const page = await this.api.messages.list(this.token, serverId, channelId, entry.state.nextBeforeId, entry.historyController.signal)
      if (generation !== entry.contextGeneration || entry.controller.signal.aborted) return
      const { messages, truncated } = this.merge(entry, page.messages, false, true)
      this.update(channelId, { messages, hasMore: page.pagination.has_more, nextBeforeId: page.pagination.next_before_id, hasNewer: entry.state.hasNewer || truncated })
    } finally { if (generation === entry.contextGeneration && this.entries.get(channelId) === entry) this.update(channelId, { loadingOlder: false }); this.trim() }
  }
  async newer(serverId: number, channelId: number) {
    const entry = this.entry(serverId, channelId), pivot = entry.state.messages.at(-1)
    if (!pivot || !entry.state.hasNewer || entry.state.loadingNewer) return
    const generation = entry.contextGeneration
    this.update(channelId, { loadingNewer: true })
    try {
      const page = await this.api.messages.context(this.token, serverId, channelId, pivot.id, 1, 50, entry.historyController.signal)
      if (generation !== entry.contextGeneration || entry.controller.signal.aborted) return
      const { messages, truncated } = this.merge(entry, page.messages)
      this.update(channelId, { messages, hasNewer: page.messages.length - page.target_index - 1 >= 50, ...(truncated ? { hasMore: true, nextBeforeId: messages[0]!.id } : {}) })
      if (!entry.state.hasNewer) await this.sync(serverId, channelId)
    } finally { if (generation === entry.contextGeneration && this.entries.get(channelId) === entry) this.update(channelId, { loadingNewer: false }); this.trim() }
  }
  async latest(serverId: number, channelId: number) {
    const entry = this.entry(serverId, channelId)
    entry.contextRequest?.controller.abort(); entry.contextRequest = undefined
    entry.contextGeneration++; entry.viewport = undefined
    entry.forceSnapshot = true
    this.update(channelId, { cursor: null, hasNewer: false })
    await this.sync(serverId, channelId)
  }
  private scheduleRetry(entry: Entry, channelId: number, id: string, content: string, delay: number) {
    entry.retryTimers.set(id, setTimeout(() => {
      if (!this.closed && this.entries.get(channelId) === entry) void this.send(entry.serverId, channelId, content, id)
    }, delay))
  }
  send(serverId: number, channelId: number, content: string, retryId?: string, reply?: MessageReply, forward?: ForwardSource, newId?: string, threadRootId?: number, attachmentIds?: string[]): Promise<Message | void> {
    const entry = this.entry(serverId, channelId)
    if (!retryId && [...this.entries.values()].reduce((count, value) => count + value.state.pending.length, 0) >= MAX_PENDING_MESSAGES) throw new Error('Сначала повторите или удалите неотправленные сообщения')
    const id = retryId ?? newId ?? crypto.randomUUID()
    const pending = entry.state.pending.find((item) => item.id === id)
    if (retryId && (!pending || pending.status === 'sending')) return Promise.resolve()
    if (entry.sendControllers.has(id)) return Promise.resolve()
    clearTimeout(entry.retryTimers.get(id))
    entry.retryTimers.delete(id)
    const reference = pending?.reply ?? reply
    const forwarded = pending?.forward ?? forward
    const thread = pending?.threadRootId ?? threadRootId
    const attachments = pending?.attachmentIds ?? attachmentIds
    const text = pending?.content ?? content
    const attempts = pending?.retryable === true ? pending.attempts ?? 0 : 0
    const next: PendingMessage = { id, content: text, status: 'sending', ...(attempts ? { attempts } : {}), ...(attachments?.length ? { attachmentIds: [...attachments] } : {}), ...(thread ? { threadRootId: thread } : {}), ...(reference ? { reply: reference } : {}), ...(forwarded ? { forward: forwarded } : {}) }
    const controller = new AbortController()
    entry.sendControllers.set(id, controller)
    const lifetime = AbortSignal.any([entry.controller.signal, controller.signal])
    this.update(channelId, { pending: pending ? entry.state.pending.map((item) => item.id === id ? next : item) : [...entry.state.pending, next] })
    const previous = entry.dispatchTail
    let cancelWait!: () => void
    const cancelled = new Promise<void>((resolve) => { cancelWait = resolve })
    if (lifetime.aborted) cancelWait()
    else lifetime.addEventListener('abort', cancelWait, { once: true })
    const request = (async () => {
      await Promise.race([previous, cancelled])
      lifetime.removeEventListener('abort', cancelWait)
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        if (lifetime.aborted || this.closed || this.entries.get(channelId) !== entry) return
        if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new Error('Нет подключения к интернету')
        const timeout = new AbortController()
        timer = setTimeout(() => timeout.abort(), 15_000)
        const signal = AbortSignal.any([lifetime, timeout.signal])
        const message = await (forwarded
          ? this.api.messages.forward(this.token, serverId, channelId, forwarded.server_id, forwarded.channel_id, forwarded.message_id, id, signal)
          : this.api.messages.create(this.token, serverId, channelId, text, id, signal, reference?.message_id, thread, attachments))
        if (lifetime.aborted || this.closed || this.entries.get(channelId) !== entry) return
        this.receive({ ...message, client_message_id: id })
        this.update(channelId, { pending: entry.state.pending.filter((item) => item.id !== id) })
        return message
      } catch (error) {
        // A WS acknowledgement may have arrived while the HTTP reply was lost.
        if (lifetime.aborted || !entry.state.pending.some((item) => item.id === id)) return
        const delay = SEND_RETRY_DELAYS[attempts]
        const retryable = delay !== undefined && retryableSendError(error)
        this.update(channelId, { pending: entry.state.pending.map((item) => item.id === id ? {
          ...item, status: 'failed', error: error instanceof Error ? humanError(error) : 'Ошибка сети',
          attempts: attempts + 1, retryable,
        } : item) })
        if (retryable && entry.state.pending.some((item) => item.id === id)) {
          this.scheduleRetry(entry, channelId, id, text, delay)
        }
      } finally {
        clearTimeout(timer)
        entry.sendControllers.delete(id)
        this.trim()
      }
    })()
    // Cancelling a queued item leaves later sends behind the active request.
    entry.dispatchTail = Promise.allSettled([previous, request]).then(() => undefined)
    return request
  }
  async retryFailed() {
    await Promise.all([...this.entries].map(async ([channelId, entry]) => {
      // Drain only this channel's current sends. Another channel may already
      // be ready to retry, and an in-flight send can fail after reconnect.
      if (entry.state.pending.some((item) => item.status === 'sending')) await entry.dispatchTail
      if (this.closed || this.entries.get(channelId) !== entry) return
      const failed = entry.state.pending.filter((item) => item.status === 'failed' && item.retryable !== false)
      await Promise.all(failed.map((item) => this.send(entry.serverId, channelId, item.content, item.id)))
    }))
  }
  async forward(serverId: number, channelId: number, source: ForwardSource, key: string): Promise<Message> {
    const entry = this.entry(serverId, channelId)
    const retry = entry.state.pending.some((item) => item.id === key)
    const created = await this.send(serverId, channelId, source.content, retry ? key : undefined, undefined, source, key)
    if (created) return created
    const acknowledged = entry.state.messages.find((value) => value.client_message_id === key) ?? [...entry.live.values()].find((value) => value.message.client_message_id === key)?.message
    if (acknowledged) return acknowledged
    const failed = entry.state.pending.find((item) => item.id === key)
    throw new Error(failed?.error ?? 'Не удалось завершить пересылку')
  }
  private removeForwardSources(predicate: (source: ForwardSource) => boolean) {
    for (const [id, entry] of this.entries) {
      const pending = entry.state.pending.filter((item) => !item.forward || !predicate(item.forward))
      if (pending.length !== entry.state.pending.length) this.update(id, { pending })
    }
  }
  dismiss(channelId: number, id: string) {
    const entry = this.entries.get(channelId)
    if (entry) this.update(channelId, { pending: entry.state.pending.filter((item) => item.id !== id) })
  }
  removeChannel(channelId: number) {
    this.removeForwardSources((source) => source.channel_id === channelId)
    const entry = this.entries.get(channelId)
    if (!entry) return
    this.update(channelId, initial()); clearTimeout(entry.notificationTimer); entry.controller.abort(); entry.historyController.abort(); this.entries.delete(channelId); entry.listeners.forEach((listener) => listener())
  }
  retainChannels(serverId: number, allowed: ReadonlySet<number>) {
    this.removeForwardSources((source) => source.server_id === serverId && !allowed.has(source.channel_id))
    for (const [id, entry] of this.entries) if (entry.serverId === serverId && !allowed.has(id)) {
      this.update(id, initial()); clearTimeout(entry.notificationTimer); entry.controller.abort(); entry.historyController.abort(); this.entries.delete(id); entry.listeners.forEach((listener) => listener())
    }
  }
  removeServer(serverId: number) {
    this.removeForwardSources((source) => source.server_id === serverId)
    for (const [id, entry] of this.entries) if (entry.serverId === serverId) {
      this.update(id, initial()); clearTimeout(entry.notificationTimer); entry.controller.abort(); entry.historyController.abort(); this.entries.delete(id); entry.listeners.forEach((listener) => listener())
    }
  }
  close() { this.closed = true; this.observers.clear(); this.entries.forEach((entry) => { clearTimeout(entry.notificationTimer); entry.controller.abort(); entry.historyController.abort() }); this.entries.clear() }
}
