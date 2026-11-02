// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Profiler } from 'react'
import { createApi } from '../services/api'
import { WorkspacePage } from './WorkspacePage'

const fixture = vi.hoisted(() => ({
  unreadCount: 0,
  callbacks: {} as Record<string, (...args: never[]) => unknown>,
  auth: { user: { id: 1, username: 'reader', created_at: 1 }, token: 'fixture' },
  // Stable like the real hooks: a new function per render would re-run the page's loading effects.
  expire: vi.fn(), notify: vi.fn(),
}))
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ ...fixture.auth, expire: fixture.expire }) }))
vi.mock('../components/Toast', () => ({ useToast: () => fixture.notify }))
vi.mock('../theme/ThemeContext', () => ({ useTheme: () => ({ theme: 'dark', toggleTheme: vi.fn() }) }))
vi.mock('../components/PersistentStreamPlayer', () => ({ PersistentStreamPlayer: () => null }))
vi.mock('../services/realtime', () => ({ RealtimeClient: class {
  constructor(options: typeof fixture.callbacks) { fixture.callbacks = options }
  connect() { (fixture.callbacks.onStateChange as unknown as (state: string) => void)('online') }
  close() {} subscribe() {} unsubscribe() {}
} }))

const api = createApi({ request: async <T,>(request: { path: string }) => {
  let data: unknown = {}
  if (request.path.endsWith('/me/servers')) data = [{ id: 1, name: 'Fixture', role: 'member', created_by: 2, created_at: 1, joined_at: 1 }]
  else if (request.path.endsWith('/channels')) data = [
    { id: 1, server_id: 1, name: 'general', kind: 'text', position: 0, created_by: 2, created_at: 1 },
    { id: 2, server_id: 1, name: 'random', kind: 'text', position: 1, created_by: 2, created_at: 1 },
  ]
  else if (request.path.endsWith('/notification-counts') || request.path.endsWith('/unread-counts')) data = fixture.unreadCount ? [{ channel_id: 2, unread_count: fixture.unreadCount }] : []
  else if (request.path.endsWith('/members')) data = []
  else if (request.path.includes('/messages/sync')) data = { messages: [], deleted_ids: [], cursor: 0, reset: false, has_more: false, has_older: false }
  else if (request.path.includes('/messages')) data = { messages: [], pagination: { next_before_id: null, has_more: false } }
  else if (request.path.endsWith('/pins') || request.path.endsWith('/reads')) data = []
  else if (request.path.endsWith('/recordings')) data = { recordings: [] }
  return { status: 200, data: data as T }
} })

function emit(name: string, data: unknown) {
  (fixture.callbacks[name] as unknown as (data: unknown) => void)(data)
}

beforeEach(() => {
  fixture.unreadCount = 0
  localStorage.clear()
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('updates the tab notification count for activity in an unsubscribed channel', async () => {
  render(<WorkspacePage api={api}/>)
  await screen.findByRole('button', { name: 'random' })
  fixture.unreadCount = 5
  act(() => emit('onChannelActivity', { server_id: 1, channel_id: 2, message_id: 50, author_user_id: 2 }))
  await waitFor(() => expect(document.title).toBe('(5) Voxhold'), { timeout: 2_000 })
})

it('shows a plain unread indicator before notification counts arrive', async () => {
  render(<WorkspacePage api={api}/>)
  await screen.findByRole('button', { name: 'random' })
  act(() => emit('onChannelActivity', { server_id: 1, channel_id: 2, message_id: 50, author_user_id: 2 }))
  await waitFor(() => expect(document.title).toBe('• Voxhold'))
})

it('commits one Workspace update for a burst of 200 activity events', async () => {
  const commits = vi.fn()
  render(<Profiler id="workspace" onRender={commits}><WorkspacePage api={api}/></Profiler>)
  await screen.findByRole('button', { name: 'random' })
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 120)) })
  const before = commits.mock.calls.length
  for (let messageId = 1; messageId <= 200; messageId++) {
    act(() => emit('onChannelActivity', { server_id: 1, channel_id: 2, message_id: messageId, author_user_id: 2 }))
  }
  expect(commits).toHaveBeenCalledTimes(before)
  await screen.findByRole('button', { name: 'random, есть непрочитанные сообщения' })
  expect(commits).toHaveBeenCalledTimes(before + 1)
})

it('highlights a channel with messages after the last read one and clears it for your own message', async () => {
  render(<WorkspacePage api={api}/>)
  const random = await screen.findByRole('button', { name: 'random' })
  expect(random.closest('.channel-row')).not.toHaveClass('is-unread')

  act(() => emit('onChannelActivity', { server_id: 1, channel_id: 2, message_id: 6, author_user_id: 2 }))
  const unread = await screen.findByRole('button', { name: 'random, есть непрочитанные сообщения' })
  expect(unread.closest('.channel-row')).toHaveClass('is-unread')

  // Another server's activity is ignored; your own message marks the channel read.
  act(() => emit('onChannelActivity', { server_id: 9, channel_id: 2, message_id: 8, author_user_id: 2 }))
  act(() => emit('onChannelActivity', { server_id: 1, channel_id: 2, message_id: 7, author_user_id: 1 }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'random' }).closest('.channel-row')).not.toHaveClass('is-unread'))
})
