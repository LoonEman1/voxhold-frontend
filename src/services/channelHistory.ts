import type { Message, MessageSyncPage } from '../domain/types'
import type { VoxholdApi } from './api'
import { newerMessage } from '../lib/messageRevisions'

export const MAX_CACHED_CHANNELS = 8
export const MAX_CHANNEL_MESSAGES = 1_000
export interface ChatViewport { messageId: number; offset: number; following: boolean }
export interface PendingMessage { id: string; content: string; status: 'sending' | 'failed'; error?: string }
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
  live: Map<number, { version: number; message: Message }>
  version: number
  viewport?: ChatViewport
  sync?: Promise<void>
  syncAgain: boolean
  contextGeneration: number
  forceSnapshot: boolean
}
const initial = (): ChannelHistoryState => ({ messages: [], cursor: null, nextBeforeId: null, hasMore: false, hasNewer: false, loading: false, loadingOlder: false, loadingNewer: false, pending: [] })
export const EMPTY_HISTORY = initial()

/** A per-login, bounded cache. Requests always retain their original channel. */
export class ChannelHistoryStore {
  private entries = new Map<number, Entry>()
  private closed = false
  private mounts = 0
  constructor(private api: VoxholdApi, private token: string, private userId = 0) {}
  retain() {
    this.mounts++
    return () => { this.mounts--; queueMicrotask(() => { if (this.mounts === 0) this.close() }) }
  }

