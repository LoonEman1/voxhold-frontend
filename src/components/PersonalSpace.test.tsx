// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import type { Conversation, CustomRole } from '../domain/community'
import type { Profile, ServerMember } from '../domain/types'
import { createApi } from '../services/api'
import { CommunityContent, CommunityNavigation, CommunityProvider, CommunitySidebar } from './Community'
import { MemberCard } from './MemberCard'

afterEach(cleanup)
const members = [{ user_id: 2, username: 'Лера', role: 'member' }, { user_id: 3, username: 'Миша', role: 'member' }] as ServerMember[]
const chats: Conversation[] = [{ id: 7, direct: true, name: '', unread_count: 2, members: [{ user_id: 2, username: 'Лера' }] }, { id: 8, direct: false, name: 'Выходные', unread_count: 3, members: [{ user_id: 2, username: 'Лера' }, { user_id: 3, username: 'Миша' }] }]
const profile = { user_id: 2, username: 'Лера', about: 'Люблю горы', country_code: 'RU', created_at: 1, last_seen_at: 1 } as Profile
function setup(request?: (path: string, method?: string, body?: unknown) => unknown, children?: ReactNode, owner = true) {
  const api = createApi({ request: async <T,>({ path, method, body }: { path: string; method?: string; body?: unknown }) => {
    const custom = await request?.(path, method, body)
    return { status: 200, data: (custom ?? (path.endsWith('/message-privacy') ? { mode: 'shared', blocked_user_ids: [] } : path.endsWith('/inbox') ? { items: [], has_more: false } : path.endsWith('/conversations') ? chats : path.endsWith('/messages') ? { messages: [], has_more: false } : [])) as T }
  } })
  return render(<CommunityProvider api={api} token="test" userId={1} serverId={1} owner={owner} members={members} onMessage={() => undefined} onNavigate={() => undefined}><CommunityNavigation/><CommunitySidebar><div>Каналы сервера</div></CommunitySidebar><CommunityContent><div>Сообщения канала</div></CommunityContent>{children}</CommunityProvider>)
}
it('separates existing direct dialogs and groups, and opens chat in the workspace without a modal', async () => {
  setup()
  fireEvent.click(screen.getByRole('button', { name: 'Личная панель' }))
  fireEvent.click(screen.getByRole('button', { name: 'Личные сообщения' }))
  const direct = await screen.findByRole('button', { name: /Лера.*Личный диалог/ })
  expect(screen.queryByRole('button', { name: /Выходные.*участников/ })).toBeNull()
  fireEvent.click(direct)
  expect(await screen.findByLabelText('Сообщение в беседу')).toBeTruthy()
  expect(screen.queryByRole('dialog')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Беседы' }))
  expect(await screen.findByRole('button', { name: /Выходные.*участников/ })).toBeTruthy()
  expect(screen.queryByRole('button', { name: /Лера.*Личный диалог/ })).toBeNull()
})
it('does not reopen a direct chat when its request finishes after navigating away', async () => {
  let resolve!: (value: unknown) => void
  const request = new Promise((done) => { resolve = done })
  setup((path, method) => path.endsWith('/conversations') && method === 'POST' ? request : undefined)
  act(() => window.dispatchEvent(new CustomEvent('voxhold:open-direct', { detail: 2 })))
  fireEvent.click(screen.getAllByRole('button', { name: 'Вернуться к каналам' })[0]!)
  await act(async () => resolve(chats[0]))
  expect(screen.queryByLabelText('Сообщение в беседу')).toBeNull()
  expect(screen.getByText('Каналы сервера')).toBeTruthy()
})
it('keeps privacy in its own page and removes an unblocked user immediately', async () => {
  const calls: unknown[] = []
  let blocked = [2]
  setup((path, method, body) => {
    if (path.endsWith('/blocks/2') && method === 'DELETE') { blocked = []; return { ok: true } }
    if (path.endsWith('/message-privacy')) { if (method === 'PUT') calls.push(body); return { mode: 'shared', blocked_user_ids: blocked } }
  })
  fireEvent.click(screen.getByRole('button', { name: 'Личная панель' })); fireEvent.click(screen.getByRole('button', { name: 'Личные настройки' }))
  fireEvent.click(await screen.findByRole('radio', { name: /Никто/ }))
  await waitFor(() => expect(calls).toEqual([{ mode: 'none' }]))
  fireEvent.click(await screen.findByRole('button', { name: 'Разблокировать' }))
  await screen.findByText('Вы никого не заблокировали')
})
it('retains selected recipients and the form when conversation creation fails', async () => {
  setup((path, method) => { if (path.endsWith('/conversations') && method === 'POST') throw new Error('Участник запретил сообщения') })
  fireEvent.click(screen.getByRole('button', { name: 'Личная панель' })); fireEvent.click(screen.getByRole('button', { name: 'Личные сообщения' }))
  fireEvent.click(screen.getByRole('button', { name: 'Новый диалог' }))
  fireEvent.click(screen.getByRole('radio', { name: 'Лера' }))
  fireEvent.click(screen.getByRole('button', { name: 'Открыть диалог' }))
  await screen.findByRole('alert')
  expect((screen.getByRole('radio', { name: 'Лера' }) as HTMLInputElement).checked).toBe(true)
  expect(screen.getByRole('button', { name: 'Открыть диалог' })).toBeTruthy()
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
