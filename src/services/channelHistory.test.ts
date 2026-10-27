import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Message, MessageSyncPage } from '../domain/types'
import type { VoxholdApi } from './api'
import { ChannelHistoryStore, EMPTY_HISTORY, MAX_CHANNEL_MESSAGES } from './channelHistory'

const message = (id: number, channel = 2, revision = 1): Message => ({ id, channel_id: channel, author: { user_id: 1, username: 'Alice' }, content: `message ${id}`, revision, created_at: 1, edited_at: null })
const page = (messages: Message[] = [], extra: Partial<MessageSyncPage> = {}): MessageSyncPage => ({ messages, deleted_ids: [], cursor: 10, reset: true, has_more: false, has_older: false, ...extra })
const deferred = <T,>() => { let resolve!: (value: T) => void, reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
const stores: ChannelHistoryStore[] = []
function setup(sync = vi.fn(async () => page())) {
  const create = vi.fn(async (_token: string, _server: number, channel: number, _content: string, _key?: string, _signal?: AbortSignal) => message(1, channel))
  const context = vi.fn(async () => ({ messages: [message(20)], target_index: 0, target_message_id: 20 }))
  const list = vi.fn(async () => ({ messages: [message(1)], pagination: { next_before_id: null, has_more: false } }))
  const api = { messages: { sync, create, context, list } } as unknown as VoxholdApi
  const store = new ChannelHistoryStore(api, 'token', 1)
  stores.push(store)
  return { store, sync, create, context, list }
}
afterEach(() => { stores.splice(0).forEach((store) => store.close()); vi.restoreAllMocks() })

describe('channel history and reconnect', () => {
  it('does not resurrect a deleted row from a late WS create after an authoritative reset', async () => {
    const { store, sync } = setup(vi.fn(async () => page([message(1), message(2), message(3)])))
    await store.sync(1, 2)
    sync.mockResolvedValueOnce(page([message(1), message(3)], { cursor: 20 }))
    await store.sync(1, 2)
    store.receive(message(2))
    expect(store.snapshot(2).messages.map((item) => item.id)).toEqual([1, 3])
  })
  it('does not resurrect a deletion or overwrite a live edit with a late snapshot', async () => {
    const pending = deferred<MessageSyncPage>()
    const { store } = setup(vi.fn(() => pending.promise))
    const loading = store.sync(1, 2)
    store.receive(message(1, 2, 3)); store.remove(2, 2)
    pending.resolve(page([message(1), message(2)]))
    await loading
    expect(store.snapshot(2).messages).toEqual([message(1, 2, 3)])
  })
  it('keeps cached channels separate when an older request finishes after navigation', async () => {
    const pending = deferred<MessageSyncPage>()
    const { store } = setup(vi.fn(() => pending.promise))
    const loading = store.sync(1, 2)
    const active = vi.fn()
    store.subscribe(1, 4, active)
    store.receive(message(40, 4))
    const calls = active.mock.calls.length
    pending.resolve(page([message(2)])); await loading
    expect(store.snapshot(4).messages.map((item) => item.id)).toEqual([40])
    expect(active).toHaveBeenCalledTimes(calls)
    expect(store.snapshot(2).messages.map((item) => item.id)).toEqual([2])
  })
  it('bounds history in memory and evicts least recently visited channels', () => {
    const { store } = setup()
    store.entry(1, 2)
    for (let id = 1; id <= 3000; id++) store.receive(message(id))
    expect(store.snapshot(2).messages).toHaveLength(MAX_CHANNEL_MESSAGES)
    expect(store.snapshot(2).messages[0]?.id).toBe(2001)
    expect(store.snapshot(2).hasMore).toBe(true)
    for (let channel = 3; channel <= 12; channel++) store.subscribe(1, channel, () => {})()
    expect(store.snapshot(2)).toBe(EMPTY_HISTORY)
  })
  it('stops appending when the bounded window would evict the reader position', () => {
    const { store } = setup()
    store.entry(1, 2)
    for (let id = 1; id <= MAX_CHANNEL_MESSAGES; id++) store.receive(message(id))
    store.viewport(2, { messageId: 20, offset: -5, following: false })
    store.receive(message(MAX_CHANNEL_MESSAGES + 1))
    expect(store.snapshot(2).messages[0]?.id).toBe(1)
    expect(store.snapshot(2).hasNewer).toBe(true)
  })
  it('catches up every journal page and applies missed deletes', async () => {
    const { store, sync } = setup()
    await store.sync(1, 2)
    store.receive(message(1)); store.receive(message(2))
    sync.mockResolvedValueOnce(page([message(1, 2, 2)], { reset: false, cursor: 11, has_more: true }))
    sync.mockResolvedValueOnce(page([], { reset: false, cursor: 12, deleted_ids: [2] }))
    await store.sync(1, 2)
    expect(store.snapshot(2).cursor).toBe(12)
    expect(store.snapshot(2).messages).toEqual([message(1, 2, 2)])
  })
  it('keeps a search context when the initial sync snapshot arrives later', async () => {
    const pending = deferred<MessageSyncPage>()
    const { store, context } = setup(vi.fn(() => pending.promise))
    const loading = store.sync(1, 2)
    context.mockResolvedValue({ messages: Array.from({ length: 51 }, (_, i) => message(i + 1)), target_index: 25, target_message_id: 26 })
    await store.context(1, 2, 26)
    pending.resolve(page([message(500)])); await loading
    expect(store.snapshot(2).messages.some((item) => item.id === 26)).toBe(true)
    expect(store.snapshot(2).messages.some((item) => item.id === 500)).toBe(false)
  })
  it('handles React strict effect replay without disposing the live cache', async () => {
    const { store } = setup()
    const release = store.retain(); release(); store.retain()
    await Promise.resolve()
    await store.sync(1, 2)
    store.receive(message(1))
    expect(store.snapshot(2).messages).toHaveLength(1)
  })
})

describe('outgoing message acknowledgement', () => {
  it('does not refill an evicted outbox history from a late request and can immediately load it again', async () => {
    const late = deferred<MessageSyncPage>()
    const fresh = deferred<MessageSyncPage>()
    const { store, sync, create } = setup(vi.fn(() => late.promise))
    create.mockRejectedValueOnce(new Error('offline'))
    await store.send(1, 2, 'pending')
    const loading = store.sync(1, 2)
    for (let channel = 3; channel <= 15; channel++) store.subscribe(1, channel, () => {})()
    const release = store.subscribe(1, 2, () => {})
    sync.mockReturnValueOnce(fresh.promise)
    const reloaded = store.sync(1, 2)
    late.resolve(page([message(1)])); await loading
    expect(store.snapshot(2).messages).toHaveLength(0)
    expect(store.snapshot(2).loading).toBe(true)
    fresh.resolve(page([message(50)])); await reloaded
    expect(store.snapshot(2).messages.map((item) => item.id)).toEqual([50])
    expect(store.snapshot(2).pending).toHaveLength(1)
    release()
  })
  it('acknowledges a saved outgoing message older than the visible history window', async () => {
    const reply = deferred<Message>()
    const { store, create, sync } = setup()
    create.mockReturnValueOnce(reply.promise)
    const sending = store.send(1, 2, 'old reply')
    const id = store.snapshot(2).pending[0]!.id
    sync.mockResolvedValueOnce(page([message(100)]))
    await store.sync(1, 2)
    store.receive({ ...message(1), client_message_id: id })
    reply.reject(new Error('reply lost')); await sending
    expect(store.snapshot(2).pending).toEqual([])
    expect(store.snapshot(2).messages.map((item) => item.id)).toEqual([100])
  })
  it('preserves a failed outbox when its history falls out of the LRU cache', async () => {
    const { store, create } = setup()
    create.mockRejectedValueOnce(new Error('offline'))
    await store.send(1, 2, 'keep me')
    const id = store.snapshot(2).pending[0]!.id
    for (let channel = 3; channel <= 15; channel++) store.subscribe(1, channel, () => {})()
    expect(store.snapshot(2).pending[0]?.id).toBe(id)
    await store.send(1, 2, 'keep me', id)
    expect(store.snapshot(2).pending).toHaveLength(0)
  })
  it('retries with the same key after a failed HTTP request', async () => {
    const { store, create } = setup()
    create.mockRejectedValueOnce(new Error('network'))
    await store.send(1, 2, 'hello')
    const pending = store.snapshot(2).pending[0]!
    expect(pending.status).toBe('failed')
    await store.send(1, 2, pending.content, pending.id)
    expect(create.mock.calls[0]![4]).toBe(create.mock.calls[1]![4])
    expect(store.snapshot(2).pending).toEqual([])
    expect(store.snapshot(2).messages).toHaveLength(1)
  })
  it('accepts a WS acknowledgement even when the HTTP response is lost', async () => {
    const response = deferred<Message>()
    const { store, create } = setup()
    create.mockReturnValueOnce(response.promise)
    const sending = store.send(1, 2, 'hello')
    const id = store.snapshot(2).pending[0]!.id
    store.receive({ ...message(1), client_message_id: id })
    response.reject(new Error('reply lost')); await sending
    expect(store.snapshot(2).pending).toEqual([])
    expect(store.snapshot(2).messages).toHaveLength(1)
  })
  it('does not accept another user acknowledgement with the same key', async () => {
    const response = deferred<Message>()
    const { store, create } = setup()
    create.mockReturnValueOnce(response.promise)
    const sending = store.send(1, 2, 'hello')
    const id = store.snapshot(2).pending[0]!.id
    store.receive({ ...message(2), author: { user_id: 2, username: 'other' }, client_message_id: id })
    expect(store.snapshot(2).pending).toHaveLength(1)
    response.reject(new Error('reply lost')); await sending
    expect(store.snapshot(2).pending[0]?.status).toBe('failed')
  })
})
