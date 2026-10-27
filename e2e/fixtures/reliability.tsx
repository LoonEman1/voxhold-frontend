import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AuthProvider } from '../../src/auth/AuthContext'
import { WorkspacePage } from '../../src/pages/WorkspacePage'
import { ThemeProvider } from '../../src/theme/ThemeContext'
import { ToastProvider } from '../../src/components/Toast'
import { createApi } from '../../src/services/api'
import type { SessionStorageAdapter, TransportRequest } from '../../src/platform/transport'
import type { Message } from '../../src/domain/types'
import '../../src/styles/global.css'
import '../../src/styles/workspace.css'

const makeMessage = (id: number, channelId: number): Message => ({ id, channel_id: channelId, content: `История ${id}`, revision: 1, author: { user_id: 1, username: 'Alice' }, created_at: 1_700_000_000 + id, edited_at: null })
const histories = new Map([1, 2].map((channel) => [channel, Array.from({ length: 500 }, (_, index) => makeMessage(index + 1 + (channel - 1) * 1000, channel))]))
const keys = new Map<string, Message>()
const changed = new Map<number, number[]>()
let cursor = 0, loseFirstReply = true
const requests: string[] = []
const sockets: { current?: FixtureSocket } = {}
class FixtureSocket extends EventTarget {
  static OPEN = 1
  readyState = 1
  constructor() { super(); sockets.current = this; queueMicrotask(() => this.dispatchEvent(new Event('open'))) }
  emit(type: string, data?: unknown) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ type, data }) })) }
  send(raw: string) {
    const event = JSON.parse(raw)
    if (event.type === 'auth') queueMicrotask(() => this.emit('ready', { user_id: 1, protocol_version: 6 }))
    if (event.type === 'channel.subscribe') queueMicrotask(() => this.emit('channel.subscribed', event.data))
    if (event.type === 'channel.unsubscribe') queueMicrotask(() => this.emit('channel.unsubscribed', event.data))
  }
  close() { this.readyState = 3; this.dispatchEvent(new CloseEvent('close', { code: 1000 })) }
}
Object.defineProperty(window, 'WebSocket', { value: FixtureSocket })

async function respond(request: TransportRequest): Promise<unknown> {
  requests.push(`${request.method ?? 'GET'} ${request.path}`)
  const path = new URL(request.path, location.origin)
  if (path.pathname === '/api/v1/me/servers') return [{ id: 1, name: 'Fixture', role: 'owner', created_by: 1, created_at: 1, joined_at: 1 }]
  if (path.pathname === '/api/v1/me/profile') return { user_id: 1, username: 'Alice', about: '', country_code: null, created_at: 1, last_seen_at: null, updated_at: null }
  if (path.pathname === '/api/v1/instance') return { instance_id: 'fixture', name: 'Fixture', initialized: true, protocol_version: 1, registration: 'invite_only', created_at: 1 }
  if (/\/channels\/\d+\/members$/.test(path.pathname)) return { user_ids: Array.from({ length: 2500 }, (_, i) => i + 1) }
  if (path.pathname.endsWith('/members')) return Array.from({ length: 2500 }, (_, index) => ({ user_id: index + 1, username: index ? `Участник ${index + 1}` : 'Alice', role: index ? 'member' : 'owner', joined_at: 1, created_at: 1, about: '', country_code: null, last_seen_at: null }))
  if (path.pathname === '/api/v1/servers/1/channels') return [1, 2].map((id) => ({ id, server_id: 1, name: `канал-${id}`, kind: 'text', position: id, created_by: 1, created_at: 1, last_message_id: histories.get(id)!.at(-1)!.id }))
  if (path.pathname.endsWith('/recordings')) return { recordings: [] }
  if (path.pathname.endsWith('/pins')) return []
  if (path.pathname.endsWith('/read')) return { server_id: 1, channel_id: Number(path.pathname.split('/')[6]), user_id: 1, last_read_message_id: (request.body as { last_read_message_id: number }).last_read_message_id, updated_at: 1 }
  const channelId = Number(path.pathname.match(/\/channels\/(\d+)/)?.[1])
  const messages = histories.get(channelId)
  if (messages && path.pathname.endsWith('/messages/sync')) {
    const after = path.searchParams.get('after')
    if (after !== null) await new Promise((resolve) => setTimeout(resolve, 500))
    const ids = after === null ? [] : [...changed.entries()].filter(([sequence]) => sequence > Number(after)).flatMap(([, ids]) => ids)
    const latest = after === null ? messages.slice(-50) : messages.filter((item) => ids.includes(item.id))
    return { messages: latest, deleted_ids: ids.filter((id) => !messages.some((item) => item.id === id)), cursor, reset: after === null, has_more: false, has_older: after === null && messages.length > 50 }
  }
  if (messages && path.pathname.endsWith('/messages') && request.method === 'POST') {
    const body = request.body as { content: string; client_message_id: string }
    const old = keys.get(body.client_message_id)
    if (old) return old
    const message = { ...makeMessage(messages.at(-1)!.id + 1, channelId), content: body.content, client_message_id: body.client_message_id }
    messages.push(message); keys.set(body.client_message_id, message); changed.set(++cursor, [message.id])
    if (loseFirstReply) { loseFirstReply = false; throw new Error('Сервер сохранил сообщение, но ответ потерян') }
    return message
  }
  if (messages && path.pathname.endsWith('/messages')) {
    const before = Number(path.searchParams.get('before_id') ?? Infinity)
    const values = messages.filter((item) => item.id < before)
    return { messages: values.slice(-50), pagination: { has_more: values.length > 50, next_before_id: values.length > 50 ? values.at(-50)!.id : null } }
  }
  throw new Error(`Fixture route missing: ${request.path}`)
}
const api = createApi({ request: async <T,>(request: TransportRequest) => ({ status: 200, data: await respond(request) as T }) })
const storage: SessionStorageAdapter = { read: <T,>() => ({ user: { id: 1, username: 'Alice', created_at: 1 }, session: { token: 'fixture', expires_at: Math.floor(Date.now() / 1000) + 86400 } }) as T, write: () => {}, remove: () => {} }
Object.assign(window, { reliabilityFixture: {
  requests,
  mutateOffline: () => {
    const messages = histories.get(1)!
    const target = messages.find((item) => item.id === 490)!
    target.content = 'Правка во время обрыва'; target.revision = 2
    histories.set(1, messages.filter((item) => item.id !== 491)); changed.set(++cursor, [490, 491])
  },
  resync: () => sockets.current?.emit('channel.sync_required', { server_id: 1, channel_id: 1 }),
  sentCount: () => keys.size,
} })
createRoot(document.getElementById('root')!).render(<StrictMode><AuthProvider api={api} storage={storage}><ThemeProvider><ToastProvider><WorkspacePage api={api}/></ToastProvider></ThemeProvider></AuthProvider></StrictMode>)
