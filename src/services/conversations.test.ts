import { expect, it, vi } from 'vitest'
import { conversationWindow, listConversations } from './conversations'
import type { VoxholdApi } from './api'
import type { Conversation, DirectMessage } from '../domain/community'

const message = (id: number): DirectMessage => ({ id, conversation_id: 7, author: { user_id: 2, username: 'member' }, content: `message-${id}`, created_at: 1, client_message_id: String(id) })
it('backfills every missed page and reconciles deleted/changed messages in the loaded window', async () => {
  const values = Array.from({ length: 150 }, (_, n) => message(n + 1)).filter((m) => m.id !== 2)
  values[0] = { ...values[0]!, content: 'updated note', note: 'changed in another tab' }
  const request = vi.fn(async (_token: string, path: string) => {
    const before = Number(new URL(path, 'https://test').searchParams.get('before') ?? Infinity)
    const items = values.filter((m) => m.id < before).sort((a,b) => b.id-a.id)
    return { messages: items.slice(0,50), has_more: items.length > 50 }
  })
  const api = { community: { request } } as unknown as VoxholdApi
  const result = await conversationWindow(api, 'token', 7, 1, '', new AbortController().signal)
  expect(result.messages).toHaveLength(149)
  expect(result.messages.some((m) => m.id === 51)).toBe(true)
  expect(result.messages.some((m) => m.id === 2)).toBe(false)
  expect(result.messages[0]?.note).toBe('changed in another tab')
  expect(result.has_more).toBe(false)
  expect(request).toHaveBeenCalledTimes(3)
})
it('loads conversations beyond the first 200 and deduplicates moving activity', async () => {
  const first = Array.from({ length: 200 }, (_, n): Conversation => ({ id: 205-n, last_message_id: 0, direct: false, name: 'Group', members: [], unread_count: 0 }))
  const last = Array.from({ length: 5 }, (_, n) => ({ ...first[0]!, id: 5-n }))
  const request = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(last)
  const values = await listConversations({ community: { request } } as unknown as VoxholdApi, 'token')
  expect(values).toHaveLength(205)
  expect(request.mock.calls[1]?.[1]).toBe('/me/conversations?before_activity=0&before_id=6')
})
