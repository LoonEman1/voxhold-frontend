// @vitest-environment jsdom
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChatPanel } from './ChatPanel'
import * as mentions from '../lib/mentions'
import type { Channel, Message, ReactorPage } from '../domain/types'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('long chat histories', () => {
  it('bounds mounted rows and keeps composing independent of history length', () => {
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600)
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800)
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(60)
    const messages = Array.from({ length: 5_000 }, (_, index): Message => ({ id: index + 1, channel_id: 1, content: `Message ${index + 1}`, author: { user_id: 1, username: 'Alice' }, created_at: 1_700_000_000 + index * 60, edited_at: null }))
    const channel: Channel = { id: 1, server_id: 1, name: 'general', kind: 'text', position: 0, created_by: 1, created_at: 0 }
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: vi.fn() })
    const { container } = render(<ChatPanel
      channel={channel} messages={messages} loading={false} loadingOlder={false} hasMore={false}
      loadingNewer={false} hasNewer={false} currentUserId={2} canManage={false} members={[]}
      pinnedMessageIds={new Set()} focusedMessageId={null} channelReads={{}}
      onLoadOlder={vi.fn(async () => undefined)} onLoadNewer={vi.fn(async () => undefined)}
      onReturnToLatest={vi.fn(async () => undefined)} onReadThrough={vi.fn()}
      onSend={vi.fn(async () => undefined)} onEdit={vi.fn(async () => undefined)} onDelete={vi.fn(async () => undefined)}
      onTogglePin={vi.fn(async () => undefined)} onOpenProfile={vi.fn()}
    />)
    const rows = container.querySelectorAll('[data-message-id]')
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.length).toBeLessThan(80)
    const parse = vi.spyOn(mentions, 'parseMentions')
    fireEvent.change(screen.getByLabelText('Сообщение в general'), { target: { value: 'Hello' } })
    expect(parse).not.toHaveBeenCalled()
    expect((screen.getByLabelText('Сообщение в general') as HTMLTextAreaElement).value).toBe('Hello')
    expect(container.querySelectorAll('[data-message-id]').length).toBeLessThan(80)
  })
})

it('preserves stable role mentions when retrying a locally rejected send', async () => {
  const channel: Channel = { id: 1, server_id: 1, name: 'general', kind: 'text', position: 0, created_by: 1, created_at: 0 }
  const onSend = vi.fn().mockImplementationOnce(() => { throw new Error('Очередь заполнена') })
  render(<ChatPanel
    channel={channel} messages={[]} loading={false} loadingOlder={false} hasMore={false}
    loadingNewer={false} hasNewer={false} currentUserId={2} currentRole="admin" canManage={false} members={[]}
    pinnedMessageIds={new Set()} focusedMessageId={null} channelReads={{}}
    onLoadOlder={vi.fn(async () => undefined)} onLoadNewer={vi.fn(async () => undefined)}
    onReturnToLatest={vi.fn(async () => undefined)} onReadThrough={vi.fn()}
    onSend={onSend} onEdit={vi.fn(async () => undefined)} onDelete={vi.fn(async () => undefined)}
    onTogglePin={vi.fn(async () => undefined)} onOpenProfile={vi.fn()}
  />)
  const input = screen.getByLabelText('Сообщение в general')
  fireEvent.change(input, { target: { value: '@admin', selectionStart: 6 } })
  fireEvent.click(screen.getByRole('option', { name: /@Админ/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Отправить' }))
  await screen.findByText('Очередь заполнена')
  fireEvent.click(screen.getByRole('button', { name: 'Отправить' }))
  await waitFor(() => expect(onSend).toHaveBeenCalledTimes(2))
  expect(onSend.mock.calls.map(([content]) => content)).toEqual(['<@&admin>', '<@&admin>'])
})

it('replaces the reactor loader scope through memoized message rows', async () => {
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600)
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800)
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(60)
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: vi.fn() })
  const first = vi.fn<(messageId: number, emoji: string, signal: AbortSignal) => Promise<ReactorPage>>(async () => ({ users: [{ user_id: 10, username: 'FirstScope' }], has_more: false, next_user_id: null }))
  const second = vi.fn(async () => ({ users: [{ user_id: 20, username: 'SecondScope' }], has_more: false, next_user_id: null }))
  const props = {
    channel: { id: 1, server_id: 1, name: 'general', kind: 'text' as const, position: 0, created_by: 1, created_at: 0 },
    messages: [{ id: 1, channel_id: 1, content: 'Hello', author: { user_id: 1, username: 'Alice' }, created_at: 0, edited_at: null, reactions: [{ emoji: '👍', count: 1, me: false }] }],
    loading: false, loadingOlder: false, hasMore: false, loadingNewer: false, hasNewer: false,
    currentUserId: 2, canManage: false, members: [], pinnedMessageIds: new Set<number>(), focusedMessageId: null, channelReads: {},
    onLoadOlder: vi.fn(async () => undefined), onLoadNewer: vi.fn(async () => undefined), onReturnToLatest: vi.fn(async () => undefined),
    onReadThrough: vi.fn(), onSend: vi.fn(async () => undefined), onEdit: vi.fn(async () => undefined), onDelete: vi.fn(async () => undefined),
    onTogglePin: vi.fn(async () => undefined), onOpenProfile: vi.fn(),
  }
  const { container, rerender } = render(<ChatPanel {...props} onLoadReactors={first} />)
  fireEvent.focus(container.querySelector('.message-reaction')!)
  await screen.findByText('FirstScope')
  const oldSignal = first.mock.calls[0]?.[2] as AbortSignal | undefined
  rerender(<ChatPanel {...props} onLoadReactors={second} />)
  await screen.findByText('SecondScope')
  expect(screen.queryByText('FirstScope')).toBeNull()
  expect(second).toHaveBeenCalledOnce()
  expect(oldSignal?.aborted).toBe(true)
})

