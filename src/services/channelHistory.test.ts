// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Message, MessageSyncPage } from '../domain/types'
import type { VoxholdApi } from './api'
import { ChannelHistoryStore, EMPTY_HISTORY, MAX_CHANNEL_MESSAGES } from './channelHistory'

const message = (id: number, channel = 2, revision = 1): Message => ({ id, channel_id: channel, author: { user_id: 1, username: 'Alice' }, content: `message ${id}`, revision, created_at: 1, edited_at: null })
const page = (messages: Message[] = [], extra: Partial<MessageSyncPage> = {}): MessageSyncPage => ({ messages, deleted_ids: [], cursor: 10, reset: true, has_more: false, has_older: false, ...extra })
const deferred = <T,>() => { let resolve!: (value: T) => void, reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
const stores: ChannelHistoryStore[] = []
const storageKey = (scope = 'test-instance', userId = 1) => `voxhold.outbox.v1:${scope}:${userId}`
function setup(sync = vi.fn(async () => page()), scope?: string, userId = 1) {
  const create = vi.fn(async (_token: string, _server: number, channel: number, _content: string, _key?: string, _signal?: AbortSignal, _reply?: number, _thread?: number, _attachmentIds?: string[]) => message(1, channel))
  const context = vi.fn(async () => ({ messages: [message(20)], target_index: 0, target_message_id: 20 }))
  const list = vi.fn(async () => ({ messages: [message(1)], pagination: { next_before_id: null, has_more: false } }))
  const forward = vi.fn(async (_token: string, _server: number, channel: number, _sourceServer: number, _sourceChannel: number, _sourceMessage: number, _key: string, _signal?: AbortSignal) => ({ ...message(90, channel), forward: { author: message(1).author, created_at: 1 } }))
  const api = { storageScope: scope, messages: { sync, create, context, list, forward } } as unknown as VoxholdApi
  const store = new ChannelHistoryStore(api, 'token', userId)
  stores.push(store)
  return { store, api, sync, create, context, list, forward }
}
afterEach(() => { stores.splice(0).forEach((store) => store.close()); localStorage.clear(); vi.restoreAllMocks() })

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
  it('retries one mixed message with the same file IDs, caption and idempotency key', async () => {
    const { store, create } = setup()
    create.mockRejectedValueOnce(new Error('network'))
    await store.send(1, 2, 'Фото и документ', undefined, undefined, undefined, undefined, undefined, ['image-id', 'file-id'])
    const pending = store.snapshot(2).pending[0]!
    expect(pending.attachmentIds).toEqual(['image-id', 'file-id'])
    await store.send(1, 2, pending.content, pending.id)
    expect(create.mock.calls[0]![4]).toBe(create.mock.calls[1]![4])
    expect(create.mock.calls[1]![3]).toBe('Фото и документ')
    expect(create.mock.calls[1]![8]).toEqual(['image-id', 'file-id'])
    expect(store.snapshot(2).pending).toEqual([])
  })
  it('accepts a WS acknowledgement even when the HTTP response is lost', async () => {
    const response = deferred<Message>()
    const { store, create } = setup()
    create.mockReturnValueOnce(response.promise)
    const sending = store.send(1, 2, 'hello')
    const id = store.snapshot(2).pending[0]!.id
    await vi.waitFor(() => expect(create).toHaveBeenCalledOnce())
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

it('revoked access clears cached history and prevents an in-flight response restoring it', async () => {
  const pending = deferred<MessageSyncPage>()
  const { store } = setup(vi.fn(() => pending.promise))
  const loading = store.sync(1, 2)
  store.entry(1, 3); store.receive(message(50, 2)); store.receive(message(60, 3))
  store.retainChannels(1, new Set([3]))
  pending.resolve(page([message(99)])); await loading
  expect(store.snapshot(2)).toEqual(EMPTY_HISTORY)
  expect(store.snapshot(3).messages).toEqual([message(60, 3)])
})

it('reconciles a reaction racing a history response without hiding an edit', async () => {
  const { store, sync } = setup(vi.fn(async () => page([message(1)])))
  await store.sync(1, 2)
  const held = deferred<MessageSyncPage>()
  sync.mockReturnValueOnce(held.promise)
  const pending = store.sync(1, 2)
  store.reactions({ channel_id: 2, message_id: 1, revision: 3, reactions: [{ emoji: '👍', count: 1, me: true }] })
  held.resolve(page([{ ...message(1, 2, 2), content: 'edited', reactions: [], reactions_revision: 2 }]))
  await pending
  expect(store.snapshot(2).messages[0]!.content).toBe('edited')
  expect(store.snapshot(2).messages[0]!.reactions).toEqual([{ emoji: '👍', count: 1, me: true }])
})

it('preserves the reply target and send key when retrying the outbox', async () => {
  const { store, create } = setup()
  create.mockRejectedValueOnce(new Error('network'))
  const reference = { message_id: 40, author: { user_id: 2, username: 'Bob' }, content: 'original', revision: 1, deleted: false }
  await store.send(1, 2, 'answer', undefined, reference)
  const pending = store.snapshot(2).pending[0]!
  expect(pending.reply).toEqual(reference)
  await store.send(1, 2, pending.content, pending.id)
  expect(create.mock.calls[0]![4]).toBe(create.mock.calls[1]![4])
  expect((create.mock.calls[0] as unknown[])[6]).toBe(40)
  expect((create.mock.calls[1] as unknown[])[6]).toBe(40)
})

it('updates a quote when its target is outside the loaded window and ignores an older edit', async () => {
  const answer: Message = { ...message(20), reply: { message_id: 1, author: message(1).author, content: 'original', revision: 1, deleted: false } }
  const { store } = setup(vi.fn(async () => page([answer])))
  await store.sync(1, 2)
  store.receive({ ...message(1, 2, 3), content: 'new quote' })
  expect(store.snapshot(2).messages).toHaveLength(1)
  expect(store.snapshot(2).messages[0]!.reply!.content).toBe('new quote')
  store.receive({ ...message(1, 2, 2), content: 'late old quote' })
  expect(store.snapshot(2).messages[0]!.reply!.content).toBe('new quote')
  store.remove(2, 1)
  expect(store.snapshot(2).messages[0]!.reply!.deleted).toBe(true)
})

it('retries a failed forward with its original source and key', async () => {
  const { store, forward, create } = setup()
  const source = { server_id: 1, channel_id: 2, message_id: 8, content: 'original', author: message(8).author, created_at: 1 }
  forward.mockRejectedValueOnce(new Error('network'))
  await expect(store.forward(1, 3, source, 'forward-key')).rejects.toThrow('network')
  expect(store.snapshot(3).pending[0]?.forward).toEqual(source)
  const value = await store.forward(1, 3, source, 'forward-key')
  expect(value.id).toBe(90)
  expect(forward.mock.calls.map((call) => call.slice(1, 7))).toEqual([[1, 3, 1, 2, 8, 'forward-key'], [1, 3, 1, 2, 8, 'forward-key']])
  expect(create).not.toHaveBeenCalled()
  expect(store.snapshot(3).pending).toEqual([])
})

it('purges private forward previews when access to the source is revoked', async () => {
  const { store, forward } = setup()
  forward.mockRejectedValueOnce(new Error('network'))
  await expect(store.forward(1, 3, { server_id: 1, channel_id: 2, message_id: 8, content: 'secret', author: message(8).author, created_at: 1 }, 'forward-key')).rejects.toThrow()
  store.retainChannels(1, new Set([3]))
  expect(store.snapshot(3).pending).toEqual([])
})

it('retains reactions that arrive before their message history response', async () => {
  const held = deferred<MessageSyncPage>()
  const { store } = setup(vi.fn(() => held.promise))
  const loading = store.sync(1, 2)
  store.reactions({ channel_id: 2, message_id: 1, revision: 3, reactions: [{ emoji: '🔥', count: 2, me: true }] })
  held.resolve(page([{ ...message(1), reactions: [], reactions_revision: 1 }]))
  await loading
  expect(store.snapshot(2).messages[0]?.reactions).toEqual([{ emoji: '🔥', count: 2, me: true }])
  expect(store.snapshot(2).messages[0]?.content).toBe('message 1')
})

describe('reply navigation', () => {
  it('jumps within the cached window without requesting or replacing history', async () => {
    const { store, context } = setup(vi.fn(async () => page([message(10), message(11), message(12)], { has_older: true })))
    await store.sync(1, 2)
    const before = store.snapshot(2)
    for (let i = 0; i < 30; i++) await store.context(1, 2, 10)
    expect(context).not.toHaveBeenCalled()
    expect(store.snapshot(2).messages).toBe(before.messages)
    expect(store.snapshot(2).hasMore).toBe(before.hasMore)
    expect(store.snapshot(2).loading).toBe(false)
  })

  it('coalesces repeated jumps and preserves visible messages until context arrives', async () => {
    const { store, context } = setup(vi.fn(async () => page([message(100)])))
    await store.sync(1, 2)
    const reply = deferred<Awaited<ReturnType<typeof context>>>()
    context.mockReturnValueOnce(reply.promise)
    const tasks = Array.from({ length: 30 }, () => store.context(1, 2, 20))
    expect(context).toHaveBeenCalledOnce()
    expect(store.snapshot(2).messages.map((m) => m.id)).toEqual([100])
    reply.resolve({ messages: [message(20)], target_index: 0, target_message_id: 20 })
    await Promise.all(tasks)
    expect(store.snapshot(2).messages.map((m) => m.id)).toEqual([20])
    expect(store.snapshot(2).loading).toBe(false)
  })

  it('cancels an old jump when the reader selects a cached message', async () => {
    const { store, context } = setup(vi.fn(async () => page([message(100)])))
    await store.sync(1, 2)
    const reply = deferred<Awaited<ReturnType<typeof context>>>()
    context.mockReturnValueOnce(reply.promise)
    const old = store.context(1, 2, 20)
    await store.context(1, 2, 100)
    reply.resolve({ messages: [message(20)], target_index: 0, target_message_id: 20 })
    await old
    expect(store.snapshot(2).messages.map((m) => m.id)).toEqual([100])
    expect(store.snapshot(2).loading).toBe(false)
  })

  it('ignores a superseded context response and keeps the latest requested target', async () => {
    const { store, context } = setup()
    const first = deferred<Awaited<ReturnType<typeof context>>>()
    const second = deferred<Awaited<ReturnType<typeof context>>>()
    context.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const old = store.context(1, 2, 20)
    const fresh = store.context(1, 2, 30)
    second.resolve({ messages: [message(30)], target_index: 0, target_message_id: 30 }); await fresh
    first.resolve({ messages: [message(20)], target_index: 0, target_message_id: 20 }); await old
    expect(store.snapshot(2).messages.map((m) => m.id)).toEqual([30])
  })
})


it('batches burst notifications while keeping snapshots immediately current', () => {
  vi.useFakeTimers()
  try {
    const { store } = setup()
    const listener = vi.fn()
    store.subscribe(1, 2, listener)
    for (let id = 1; id <= 100; id++) store.receive(message(id))
    expect(store.snapshot(2).messages.at(-1)?.id).toBe(100)
    expect(listener).not.toHaveBeenCalled()
    vi.advanceTimersByTime(8)
    expect(listener).toHaveBeenCalledTimes(1)
    store.receive(message(101)); store.close()
    vi.advanceTimersByTime(8)
    expect(listener).toHaveBeenCalledTimes(1)
  } finally { vi.useRealTimers() }
})

it('reconciles a previously unseen quote target instead of taking the append shortcut', () => {
  const { store } = setup()
  store.entry(1, 2)
  store.receive({ ...message(10), reply: { message_id: 20, author: { user_id: 1, username: 'old' }, content: 'old', revision: 1, deleted: false } })
  store.receive({ ...message(20, 2, 2), content: 'updated quote target' })
  expect(store.snapshot(2).messages[0]?.reply?.content).toBe('updated quote target')
})


it('serializes same-channel dispatch while accepting the whole burst synchronously', async () => {
  const first = deferred<Message>()
  const second = deferred<Message>()
  const { store, create } = setup()
  create.mockImplementation((_token, _server, channel, content, key) => {
    if (content === 'first') return first.promise
    if (content === 'second') return second.promise
    return Promise.resolve({ ...message(30, channel), client_message_id: key })
  })
  const sendingFirst = store.send(1, 2, 'first', undefined, undefined, undefined, 'first-key')
  const sendingSecond = store.send(1, 2, 'second', undefined, undefined, undefined, 'second-key')
  expect(store.snapshot(2).pending.map((item) => item.content)).toEqual(['first', 'second'])

  await store.send(1, 3, 'independent', undefined, undefined, undefined, 'independent-key')
  expect(create.mock.calls.map((call) => call[3])).toEqual(['first', 'independent'])
  first.resolve({ ...message(10), client_message_id: 'first-key' })
  await sendingFirst
  await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(3))
  expect(create.mock.calls[2]?.[3]).toBe('second')
  second.resolve({ ...message(11), client_message_id: 'second-key' })
  await sendingSecond
  expect(store.snapshot(2).messages.map((item) => item.id)).toEqual([10, 11])
  expect(store.snapshot(2).pending).toEqual([])
})

it('releases a channel queue after failure and deduplicates retries with the original key', async () => {
  const retryResponse = deferred<Message>()
  const { store, create } = setup()
  create.mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce({ ...message(11), client_message_id: 'second-key' })
    .mockReturnValueOnce(retryResponse.promise)
  const sendingFirst = store.send(1, 2, 'first', undefined, undefined, undefined, 'first-key')
  const sendingSecond = store.send(1, 2, 'second', undefined, undefined, undefined, 'second-key')
  await sendingFirst
  await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(2))
  await sendingSecond
  expect(store.snapshot(2).pending[0]).toMatchObject({ id: 'first-key', status: 'failed' })

  const automatic = store.retryFailed()
  await store.send(1, 2, 'ignored while sending', 'first-key')
  const concurrent = store.retryFailed()
  await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(3))
  expect(create.mock.calls[0]?.[4]).toBe('first-key')
  expect(create.mock.calls[2]?.[4]).toBe('first-key')
  retryResponse.resolve({ ...message(12), client_message_id: 'first-key' })
  await Promise.all([automatic, concurrent])
  expect(store.snapshot(2).pending).toEqual([])
})

