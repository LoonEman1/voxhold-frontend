import type { VoxholdApi } from './api'
import type { Conversation } from '../domain/community'

// Older servers return only {id}. Load participants before publishing the chat
// to the rail and sidebar; keep the optional history loader in its lazy chunk.
export async function completeConversation(api: VoxholdApi, token: string, created: Conversation): Promise<Conversation> {
  const chat = Array.isArray(created.members) ? created : await api.community.request<Conversation>(token, `/conversations/${created.id}`)
  if (!Array.isArray(chat.members)) throw new Error('Не удалось загрузить участников разговора')
  return chat
}
