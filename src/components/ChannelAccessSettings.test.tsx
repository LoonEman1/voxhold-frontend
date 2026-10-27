// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { Channel, ChannelAccess, ServerMember } from '../domain/types'
import type { VoxholdApi } from '../services/api'
import { ChannelAccessSettings } from './ChannelAccessSettings'

afterEach(cleanup)
const members = [{ user_id: 1, username: 'Owner', role: 'owner' }, { user_id: 2, username: 'Alice', role: 'member' }, { user_id: 3, username: 'Bob', role: 'member' }] as ServerMember[]
const channel = { id: 7, server_id: 1, name: 'Private', kind: 'voice' } as Channel
const access: ChannelAccess = { restricted: false, user_ids: [], roles: [] }
function props() {
  const get = vi.fn(async () => access), save = vi.fn(async (_token: string, _server: number, _channel: number, value: ChannelAccess) => value)
  return { api: { channels: { access: get, setAccess: save } } as unknown as VoxholdApi, token: 'token', channel, members, onSaved: vi.fn(), get, save }
}
it('saves selected users independently of search and previews the effective access', async () => {
  const input = props(); render(<ChannelAccessSettings {...input}/>)
  fireEvent.click(await screen.findByLabelText(/Закрытый канал/))
  fireEvent.click(screen.getByRole('checkbox', { name: /Alice/ }))
  fireEvent.change(screen.getByLabelText('Найти участника для доступа'), { target: { value: 'Bob' } })
  expect(screen.queryByRole('checkbox', { name: /Alice/ })).toBeNull()
  expect(screen.getByText('Канал будет доступен 2 из 3')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить доступ' }))
  await waitFor(() => expect(input.save).toHaveBeenCalledWith('token', 1, 7, { restricted: true, user_ids: [2], roles: [] }))
  expect(await screen.findByRole('status')).toHaveTextContent('Доступ обновлён')
  expect(input.onSaved).toHaveBeenCalledOnce()
})
it('does not treat failed loading as open access and allows retry', async () => {
  const input = props(); input.get.mockRejectedValueOnce(new Error('Недоступно'))
  render(<ChannelAccessSettings {...input}/>)
  expect(await screen.findByRole('alert')).toHaveTextContent('Недоступно')
  expect(screen.queryByRole('radio')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Повторить' }))
  expect(await screen.findByLabelText(/Для всех участников/)).toBeChecked()
})
it('keeps unsaved edits when saving fails and includes role access', async () => {
  const input = props(); input.save.mockRejectedValueOnce(new Error('Не сохранено'))
  render(<ChannelAccessSettings {...input}/>)
  fireEvent.click(await screen.findByLabelText(/Закрытый канал/))
  fireEvent.click(screen.getByLabelText(/Все обычные участники/))
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить доступ' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Не сохранено')
  expect(screen.getByText('Канал будет доступен 3 из 3')).toBeTruthy()
  expect(input.onSaved).not.toHaveBeenCalled()
})