it('retries a failure produced while a concurrent retry pass is draining', async () => {
  const firstRetry = deferred<Message>(), secondRetry = deferred<Message>()
  const { store, create } = setup()
  create.mockRejectedValueOnce(new Error('offline')).mockRejectedValueOnce(new Error('offline'))
  await store.send(1, 2, 'first')
  await store.send(1, 2, 'second')
  const [firstId, secondId] = store.snapshot(2).pending.map((item) => item.id)
  create.mockReturnValueOnce(firstRetry.promise).mockReturnValueOnce(secondRetry.promise)
    .mockResolvedValueOnce({ ...message(12), client_message_id: firstId })

  const draining = store.retryFailed()
  await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(3))
  const concurrent = store.retryFailed()
  firstRetry.reject(new Error('offline'))
  await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(4))
  secondRetry.resolve({ ...message(11), client_message_id: secondId })
  await draining
  await concurrent

  expect(create).toHaveBeenCalledTimes(5)
  expect(create.mock.calls[4]?.[4]).toBe(firstId)
  expect(store.snapshot(2).pending).toEqual([])
})

it('retries an in-flight send that fails on reconnect even when another channel already has a retry', async () => {
  const inFlight = deferred<Message>(), otherRetry = deferred<Message>()
  const { store, create } = setup()
  create.mockRejectedValueOnce(new Error('offline'))
    .mockReturnValueOnce(inFlight.promise)
    .mockReturnValueOnce(otherRetry.promise)
  await store.send(1, 2, 'already failed')
  const sending = store.send(1, 3, 'still sending')
  const key = store.snapshot(3).pending[0]!.id
  await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(2))

  const reconnect = store.retryFailed()
  try {
    await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(3))
    inFlight.reject(new Error('disconnected'))
    await sending
    await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(4))
    expect(create.mock.calls[3]?.slice(2, 5)).toEqual([3, 'still sending', key])
    expect(store.snapshot(3).pending).toEqual([])
  } finally {
    otherRetry.resolve(message(10))
    await reconnect
  }
})