it('does not parse visible messages again for presence-only member updates', () => {
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600)
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800)
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(60)
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: vi.fn() })
  const props = {
    channel: { id: 1, server_id: 1, name: 'general', kind: 'text', position: 0, created_by: 1, created_at: 0 } as Channel,
    messages: [{ id: 1, channel_id: 1, content: 'Hi <@2>', author: { user_id: 1, username: 'Alice' }, created_at: 1, edited_at: null }] as Message[],
    loading: false, loadingOlder: false, hasMore: false, loadingNewer: false, hasNewer: false,
    currentUserId: 2, canManage: false, pinnedMessageIds: new Set<number>(), focusedMessageId: null, channelReads: {},
    onLoadOlder: vi.fn(async () => {}), onLoadNewer: vi.fn(async () => {}), onReturnToLatest: vi.fn(async () => {}),
    onReadThrough: vi.fn(), onSend: vi.fn(async () => {}), onEdit: vi.fn(async () => {}), onDelete: vi.fn(async () => {}), onTogglePin: vi.fn(async () => {}), onOpenProfile: vi.fn(),
  }
  const member = { user_id: 2, username: 'Bob', role: 'member' as const, created_at: 1, joined_at: 1, about: '', country_code: null, last_seen_at: 1 }
  const view = render(<ChatPanel {...props} members={[member]}/>)
  const parse = vi.spyOn(mentions, 'parseMentions')
  view.rerender(<ChatPanel {...props} members={[{ ...member, last_seen_at: 2 }]}/>)
  expect(parse).not.toHaveBeenCalled()
  view.rerender(<ChatPanel {...props} members={[{ ...member, username: 'Robert' }]}/>)
  expect(parse).toHaveBeenCalled()
})

it('a custom role with manage_messages must expose moderation actions', () => {
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600)
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800)
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(60)
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: vi.fn() })
  const props = {
    channel: { id: 1, server_id: 1, name: 'general', kind: 'text' as const, position: 0, created_by: 1, created_at: 0, permissions: 17, can_publish: false },
    messages: [{ id: 1, channel_id: 1, content: 'moderation-probe', author: { user_id: 1, username: 'Alice' }, created_at: 0, edited_at: null }],
    loading: false, loadingOlder: false, hasMore: false, loadingNewer: false, hasNewer: false,
    currentUserId: 2, currentRole: 'member' as const, canManage: false, members: [], pinnedMessageIds: new Set<number>(), focusedMessageId: null, channelReads: {},
    onLoadOlder: vi.fn(async () => undefined), onLoadNewer: vi.fn(async () => undefined), onReturnToLatest: vi.fn(async () => undefined),
    onReadThrough: vi.fn(), onSend: vi.fn(async () => undefined), onEdit: vi.fn(async () => undefined), onDelete: vi.fn(async () => undefined),
    onTogglePin: vi.fn(async () => undefined), onOpenProfile: vi.fn(),
  }
  render(<ChatPanel {...props}/>)
  fireEvent.contextMenu(screen.getByText('moderation-probe'), { clientX: 100, clientY: 100 })
  expect(screen.queryByRole('menuitem', { name: 'Закрепить' })).not.toBeNull()
  expect(screen.queryByRole('menuitem', { name: 'Удалить' })).not.toBeNull()
})


