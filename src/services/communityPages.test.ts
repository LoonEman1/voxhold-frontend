import { expect, it, vi } from 'vitest'
import type { VoxholdApi } from './api'
import { communityPages } from './communityPages'

it('loads every cursor page without silently truncating older conversations', async () => {
  const request = vi.fn().mockResolvedValueOnce({ conversations: [{ id: 3 }, { id: 2 }], has_more: true, next_cursor: 'older' }).mockResolvedValueOnce({ conversations: [{ id: 1 }], has_more: false, next_cursor: null })
  const api = { community: { request } } as unknown as VoxholdApi
  expect(await communityPages(api, 'token', '/me/conversations', 'conversations')).toEqual([{ id: 3 }, { id: 2 }, { id: 1 }])
  expect(request.mock.calls[1]![1]).toBe('/me/conversations?limit=100&before=older')
})
it('rejects a repeated cursor instead of fetching forever', async () => {
  const api = { community: { request: vi.fn().mockResolvedValue({ scheduled_messages: [], has_more: true, next_cursor: 'same' }) } } as unknown as VoxholdApi
  await expect(communityPages(api, 'token', '/me/scheduled-messages', 'scheduled_messages')).rejects.toThrow('Некорректный курсор')
})