it('skips a queued request that history sync already acknowledged', async () => {
  const inFlight = deferred<Message>()
  const { store, create, sync } = setup()
  create.mockReturnValueOnce(inFlight.promise)
  const first = store.send(1, 2, 'first')
  const queued = store.send(1, 2, 'already delivered')
  const key = store.snapshot(2).pending[1]!.id
  sync.mockResolvedValueOnce(page([{ ...message(8), client_message_id: key }]))
  await store.sync(1, 2)
  inFlight.resolve(message(9))
  await Promise.all([first, queued])
  expect(store.snapshot(2).pending).toEqual([])
  expect(create).toHaveBeenCalledOnce()
})

it('cancels queued dispatch on close without a late request', async () => {
  vi.useFakeTimers()
  try {
    const first = deferred<Message>()
    const { store, create } = setup()
    create.mockReturnValueOnce(first.promise)
    const sendingFirst = store.send(1, 2, 'first', undefined, undefined, undefined, 'first-key')
    const waitingSecond = store.send(1, 2, 'second', undefined, undefined, undefined, 'second-key')
    await vi.advanceTimersByTimeAsync(0)
    expect(create).toHaveBeenCalledOnce()
    const firstSignal = create.mock.calls[0]?.[5]
    await vi.advanceTimersByTimeAsync(20_000)
    expect(firstSignal?.aborted).toBe(true)
    expect(create).toHaveBeenCalledOnce()

    store.close()
    await waitingSecond
    first.resolve(message(10))
    await sendingFirst
    await vi.advanceTimersByTimeAsync(0)
    expect(create).toHaveBeenCalledOnce()
  } finally { vi.useRealTimers() }
})

