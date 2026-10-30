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

it('preserves stable role mentions when retrying a rejected send', async () => {
  const channel: Channel = { id: 1, server_id: 1, name: 'general', kind: 'text', position: 0, created_by: 1, created_at: 0 }
  const onSend = vi.fn().mockRejectedValueOnce(new Error('Очередь заполнена')).mockResolvedValue(undefined)
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
