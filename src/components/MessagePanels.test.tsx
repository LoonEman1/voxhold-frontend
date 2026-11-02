// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { MessageSearchPanel, PinnedMessagesPanel } from './MessagePanels'
import type { VoxholdApi } from '../services/api'
import type { PinnedMessage, SearchMessage } from '../domain/types'

afterEach(() => { cleanup(); vi.useRealTimers() })
const message = (id: number, content: string): SearchMessage => ({ id, channel_id: 1, channel_name: 'общий', content, created_at: 1, edited_at: null, author: { user_id: 1, username: 'Alice' } })
const page = (messages: SearchMessage[], more = false) => ({ messages, pagination: { has_more: more, next_before_id: more ? 10 : null } })
function setup(search: ReturnType<typeof vi.fn>) {
  vi.useFakeTimers()
  const props = { open: true, api: { messages: { search } } as unknown as VoxholdApi, token: 'token', serverId: 1, onClose: vi.fn(), onOpenMessage: vi.fn() }
  const view = render(<MessageSearchPanel {...props}/> )
  return { ...view, props }
}

it('serializes unpin actions and retains the list for retry after a failed removal', async () => {
  let fail!: (error: Error) => void
  const unpin = vi.fn(() => new Promise<void>((_resolve, reject) => { fail = reject }))
  const pins = [1, 2].map((id) => ({ message: message(id, `Pinned ${id}`), pinned_by: { user_id: 1, username: 'Alice' }, pinned_at: 1 })) as unknown as PinnedMessage[]
  render(<PinnedMessagesPanel open pins={pins} loading={false} canManage onClose={vi.fn()} onOpenMessage={vi.fn()} onUnpin={unpin}/>)
  const buttons = screen.getAllByRole('button', { name: 'Открепить сообщение от Alice' })
  fireEvent.click(buttons[0]!)
  fireEvent.click(buttons[1]!)
  expect(unpin).toHaveBeenCalledOnce()
  expect((buttons[1] as HTMLButtonElement).disabled).toBe(true)
  await act(async () => fail(new Error('Try again')))
  expect(screen.getByRole('alert').textContent).toBe('Try again')
  expect(screen.getByText('Pinned 1')).toBeTruthy()
  expect((buttons[0] as HTMLButtonElement).disabled).toBe(false)
})

it('clearing an in-flight search ends loading and ignores its late results', async () => {
  let finish!: (value: unknown) => void
  const search = vi.fn(() => new Promise((resolve) => { finish = resolve }))
  setup(search)
  fireEvent.change(screen.getByRole('textbox', { name: 'Поиск сообщений' }), { target: { value: 'планы' } })
  await act(async () => vi.advanceTimersByTime(300))
  expect(screen.getByText('Ищем сообщения…')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Очистить поиск' }))
  expect(screen.queryByText('Ищем сообщения…')).toBeNull()
  expect(screen.getByText('Найдите нужный момент')).toBeTruthy()
  await act(async () => finish(page([message(1, 'Устаревший результат')])) )
  expect(screen.queryByText('Устаревший результат')).toBeNull()
})

it('a late older page cannot mix two different search queries', async () => {
  let older!: (value: unknown) => void
  let olderSignal: AbortSignal | undefined
  const search = vi.fn((_token, _server, query, before, _limit, signal) => {
    if (before) { olderSignal = signal; return new Promise((resolve) => { older = resolve }) }
    return Promise.resolve(page([message(query === 'alpha' ? 1 : 2, query === 'alpha' ? 'Результат alpha' : 'Результат beta')], query === 'alpha'))
  })
  setup(search)
  const input = screen.getByRole('textbox', { name: 'Поиск сообщений' })
  fireEvent.change(input, { target: { value: 'alpha' } })
  await act(async () => vi.advanceTimersByTime(300))
  fireEvent.click(screen.getByRole('button', { name: 'Показать ещё' }))
  fireEvent.change(input, { target: { value: 'beta' } })
  await act(async () => vi.advanceTimersByTime(300))
  await act(async () => older(page([message(3, 'Старая страница alpha')])) )
  expect(olderSignal?.aborted).toBe(true)
  expect(screen.getByText('Результат beta')).toBeTruthy()
  expect(screen.queryByText('Старая страница alpha')).toBeNull()
  expect(screen.queryByText('Результат alpha')).toBeNull()
})

it('closing search cancels its page request and makes the panel inert', async () => {
  let signal: AbortSignal | undefined
  const search = vi.fn((_token, _server, _query, _before, _limit, value) => { signal = value; return new Promise(() => undefined) })
  const view = setup(search)
  fireEvent.change(screen.getByRole('textbox', { name: 'Поиск сообщений' }), { target: { value: 'планы' } })
  await act(async () => vi.advanceTimersByTime(300))
  view.rerender(<MessageSearchPanel {...view.props} open={false}/> )
  expect(signal?.aborted).toBe(true)
  expect(view.container.querySelector('aside')?.hasAttribute('inert')).toBe(true)
})