describe('persistent optimistic outbox', () => {
  it('restores interrupted sends as failed with metadata and isolates users without persisting credentials', async () => {
    const first = setup(undefined, 'instance-a')
    const request = deferred<Message>()
    first.create.mockReturnValueOnce(request.promise)
    const reply = { message_id: 40, author: { user_id: 2, username: 'Bob' }, content: 'original', revision: 1, deleted: false }
    const sending = first.store.send(1, 2, 'restore me', undefined, reply, undefined, undefined, 40, ['file-id'])
    const id = first.store.snapshot(2).pending[0]!.id
    const raw = localStorage.getItem(storageKey('instance-a'))!
    expect(JSON.parse(raw).version).toBe(1)
    expect(raw).not.toContain('token')
    await vi.waitFor(() => expect(first.create).toHaveBeenCalledOnce())
    first.store.close()

    const restored = setup(undefined, 'instance-a')
    expect(restored.store.snapshot(2).pending).toEqual([{
      id, content: 'restore me', status: 'failed', error: 'Отправка прервана перезапуском', retryable: true,
      attachmentIds: ['file-id'], threadRootId: 40, reply,
    }])
    const otherUser = setup(undefined, 'instance-a', 2)
    const otherInstance = setup(undefined, 'instance-b')
    expect(otherUser.store.snapshot(2).pending).toEqual([])
    expect(otherInstance.store.snapshot(2).pending).toEqual([])
    request.reject(new Error('closed')); await sending
  })

  it('keeps the in-memory failed message when local storage rejects writes', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota exceeded') })
    const { store, create } = setup(undefined, 'instance-a')
    create.mockRejectedValueOnce(new Error('offline'))
    await store.send(1, 2, 'memory only')
    expect(store.snapshot(2).pending[0]).toMatchObject({ content: 'memory only', status: 'failed' })
  })

  it('keeps outbox order stable while a failed message retries', async () => {
    const { store, create } = setup(undefined, 'instance-a')
    create.mockRejectedValueOnce(new Error('offline')).mockRejectedValueOnce(new Error('offline'))
    await store.send(1, 2, 'first')
    await store.send(1, 2, 'second')
    const ids = store.snapshot(2).pending.map((item) => item.id)
    const request = deferred<Message>()
    create.mockReturnValueOnce(request.promise)
    const retry = store.send(1, 2, 'changed input is ignored', ids[0])
    expect(store.snapshot(2).pending.map((item) => item.id)).toEqual(ids)
    expect(store.snapshot(2).pending[0]).toMatchObject({ content: 'first', status: 'sending' })
    request.resolve(message(10)); await retry
    expect(store.snapshot(2).pending.map((item) => item.id)).toEqual([ids[1]])
    expect(create.mock.calls[2]?.[4]).toBe(ids[0])
  })

  it('auto-retries retryable failures with the same key but leaves forbidden sends for manual retry', async () => {
    const { store, create } = setup(undefined, 'instance-a')
    create.mockRejectedValueOnce(new Error('offline'))
    await store.send(1, 2, 'network')
    const retryableId = store.snapshot(2).pending[0]!.id
    await store.retryFailed()
    expect(create.mock.calls[1]?.[4]).toBe(retryableId)
    expect(store.snapshot(2).pending).toEqual([])

    create.mockRejectedValueOnce(Object.assign(new Error('forbidden'), { status: 403 }))
    await store.send(1, 2, 'forbidden')
    expect(store.snapshot(2).pending[0]).toMatchObject({ status: 'failed', retryable: false })
    const calls = create.mock.calls.length
    await store.retryFailed()
    expect(create).toHaveBeenCalledTimes(calls)
    await store.send(1, 2, 'forbidden', store.snapshot(2).pending[0]!.id)
    expect(store.snapshot(2).pending).toEqual([])
  })

  it('persists dismissal, access revocation and channel removal cleanup', async () => {
    const { store, create } = setup(undefined, 'instance-a')
    create.mockRejectedValue(new Error('offline'))
    await store.send(1, 2, 'dismiss')
    await store.send(1, 3, 'revoke')
    await store.send(1, 4, 'remove')
    const saved = () => JSON.parse(localStorage.getItem(storageKey('instance-a'))!).items.map((item: { channelId: number }) => item.channelId)
    expect(saved()).toEqual([2, 3, 4])
    store.dismiss(2, store.snapshot(2).pending[0]!.id)
    expect(saved()).toEqual([3, 4])
    store.retainChannels(1, new Set([4]))
    expect(saved()).toEqual([4])
    store.removeChannel(4)
    expect(localStorage.getItem(storageKey('instance-a'))).toBeNull()
  })

  it('removes a persisted pending message acknowledged by history sync', async () => {
    const request = deferred<Message>()
    const { store, create, sync } = setup(undefined, 'instance-a')
    create.mockReturnValueOnce(request.promise)
    const sending = store.send(1, 2, 'acknowledge')
    const id = store.snapshot(2).pending[0]!.id
    await vi.waitFor(() => expect(create).toHaveBeenCalledOnce())
    sync.mockResolvedValueOnce(page([{ ...message(8), client_message_id: id }]))
    await store.sync(1, 2)
    expect(store.snapshot(2).pending).toEqual([])
    expect(localStorage.getItem(storageKey('instance-a'))).toBeNull()
    request.reject(new Error('reply lost')); await sending
  })

  it('enforces the global bound across channels and rejects future storage versions', async () => {
    const { store, create } = setup(undefined, 'instance-a')
    create.mockRejectedValue(new Error('offline'))
    for (let index = 0; index < 20; index++) await store.send(1, index + 1, `pending ${index}`)
    expect(() => store.send(1, 21, 'overflow')).toThrow('Сначала повторите или удалите')
    expect(JSON.parse(localStorage.getItem(storageKey('instance-a'))!).items).toHaveLength(20)

    localStorage.setItem(storageKey('instance-b'), JSON.stringify({ version: 2, items: [{ serverId: 1, channelId: 2, pending: { id: 'future', content: 'future', status: 'sending' } }] }))
    expect(setup(undefined, 'instance-b').store.snapshot(2).pending).toEqual([])
  })
})
