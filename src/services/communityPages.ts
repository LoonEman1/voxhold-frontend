import type { VoxholdApi } from './api'

export async function communityPages<T extends { id: number }>(api: VoxholdApi, token: string, path: string, field: 'conversations' | 'scheduled_messages', signal?: AbortSignal): Promise<T[]> {
  const values = new Map<number, T>(), cursors = new Set<string>()
  let before = ''
  for (;;) {
    const query = new URLSearchParams({ limit: '100', ...(before ? { before } : {}) })
    const result = await api.community.request<T[] | { conversations?: T[]; scheduled_messages?: T[]; has_more: boolean; next_cursor: string | null }>(token, `${path}${path.includes('?') ? '&' : '?'}${query}`, 'GET', undefined, signal)
    // Older servers retain the array response; new servers provide cursors.
    const page = Array.isArray(result) ? result : result[field]
    if (!Array.isArray(page)) throw new Error('Некорректный ответ списка')
    page.forEach((value) => values.set(value.id, value))
    if (Array.isArray(result) || !result.has_more) return [...values.values()]
    if (!result.next_cursor || cursors.has(result.next_cursor)) throw new Error('Некорректный курсор списка')
    before = result.next_cursor; cursors.add(before)
  }
}
