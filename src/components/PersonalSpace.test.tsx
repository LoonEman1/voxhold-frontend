// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import type { Conversation, CustomRole } from '../domain/community'
import type { Profile, ServerMember } from '../domain/types'
import { createApi } from '../services/api'
import { CommunityContent, CommunityNavigation, CommunityProvider, CommunitySidebar, PrivacySettings } from './Community'
import { MemberCard } from './MemberCard'

afterEach(cleanup)
const members = [{ user_id: 2, username: 'Лера', role: 'member' }, { user_id: 3, username: 'Миша', role: 'member' }] as ServerMember[]
const chats: Conversation[] = [{ id: 7, direct: true, name: '', unread_count: 2, members: [{ user_id: 2, username: 'Лера' }] }, { id: 8, direct: false, name: 'Выходные', unread_count: 3, members: [{ user_id: 2, username: 'Лера' }, { user_id: 3, username: 'Миша' }] }]
const profile = { user_id: 2, username: 'Лера', about: 'Люблю горы', country_code: 'RU', created_at: 1, last_seen_at: 1 } as Profile
function setup(request?: (path: string, method?: string, body?: unknown) => unknown, children?: ReactNode, owner = true) {
  const api = createApi({ request: async <T,>({ path, method, body }: { path: string; method?: string; body?: unknown }) => {
    const custom = await request?.(path, method, body)
    return { status: 200, data: (custom ?? (path.endsWith('/message-privacy') ? { mode: 'shared', blocked_user_ids: [] } : path.endsWith('/inbox') ? { items: [], has_more: false } : path.split('?')[0]!.endsWith('/conversations') ? chats : /\/conversations\/\d+$/.test(path) ? chats.find((chat) => chat.id === Number(path.split('/').at(-1))) : path.endsWith('/messages') ? { messages: [], has_more: false } : [])) as T }
  } })
  return render(<CommunityProvider api={api} token="test" userId={1} serverId={1} owner={owner} members={members} onMessage={() => undefined} onNavigate={() => undefined}><CommunityNavigation/><CommunitySidebar><div>Каналы сервера</div></CommunitySidebar><CommunityContent><div>Сообщения канала</div></CommunityContent>{children}</CommunityProvider>)
}
it('lists direct dialogs and groups together without separate navigation sections', async () => {
  setup()
  fireEvent.click(await screen.findByRole('button', { name: 'Диалог: Лера' }))
  const direct = await screen.findByRole('button', { name: /Лера.*Личный диалог/ })
  expect(screen.getByRole('button', { name: /Выходные.*участников/ })).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Беседы' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Диалоги' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Отложенные' })).toBeNull()
  fireEvent.click(direct)
  expect(await screen.findByLabelText('Сообщение в беседу')).toBeTruthy()
  expect(screen.queryByRole('dialog')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: /Выходные.*участников/ }))
  expect(await screen.findByRole('heading', { name: 'Выходные' })).toBeTruthy()
})
it('does not reopen a direct chat when its request finishes after navigating away', async () => {
  let resolve!: (value: unknown) => void
  const request = new Promise((done) => { resolve = done })
  setup((path, method) => path.split('?')[0]!.endsWith('/conversations') && method === 'POST' ? request : undefined)
  act(() => window.dispatchEvent(new CustomEvent('voxhold:open-direct', { detail: 2 })))
  fireEvent.click(screen.getAllByRole('button', { name: 'Вернуться к каналам' })[0]!)
  await act(async () => resolve(chats[0]))
  expect(screen.queryByLabelText('Сообщение в беседу')).toBeNull()
  expect(screen.getByText('Каналы сервера')).toBeTruthy()
})

