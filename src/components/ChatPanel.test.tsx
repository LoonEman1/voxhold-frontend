// @vitest-environment jsdom
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChatPanel } from './ChatPanel'
import type { Channel, Message } from '../domain/types'

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
    fireEvent.change(screen.getByLabelText('Сообщение в general'), { target: { value: 'Hello' } })
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
