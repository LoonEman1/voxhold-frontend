// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import type { Channel, NotificationSettings, ServerMember } from '../domain/types'
import type { VoxholdApi } from '../services/api'
import { ChannelNotificationsDialog } from './ChannelNotificationsDialog'
import { MentionComposer } from './MentionComposer'
import { MessageMentions } from './MessageMentions'
import { mentionDirectory, parseMentions } from '../lib/mentions'

afterEach(() => { cleanup(); vi.restoreAllMocks() })
const members = [{ user_id: 1, username: 'Nikita', role: 'member' }, { user_id: 2, username: 'Alice', role: 'admin' }] as ServerMember[]
const channel = { id: 7, server_id: 1, name: 'general', kind: 'text' } as Channel
function props() {
  const get = vi.fn(async (): Promise<NotificationSettings> => ({ server_id: 1, channel_id: 7, mode: 'mentions' })), set = vi.fn(async (): Promise<NotificationSettings> => ({ server_id: 1, channel_id: 7, mode: 'all' }))
  return { api: { channels: { notifications: get, setNotifications: set } } as unknown as VoxholdApi, token: 'token', channel, open: true, onClose: vi.fn(), onSaved: vi.fn(), onPreviewSound: vi.fn(), get, set }
}
it('defaults to mentions, saves per channel, and previews sound only on request', async () => {
  const input = props(); render(<ChannelNotificationsDialog {...input}/>)
  expect(await screen.findByRole('radio', { name: /Только упоминания/ })).toBeChecked()
  expect(input.onPreviewSound).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Послушать звук' })); expect(input.onPreviewSound).toHaveBeenCalledOnce()
  fireEvent.click(screen.getByRole('radio', { name: /Все сообщения/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
  await waitFor(() => expect(input.set).toHaveBeenCalledWith('token', 1, 7, 'all'))
  expect(input.onSaved).toHaveBeenCalledWith({ server_id: 1, channel_id: 7, mode: 'all' })
})
it('does not display a default policy when loading fails', async () => {
  const input = props(); input.get.mockRejectedValueOnce(new Error('Offline'))
  render(<ChannelNotificationsDialog {...input}/>)
  expect(await screen.findByRole('alert')).toHaveTextContent('Offline')
  expect(screen.queryByRole('radio')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Повторить загрузку' }))
  expect(await screen.findByRole('radio', { name: /Только упоминания/ })).toBeChecked()
})
it('updates settings from another device while ignoring a late initial load', async () => {
  const input = props(); let complete!: (value: NotificationSettings) => void
  input.get.mockImplementation(() => new Promise((resolve) => { complete = resolve }))
  const { rerender } = render(<ChannelNotificationsDialog {...input}/>)
  rerender(<ChannelNotificationsDialog {...input} liveSettings={{ server_id: 1, channel_id: 7, mode: 'none' }}/>)
  complete({ server_id: 1, channel_id: 7, mode: 'mentions' })
  await waitFor(() => expect(screen.getByRole('radio', { name: /Ничего/ })).toBeChecked())
})
it('inserts stable user/role tokens with the keyboard and keeps Shift+Enter for newlines', () => {
  const send = vi.fn()
  function Composer() { const [draft, setDraft] = useState(''); return <MentionComposer draft={draft} onChange={setDraft} onSubmit={send} sending={false} channelName="general" members={members} error=""/> }
  render(<Composer/>); const input = screen.getByRole('textbox')
  fireEvent.change(input, { target: { value: '@Nik', selectionStart: 4 } })
  expect(screen.getByRole('option', { name: /Nikita/ })).toBeTruthy()
  fireEvent.keyDown(input, { key: 'Enter' }); expect(input).toHaveValue('@Nikita '); expect(send).not.toHaveBeenCalled()
  fireEvent.change(input, { target: { value: '@Адм', selectionStart: 4 } })
  fireEvent.keyDown(input, { key: 'Enter', shiftKey: true }); expect(send).not.toHaveBeenCalled(); expect(input).toHaveValue('@Адм')
  fireEvent.keyDown(input, { key: 'Enter' }); expect(input).toHaveValue('@Админ ')
  fireEvent.keyDown(input, { key: 'Enter' }); expect(send).toHaveBeenCalledOnce(); expect(send.mock.calls[0]?.[1]).toBe('<@&admin> ')
})
it('renders personal mentions as safe, readable chips', () => {
  const content = 'Привет <@1> и <@&admin> <img src=x onerror=alert(1)>'
  const { container } = render(<p><MessageMentions content={content} mentions={parseMentions(content, mentionDirectory(members))} currentUserId={1} currentRole="member"/></p>)
  expect(container.querySelector('.message-mention--me')).toHaveTextContent('@Nikita')
  expect(container.querySelector('img')).toBeNull()
  expect(container.textContent).toContain('<img src=x onerror=alert(1)>')
})

it('does not close a new dialog after an older save finishes after unmount', async () => {
  const input = props(); let complete!: (value: NotificationSettings) => void
  input.set.mockImplementation(() => new Promise((resolve) => { complete = resolve }))
  const first = render(<ChannelNotificationsDialog {...input}/>)
  fireEvent.click(await screen.findByRole('radio', { name: /Все сообщения/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить' })); first.unmount()
  complete({ server_id: 1, channel_id: 7, mode: 'all' }); await Promise.resolve()
  expect(input.onClose).not.toHaveBeenCalled(); expect(input.onSaved).not.toHaveBeenCalled()
})