it('opens a direct chat from a profile when creation returns only its ID', async () => {
  setup((path, method) => {
    if (path.endsWith('/me/conversations') && method === 'POST') return { id: 7 }
    if (path.endsWith('/conversations/7')) return chats[0]
  })
  act(() => window.dispatchEvent(new CustomEvent('voxhold:open-direct', { detail: 2 })))
  expect(await screen.findByLabelText('Сообщение в беседу')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Диалог: Лера' })).toBeTruthy()
})
it('keeps privacy in its own page and removes an unblocked user immediately', async () => {
  const calls: unknown[] = []
  let blocked = [2]
  setup((path, method, body) => {
    if (path.endsWith('/blocks/2') && method === 'DELETE') { blocked = []; return { ok: true } }
    if (path.endsWith('/message-privacy')) { if (method === 'PUT') calls.push(body); return { mode: 'shared', blocked_user_ids: blocked } }
  })
  fireEvent.click(screen.getByRole('button', { name: 'Личные настройки' }))
  fireEvent.click(await screen.findByRole('radio', { name: /Никто/ }))
  await waitFor(() => expect(calls).toEqual([{ mode: 'none' }]))
  fireEvent.click(await screen.findByRole('button', { name: 'Разблокировать' }))
  await screen.findByText('Вы никого не заблокировали')
})

it('shows privacy-save errors in settings without mixing in conversation-list failures', async () => {
  setup((path, method) => {
    if (path.split('?')[0]!.endsWith('/conversations')) return {}
    if (path.endsWith('/message-privacy') && method === 'PUT') throw new Error('Не удалось сохранить приватность')
  }, <PrivacySettings embedded/>)
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
  expect(screen.queryByRole('alert')).toBeNull()
  fireEvent.click(screen.getByRole('radio', { name: /Никто/ }))
  expect((await screen.findByRole('alert')).textContent).toBe('Не удалось связаться с сервером')
  expect(screen.queryByText('Некорректный ответ списка')).toBeNull()
})
it('retains selected recipients and the form when conversation creation fails', async () => {
  setup((path, method) => { if (path.split('?')[0]!.endsWith('/conversations') && method === 'POST') throw new Error('Участник запретил сообщения') })
  fireEvent.click(screen.getByRole('button', { name: 'Новый разговор' }))
  fireEvent.click(await screen.findByRole('checkbox', { name: 'Лера' }))
  fireEvent.click(screen.getByRole('button', { name: 'Начать диалог' }))
  await screen.findByRole('alert')
  expect((screen.getByRole('checkbox', { name: 'Лера' }) as HTMLInputElement).checked).toBe(true)
  expect(screen.getByRole('button', { name: 'Начать диалог' })).toBeTruthy()
})
it('preserves other assigned roles when adding a role from the member card', async () => {
  const roles: CustomRole[] = [{ id: 1, name: 'Друзья', color: '#e7ff5b', permissions: 15, user_ids: [2] }, { id: 2, name: 'Редакция', color: '#a993ff', permissions: 31, user_ids: [] }]
  const assigned = vi.fn()
  setup((path, method, body) => { if (path.endsWith('/members/2/roles') && method === 'PUT') { assigned(body); return { ok: true } }; if (path.endsWith('/roles')) return roles }, <MemberCard profile={profile} role="member" online loading={false} error="" anchor={{ x: 800, y: 200 }} onClose={() => undefined} onOpenProfile={() => undefined} onMessage={() => undefined}/>)
  fireEvent.click(await screen.findByRole('button', { name: 'Добавить роль' }))
  fireEvent.click(await screen.findByRole('checkbox', { name: 'Назначить роль Редакция' }))
  await waitFor(() => expect(assigned).toHaveBeenCalledWith({ role_ids: [1, 2] }))
})
it('does not offer role assignment to non-owners, and opens the full profile from the avatar', async () => {
  const open = vi.fn()
  setup(undefined, <MemberCard profile={profile} role="member" online loading={false} error="" anchor={{ x: 800, y: 200 }} onClose={() => undefined} onOpenProfile={open} onMessage={() => undefined}/>, false)
  expect(screen.queryByRole('button', { name: 'Добавить роль' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Открыть профиль Лера' }))
  expect(open).toHaveBeenCalledOnce()
})
it('keeps a created role available when assigning it fails, so retry does not create duplicates', async () => {
  const values: CustomRole[] = [], create = vi.fn()
  setup((path, method, body) => {
    if (path.endsWith('/members/2/roles') && method === 'PUT') throw new Error('Соединение прервано')
    if (path.endsWith('/roles')) {
      if (method === 'POST') { create(); const value = { ...body as CustomRole, id: 10, user_ids: [] }; values.push(value); return value }
      return [...values]
    }
  }, <MemberCard profile={profile} role="member" online loading={false} error="" anchor={{ x: 800, y: 200 }} onClose={() => undefined} onOpenProfile={() => undefined} onMessage={() => undefined}/>)
  fireEvent.click(screen.getByRole('button', { name: 'Добавить роль' }))
  fireEvent.click(screen.getByRole('button', { name: 'Создать новую роль' }))
  fireEvent.change(screen.getByLabelText('Название роли'), { target: { value: 'Друзья' } })
  fireEvent.click(screen.getByRole('button', { name: 'Создать и назначить' }))
  await screen.findByText('Не удалось связаться с сервером')
  expect(screen.getByRole('checkbox', { name: 'Назначить роль Друзья' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Создать и назначить' })).toBeNull()
  expect(create).toHaveBeenCalledOnce()
})

it('does not resurrect exhausted older-history pagination on a background refresh', async () => {
  const message = (id: number) => ({ id, conversation_id: 7, author: { user_id: 2, username: 'Лера' }, content: `message-${id}`, created_at: id, client_message_id: String(id) })
  let latestLoads = 0
  setup((path, method) => {
    if (path.split('?')[0]!.endsWith('/conversations') && method === 'POST') return { id: 7 }
    if (path.includes('/messages?before=')) return { messages: [message(1)], has_more: false }
    if (path.endsWith('/messages')) { latestLoads++; return { messages: [message(2), message(3)], has_more: true } }
  })
  act(() => window.dispatchEvent(new CustomEvent('voxhold:open-direct', { detail: 2 })))
  fireEvent.click(await screen.findByRole('button', { name: 'Раньше' }))
  await screen.findByText('message-1')
  expect(screen.queryByRole('button', { name: 'Раньше' })).toBeNull()
  act(() => window.dispatchEvent(new Event('focus')))
  await waitFor(() => expect(latestLoads).toBeGreaterThan(1))
  expect(screen.queryByRole('button', { name: 'Раньше' })).toBeNull()
})

it('serializes notification changes and ignores an older notification response', async () => {
  let read!: (value: unknown) => void, write!: (value: unknown) => void
  let reads = 0, writes = 0
  setup((path, method) => {
    if (path.endsWith('/notifications')) {
      if (method === 'PUT') { writes++; return new Promise((resolve) => { write = resolve }) }
      if (++reads === 1) return new Promise((resolve) => { read = resolve })
      return { muted: true }
    }
  })
  fireEvent.click(await screen.findByRole('button', { name: 'Диалог: Лера' }))
  await waitFor(() => expect(read).toBeTypeOf('function'))
  const toggle = await screen.findByRole('button', { name: 'Отключить уведомления' })
  act(() => { fireEvent.click(toggle); fireEvent.click(toggle) })
  expect(writes).toBe(1)
  await act(async () => { write({ muted: true }) })
  await act(async () => { read({ muted: false }) })
  expect(screen.getByRole('button', { name: 'Включить уведомления' }).getAttribute('aria-pressed')).toBe('true')
})

it('does not send a message twice when submit happens twice before the response', async () => {
  let finish!: (value: unknown) => void, sends = 0
  setup((path, method) => {
    if (path.endsWith('/messages') && method === 'POST') { sends++; return new Promise((resolve) => { finish = resolve }) }
  })
  fireEvent.click(await screen.findByRole('button', { name: 'Диалог: Лера' }))
  const input = await screen.findByLabelText('Сообщение в беседу')
  fireEvent.change(input, { target: { value: 'Один раз' } })
  act(() => { fireEvent.submit(input.closest('form')!); fireEvent.submit(input.closest('form')!) })
  await waitFor(() => expect(sends).toBe(1))
  await act(async () => finish({ id: 10, conversation_id: 7, content: 'Один раз', client_message_id: 'key', created_at: 1, author: { user_id: 1, username: 'Я' } }))
  expect(screen.getAllByText('Один раз')).toHaveLength(1)
})

it('puts blocking in the named message menu instead of beside every message', async () => {
  const block = vi.fn()
  setup((path, method) => {
    if (path.endsWith('/blocks/2') && method === 'PUT') { block(); return { ok: true } }
    if (path.endsWith('/messages')) return { messages: [{ id: 1, conversation_id: 7, content: 'Привет', created_at: 1, author: { user_id: 2, username: 'Лера' } }], has_more: false }
  })
  fireEvent.click(await screen.findByRole('button', { name: 'Диалог: Лера' }))
  const actions = await screen.findByRole('button', { name: 'Действия с сообщением' })
  expect(screen.queryByRole('button', { name: 'Заблокировать Лера' })).toBeNull()
  fireEvent.click(actions)
  fireEvent.click(screen.getByRole('menuitem', { name: 'Заблокировать Лера' }))
  await waitFor(() => expect(block).toHaveBeenCalledOnce())
})

it('coalesces quick typing in favorites into a single search request', async () => {
  const queries: string[] = []
  setup((path) => {
    if (path.endsWith('/me/favorites')) return { id: 9, saved: true, direct: false, name: 'Избранное', members: [], unread_count: 0 }
    if (path.includes('/messages?q=')) { queries.push(new URLSearchParams(path.split('?')[1]).get('q')!); return { messages: [], has_more: false } }
  })
  fireEvent.click(screen.getByRole('button', { name: 'Избранное' }))
  const input = await screen.findByLabelText('Поиск в избранном')
  act(() => {
    fireEvent.change(input, { target: { value: 'п' } })
    fireEvent.change(input, { target: { value: 'пла' } })
    fireEvent.change(input, { target: { value: 'планы' } })
  })
  await waitFor(() => expect(queries).toEqual(['планы']))
  await screen.findByText('Ничего не найдено')
})

it('keeps an older page when a background refresh finishes out of order', async () => {
  const message = (id: number) => ({ id, conversation_id: 7, author: { user_id: 2, username: 'Лера' }, content: `history-${id}`, created_at: id, client_message_id: String(id) })
  let older!: (value: unknown) => void, refresh!: (value: unknown) => void, loads = 0
  setup((path) => {
    if (path.includes('/messages?before=')) return new Promise((resolve) => { older = resolve })
    if (path.endsWith('/messages')) {
      if (++loads === 1) return { messages: [message(2), message(3)], has_more: true }
      return new Promise((resolve) => { refresh = resolve })
    }
  })
  fireEvent.click(await screen.findByRole('button', { name: 'Диалог: Лера' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Раньше' }))
  act(() => window.dispatchEvent(new CustomEvent('voxhold:community', { detail: { type: 'conversation.changed' } })))
  await waitFor(() => expect(refresh).toBeTypeOf('function'), { timeout: 2000 })
  await act(async () => older({ messages: [message(1)], has_more: false }))
  expect(screen.getByText('history-1')).toBeTruthy()
  await act(async () => refresh({ messages: [message(2), message(3)], has_more: true }))
  expect(screen.getByText('history-1')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Раньше' })).toBeNull()
})
