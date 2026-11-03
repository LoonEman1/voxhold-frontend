// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { ServerEvent } from '../domain/community'
import { createApi } from '../services/api'
import { EventsView } from './ServerEventsView'

afterEach(cleanup)
const meeting = (): ServerEvent => ({ id: 7, server_id: 1, creator_user_id: 1, title: 'Вечер настолок', description: 'Берите любимые игры', starts_at: Math.floor(Date.now() / 1000) + 86400, timezone: 'Europe/Moscow', cancelled: false, revision: 1, going: 2, maybe: 1, response: '' })
function setup(request: (path: string, method: string, body: unknown) => unknown, admin = true) {
  const api = createApi({ request: async <T,>({ path, method = 'GET', body }: { path: string; method?: string; body?: unknown }) => ({ status: 200, data: await request(path, method, body) as T }) })
  const props = { api, token: 'fixture', userId: 1, serverId: 1, admin, revision: 0 }
  return { ...render(<EventsView {...props}/>), props }
}
it('offers retry after load failure without presenting a false empty state', async () => {
  let failed = true
  setup(() => { if (failed) throw new Error('Нет соединения'); return [] })
  expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось связаться с сервером')
  expect(screen.queryByText('Пока без планов')).toBeNull()
  failed = false
  fireEvent.click(screen.getByRole('button', { name: 'Повторить загрузку' }))
  expect(await screen.findByText('Пока без планов')).toBeTruthy()
})
it('serializes RSVP changes and preserves the selected response from the server', async () => {
  let item = meeting(), finish!: () => void
  const votes = vi.fn()
  setup(async (path, method, body) => {
    if (path.endsWith('/response')) { votes(method, body); await new Promise<void>((done) => { finish = done }); item = { ...item, going: method === 'PUT' ? 3 : 2, response: method === 'PUT' ? 'going' : '' }; return {} }
    return [item]
  })
  const card = within(await screen.findByRole('article', { name: item.title }))
  fireEvent.click(card.getByRole('button', { name: 'Пойду' }))
  fireEvent.click(card.getByRole('button', { name: 'Пойду' }))
  expect(votes).toHaveBeenCalledTimes(1)
  await act(async () => finish())
  await waitFor(() => expect(card.getByRole('button', { name: 'Пойду' })).toHaveAttribute('aria-pressed', 'true'))
  expect(card.getByText('Пойдут: 3')).toBeTruthy()
  fireEvent.click(card.getByRole('button', { name: 'Пойду' }))
  expect(votes).toHaveBeenLastCalledWith('DELETE', undefined)
  await act(async () => finish())
  await waitFor(() => expect(card.getByRole('button', { name: 'Пойду' })).toHaveAttribute('aria-pressed', 'false'))
})
it('does not expose another community list when its stale response finishes', async () => {
  let finish!: (items: ServerEvent[]) => void
  const old = new Promise<ServerEvent[]>((done) => { finish = done })
  const item = meeting()
  const { rerender, props } = setup((path) => path.includes('/servers/1/') ? old : [{ ...item, id: 8, server_id: 2, title: 'Другая встреча' }])
  rerender(<EventsView {...props} serverId={2}/>)
  await screen.findByRole('article', { name: 'Другая встреча' })
  await act(async () => finish([item]))
  expect(screen.queryByRole('article', { name: item.title })).toBeNull()
})
it('keeps the event form after failure and rejects past dates before sending', async () => {
  const save = vi.fn(() => { throw new Error('Попробуйте позже') })
  setup((_path, method) => { if (method === 'POST') return save(); return [] })
  fireEvent.click(screen.getByRole('button', { name: 'Создать событие' }))
  const dialog = within(screen.getByRole('dialog', { name: 'Создать событие' }))
  fireEvent.change(dialog.getByLabelText('Название'), { target: { value: 'Вечер игр' } })
  fireEvent.change(dialog.getByLabelText('Дата и время'), { target: { value: '2020-01-01T12:00' } })
  fireEvent.submit(dialog.getByRole('button', { name: 'Сохранить' }).closest('form')!)
  expect(await dialog.findByRole('alert')).toHaveTextContent('в будущем')
  expect(save).not.toHaveBeenCalled()
  fireEvent.change(dialog.getByLabelText('Дата и время'), { target: { value: '2099-01-01T12:00' } })
  fireEvent.submit(dialog.getByRole('button', { name: 'Сохранить' }).closest('form')!)
  await waitFor(() => expect(dialog.getByRole('alert')).toHaveTextContent('Не удалось связаться с сервером'))
  expect(dialog.getByLabelText('Название')).toHaveValue('Вечер игр')
})
it('requires cancellation confirmation and keeps cancelled meetings in the recent view', async () => {
  let item = meeting()
  const cancel = vi.fn()
  setup((_path, method) => { if (method === 'DELETE') { cancel(); item = { ...item, cancelled: true }; return {} }; return [item] })
  fireEvent.click(await screen.findByRole('button', { name: `Отменить событие: ${item.title}` }))
  expect(cancel).not.toHaveBeenCalled()
  fireEvent.click(within(screen.getByRole('dialog', { name: 'Отменить событие' })).getByRole('button', { name: 'Отменить событие' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  fireEvent.click(screen.getByRole('button', { name: /Недавние/ }))
  const card = within(await screen.findByRole('article', { name: item.title }))
  expect(card.getByText('Отменено')).toBeTruthy()
  expect(card.queryByRole('button', { name: 'Пойду' })).toBeNull()
})
