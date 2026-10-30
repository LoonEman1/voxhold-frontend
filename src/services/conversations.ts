import type { VoxholdApi } from './api'
import type { Conversation, DirectMessage } from '../domain/community'

export async function listConversations(api: VoxholdApi, token: string, signal?: AbortSignal): Promise<Conversation[]> {
  const values = new Map<number, Conversation>()
  let suffix = ''
  const cursors = new Set<string>()
  for (;;) {
    const page = await api.community.request<Conversation[]>(token, `/me/conversations${suffix}`, 'GET', undefined, signal)
    if (!Array.isArray(page)) throw new Error('Не удалось загрузить разговоры')
    for (const chat of page) values.set(chat.id, chat)
    const last = page.at(-1)
    if (page.length < 200 || !last) return [...values.values()]
    if (last.last_message_id === undefined) throw new Error('Обновите сервер для загрузки остальных разговоров')
    suffix = `?before_activity=${last.last_message_id}&before_id=${last.id}`
    if (cursors.has(suffix)) throw new Error('Не удалось продолжить загрузку разговоров')
    cursors.add(suffix)
  }
}

export interface DirectPage { messages: DirectMessage[]; has_more: boolean }

// Reconcile the loaded window, including messages missed while disconnected,
// edits/reactions and deletions in another tab. Commit only a complete window.
export async function conversationWindow(api: VoxholdApi, token: string, id: number, oldest: number | undefined, query: string, signal: AbortSignal): Promise<DirectPage> {
  const messages = new Map<number, DirectMessage>()
  let before: number | undefined
  for (;;) {
    const params = new URLSearchParams()
    if (query) params.set('q', query)
    if (before !== undefined) params.set('before', String(before))
    const suffix = params.size ? `?${params}` : ''
    const page = await api.community.request<DirectPage>(token, `/conversations/${id}/messages${suffix}`, 'GET', undefined, signal)
    for (const message of page.messages) messages.set(message.id, message)
    const minimum = page.messages.reduce((min, m) => Math.min(min, m.id), Infinity)
    if (!page.has_more || !page.messages.length || oldest === undefined || minimum <= oldest) {
      return { messages: [...messages.values()].sort((a,b) => a.id-b.id), has_more: page.has_more }
    }
    if (before !== undefined && minimum >= before) throw new Error('Не удалось продолжить загрузку истории')
    before = minimum
  }
}