it('accepts consecutive sends without waiting for network acknowledgement', async () => {
  let settle!: () => void
  const acknowledgement = new Promise<void>((resolve) => { settle = resolve })
  const onSend = vi.fn((..._args: [string, ...unknown[]]) => acknowledgement)
  const channel: Channel = { id: 1, server_id: 1, name: 'general', kind: 'text', position: 0, created_by: 1, created_at: 0 }
  render(<ChatPanel
    channel={channel} messages={[]} loading={false} loadingOlder={false} hasMore={false}
    loadingNewer={false} hasNewer={false} currentUserId={2} canManage={false} members={[]}
    pinnedMessageIds={new Set()} focusedMessageId={null} channelReads={{}}
    onLoadOlder={vi.fn(async () => undefined)} onLoadNewer={vi.fn(async () => undefined)}
    onReturnToLatest={vi.fn(async () => undefined)} onReadThrough={vi.fn()}
    onSend={onSend} onEdit={vi.fn(async () => undefined)} onDelete={vi.fn(async () => undefined)}
    onTogglePin={vi.fn(async () => undefined)} onOpenProfile={vi.fn()}
  />)
  const input = screen.getByLabelText('Сообщение в general')
  fireEvent.change(input, { target: { value: 'first' } })
  fireEvent.click(screen.getByRole('button', { name: 'Отправить' }))
  await waitFor(() => {
    expect(onSend).toHaveBeenCalledTimes(1)
    expect((input as HTMLTextAreaElement).value).toBe('')
  })
  fireEvent.change(input, { target: { value: 'second' } })
  fireEvent.click(screen.getByRole('button', { name: 'Отправить' }))
  await waitFor(() => {
    expect(onSend).toHaveBeenCalledTimes(2)
    expect((input as HTMLTextAreaElement).value).toBe('')
  })
  expect(onSend.mock.calls.map(([content]) => content)).toEqual(['first', 'second'])
  settle()
})

it('scrolls to a new pending message without pulling a reader back on retry or acknowledgement', () => {
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600)
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800)
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: vi.fn() })
  const channel: Channel = { id: 1, server_id: 1, name: 'general', kind: 'text', position: 0, created_by: 1, created_at: 0 }
  const messages: Message[] = [{ id: 1, channel_id: 1, content: 'Hello', author: { user_id: 1, username: 'Alice' }, created_at: 1, edited_at: null }]
  const failed = { id: 'pending-1', content: 'Outgoing', status: 'failed' as const, error: 'Ошибка сети' }
  const props = {
    channel, messages, loading: false, loadingOlder: false, hasMore: false, loadingNewer: false, hasNewer: false,
    currentUserId: 2, canManage: false, members: [], pinnedMessageIds: new Set<number>(), focusedMessageId: null, channelReads: {},
    onLoadOlder: vi.fn(async () => undefined), onLoadNewer: vi.fn(async () => undefined), onReturnToLatest: vi.fn(async () => undefined),
    onReadThrough: vi.fn(), onSend: vi.fn(), onEdit: vi.fn(async () => undefined), onDelete: vi.fn(async () => undefined),
    onTogglePin: vi.fn(async () => undefined), onOpenProfile: vi.fn(),
  }
  const view = render(<ChatPanel {...props} pendingMessages={[]}/>)
  const container = view.container.querySelector<HTMLDivElement>('.messages')!
  Object.defineProperty(container, 'scrollHeight', { configurable: true, get: () => 1200 })
  container.scrollTop = 200
  fireEvent.scroll(container)
  view.rerender(<ChatPanel {...props} pendingMessages={[failed]}/>)
  expect(container.scrollTop).toBe(1200)

  container.scrollTop = 400
  fireEvent.scroll(container)
  view.rerender(<ChatPanel {...props} pendingMessages={[{ ...failed, status: 'sending' }]}/>)
  expect(container.scrollTop).toBe(400)
  container.scrollTop = 300
  fireEvent.scroll(container)
  view.rerender(<ChatPanel {...props} pendingMessages={[]}/>)
  expect(container.scrollTop).toBe(300)
})