  entry(serverId: number, channelId: number): Entry {
    let entry = this.entries.get(channelId)
    if (!entry) {
      entry = { serverId, state: initial(), listeners: new Set(), controller: new AbortController(), historyController: new AbortController(), tombstones: new Set(), live: new Map(), version: 0, syncAgain: false, contextGeneration: 0, forceSnapshot: false }
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
  update(channelId: number, patch: Partial<ChannelHistoryState>) {
    const entry = this.entries.get(channelId)
    if (!entry || this.closed || entry.controller.signal.aborted) return
    entry.state = { ...entry.state, ...patch }
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
        entry.contextGeneration++
        entry.sync = undefined
        entry.state = { ...initial(), pending: entry.state.pending }
        entry.viewport = undefined; entry.live.clear(); entry.tombstones.clear()
        retained--; continue
      }
      entry.controller.abort(); entry.historyController.abort(); this.entries.delete(id)
      retained--
    }
  }
  private merge(entry: Entry, incoming: Message[], reset = false, preferOlder = false) {
    const values = new Map((reset ? [] : entry.state.messages).map((message) => [message.id, message]))
    const previous = new Map(entry.state.messages.map((message) => [message.id, message]))
    incoming.forEach((message) => {
      if (!entry.tombstones.has(message.id)) values.set(message.id, newerMessage(values.get(message.id) ?? previous.get(message.id), message))
    })
    const sorted = [...values.values()].filter((message) => !entry.tombstones.has(message.id)).sort((a, b) => a.id - b.id)
    const truncated = sorted.length > MAX_CHANNEL_MESSAGES
    return { messages: preferOlder ? sorted.slice(0, MAX_CHANNEL_MESSAGES) : sorted.slice(-MAX_CHANNEL_MESSAGES), truncated }
  }
  receive(message: Message) {
    if (this.closed) return
    const entry = this.entries.get(message.channel_id)
    if (!entry || entry.tombstones.has(message.id)) return
    entry.version++
    entry.live.set(message.id, { version: entry.version, message })
    while (entry.live.size > MAX_CHANNEL_MESSAGES) entry.live.delete(entry.live.keys().next().value!)
    const current = entry.state
    const pending = message.client_message_id && message.author.user_id === this.userId ? current.pending.filter((item) => item.id !== message.client_message_id) : current.pending
    const last = current.messages.at(-1)?.id ?? 0
    if (current.messages.length && message.id < current.messages[0]!.id) {
      if (pending !== current.pending) this.update(message.channel_id, { pending })
      return
    }
    if (!current.messages.some((item) => item.id === message.id) && (current.hasNewer || (current.messages.length >= MAX_CHANNEL_MESSAGES && entry.viewport?.following === false)) && message.id > last) {
      this.update(message.channel_id, { hasNewer: true, pending }); return
    }
    const { messages, truncated } = this.merge(entry, [message])
    this.update(message.channel_id, { messages, pending, ...(truncated ? { hasMore: true, nextBeforeId: messages[0]!.id } : {}) })
  }
  remove(channelId: number, messageId: number) {
    const entry = this.entries.get(channelId)
    if (!entry) return
    entry.version++; entry.live.delete(messageId); entry.tombstones.add(messageId)
    // Bound tombstones too; oldest evicted messages cannot be in the window.
    while (entry.tombstones.size > MAX_CHANNEL_MESSAGES * 2) entry.tombstones.delete(entry.tombstones.values().next().value!)
    this.update(channelId, { messages: entry.state.messages.filter((message) => message.id !== messageId) })
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
    this.update(channelId, {
      messages, cursor: page.cursor,
      ...(reset ? { hasMore: page.has_older, hasNewer: false, nextBeforeId: page.has_older ? messages[0]?.id ?? null : null } : {}),
      ...(truncated ? { hasMore: true, nextBeforeId: messages[0]!.id } : {}),
      ...(preserveWindow && page.messages.some((message) => message.id > (messages.at(-1)?.id ?? 0)) ? { hasNewer: true } : {}),
    })
  }
  async context(serverId: number, channelId: number, messageId: number) {
    const entry = this.entry(serverId, channelId), generation = ++entry.contextGeneration
    this.update(channelId, { loading: true })
    try {
      const page = await this.api.messages.context(this.token, serverId, channelId, messageId, 25, 25, entry.historyController.signal)
      if (entry.controller.signal.aborted || generation !== entry.contextGeneration) return
      const { messages } = this.merge(entry, page.messages, true)
      this.update(channelId, { messages, nextBeforeId: messages[0]?.id ?? null, hasMore: page.target_index >= 25, hasNewer: page.messages.length - page.target_index - 1 >= 25 })
    } finally { if (generation === entry.contextGeneration && this.entries.get(channelId) === entry) this.update(channelId, { loading: false }); this.trim() }
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
    entry.contextGeneration++; entry.viewport = undefined
    entry.forceSnapshot = true
    this.update(channelId, { cursor: null, hasNewer: false })
    await this.sync(serverId, channelId)
  }
  async send(serverId: number, channelId: number, content: string, retryId?: string) {
    const entry = this.entry(serverId, channelId)
    if (!retryId && [...this.entries.values()].reduce((count, value) => count + value.state.pending.length, 0) >= 20) throw new Error('Сначала повторите или удалите неотправленные сообщения')
    const id = retryId ?? crypto.randomUUID()
    const pending = entry.state.pending.find((item) => item.id === id)
    if (retryId && (!pending || pending.status === 'sending')) return
    this.update(channelId, { pending: [...entry.state.pending.filter((item) => item.id !== id), { id, content, status: 'sending' }] })
    const timeout = new AbortController()
    const abort = () => timeout.abort()
    entry.controller.signal.addEventListener('abort', abort, { once: true })
    const timer = setTimeout(abort, 15_000)
    try {
      const message = await this.api.messages.create(this.token, serverId, channelId, content, id, timeout.signal)
      if (this.closed || entry.controller.signal.aborted || this.entries.get(channelId) !== entry) return
      this.receive({ ...message, client_message_id: id })
      this.update(channelId, { pending: entry.state.pending.filter((item) => item.id !== id) })
      return message
    } catch (error) {
      // A WS acknowledgement may have arrived while the HTTP reply was lost.
      if (!entry.state.pending.some((item) => item.id === id)) return
      this.update(channelId, { pending: entry.state.pending.map((item) => item.id === id ? { ...item, status: 'failed', error: error instanceof Error ? error.message : 'Ошибка сети' } : item) })
    } finally { clearTimeout(timer); entry.controller.signal.removeEventListener('abort', abort); this.trim() }
  }
  dismiss(channelId: number, id: string) {
    const entry = this.entries.get(channelId)
    if (entry) this.update(channelId, { pending: entry.state.pending.filter((item) => item.id !== id || item.status === 'sending') })
  }
  removeServer(serverId: number) {
    for (const [id, entry] of this.entries) if (entry.serverId === serverId) {
      this.update(id, initial()); entry.controller.abort(); entry.historyController.abort(); this.entries.delete(id); entry.listeners.forEach((listener) => listener())
    }
  }
  close() { this.closed = true; this.entries.forEach((entry) => { entry.controller.abort(); entry.historyController.abort() }); this.entries.clear() }
}