it('keeps the bottom anchored when pending status and error change without changing ids', () => {
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600)
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800)
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: vi.fn() })
  const channel: Channel = { id: 1, server_id: 1, name: 'general', kind: 'text', position: 0, created_by: 1, created_at: 0 }
  const messages: Message[] = [{ id: 1, channel_id: 1, content: 'Hello', author: { user_id: 1, username: 'Alice' }, created_at: 1, edited_at: null }]
  const sending = { id: 'pending-1', content: 'Outgoing', status: 'sending' as const }
  const props = {
    channel, messages, loading: false, loadingOlder: false, hasMore: false, loadingNewer: false, hasNewer: false,
    currentUserId: 2, canManage: false, members: [], pinnedMessageIds: new Set<number>(), focusedMessageId: null, channelReads: {},
    onLoadOlder: vi.fn(async () => undefined), onLoadNewer: vi.fn(async () => undefined), onReturnToLatest: vi.fn(async () => undefined),
    onReadThrough: vi.fn(), onSend: vi.fn(), onEdit: vi.fn(async () => undefined), onDelete: vi.fn(async () => undefined),
    onTogglePin: vi.fn(async () => undefined), onOpenProfile: vi.fn(),
  }
  const view = render(<ChatPanel {...props} pendingMessages={[sending]}/>)
  const container = view.container.querySelector<HTMLDivElement>('.messages')!
  let height = 1200
  Object.defineProperty(container, 'scrollHeight', { configurable: true, get: () => height })
  container.scrollTop = 600
  fireEvent.scroll(container)

  height = 1260
  view.rerender(<ChatPanel {...props} pendingMessages={[{ ...sending, status: 'failed', error: 'Ошибка сети' }]}/>)
  expect(container.scrollTop).toBe(1260)

  container.scrollTop = 400
  fireEvent.scroll(container)
  view.rerender(<ChatPanel {...props} pendingMessages={[sending]}/>)
  expect(container.scrollTop).toBe(400)
})

it('shows the queued and failed indicators with their respective context actions', () => {
  const channel: Channel = { id: 1, server_id: 1, name: 'general', kind: 'text', position: 0, created_by: 1, created_at: 0 }
  const pending = { id: 'pending-1', content: 'Outgoing', status: 'failed' as const, error: 'Сеть недоступна' }
  const queued = { id: 'pending-2', content: 'Waiting', status: 'failed' as const, retryable: true }
  const onRetry = vi.fn(), onDismiss = vi.fn()
  render(<ChatPanel
    channel={channel} messages={[]} pendingMessages={[pending, queued]} onRetryPending={onRetry} onDismissPending={onDismiss}
    loading={false} loadingOlder={false} hasMore={false} loadingNewer={false} hasNewer={false}
    currentUserId={2} canManage={false} members={[]} pinnedMessageIds={new Set()} focusedMessageId={null} channelReads={{}}
    onLoadOlder={vi.fn(async () => undefined)} onLoadNewer={vi.fn(async () => undefined)} onReturnToLatest={vi.fn(async () => undefined)}
    onReadThrough={vi.fn()} onSend={vi.fn()} onEdit={vi.fn(async () => undefined)} onDelete={vi.fn(async () => undefined)}
    onTogglePin={vi.fn(async () => undefined)} onOpenProfile={vi.fn()}
  />)
  expect(screen.getByRole('button', { name: 'Не отправлено' }).getAttribute('title')).toBe('Сеть недоступна')
  fireEvent.contextMenu(screen.getByText('Outgoing'))
  fireEvent.click(screen.getByRole('menuitem', { name: 'Отправить' }))
  expect(onRetry).toHaveBeenCalledWith(pending)
  fireEvent.click(screen.getByRole('button', { name: 'Ожидает отправки' }))
  expect(screen.queryByRole('menuitem', { name: 'Отправить' })).toBeNull()
  fireEvent.click(screen.getByRole('menuitem', { name: 'Удалить' }))
  expect(onDismiss).toHaveBeenCalledWith('pending-2')
})
