// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { SecuritySettings, type SecurityActions } from './SecuritySettings'
import type { AccountSession } from '../domain/types'

afterEach(cleanup)
const session = (id: number, current = false): AccountSession => ({ id, current, user_agent: current ? '' : 'Firefox', client_ip: '', created_at: 1, last_used_at: null, expires_at: 2 })
const actions = (patch: Partial<SecurityActions> = {}): SecurityActions => ({ loadSessions: async () => [session(1, true), session(2)], changePassword: vi.fn(), revokeSession: vi.fn(), revokeOthers: vi.fn(), ...patch })

it('keeps the current device and prevents duplicate revocations while a request is pending', async () => {
  let finish!: () => void
  let values = [session(1, true), session(2)]
  const revokeSession = vi.fn(() => new Promise<void>((resolve) => { finish = () => { values = [session(1, true)]; resolve() } }))
  render(<SecuritySettings actions={actions({ loadSessions: async () => values, revokeSession })}/> )
  const button = await screen.findByRole('button', { name: 'Завершить сессию: Firefox' })
  expect(screen.queryByRole('button', { name: 'Завершить сессию: Неизвестное устройство' })).toBeNull()
  fireEvent.click(button); fireEvent.click(button)
  expect(revokeSession).toHaveBeenCalledExactlyOnceWith(2)
  expect((screen.getByRole('button', { name: 'Завершить все остальные' }) as HTMLButtonElement).disabled).toBe(true)
  await act(async () => finish())
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Завершить все остальные' })).toBeNull())
  expect(screen.getByText('Эта сессия')).toBeTruthy()
  expect(screen.getByRole('status').textContent).toContain('Сессия завершена')
})

it('validates password confirmation and retains the input when toggling visibility', async () => {
  const changePassword = vi.fn().mockResolvedValue(undefined)
  render(<SecuritySettings actions={actions({ changePassword })}/> )
  fireEvent.change(screen.getByLabelText('Текущий пароль', { exact: true }), { target: { value: 'old-password' } })
  fireEvent.change(screen.getByLabelText('Новый пароль', { exact: true }), { target: { value: 'next-password' } })
  fireEvent.change(screen.getByLabelText('Повторите новый пароль', { exact: true }), { target: { value: 'different-password' } })
  fireEvent.click(screen.getByRole('button', { name: 'Показать: новый пароль' }))
  expect((screen.getByLabelText('Новый пароль', { exact: true }) as HTMLInputElement).type).toBe('text')
  expect((screen.getByLabelText('Новый пароль', { exact: true }) as HTMLInputElement).value).toBe('next-password')
  fireEvent.submit(screen.getByRole('button', { name: 'Сменить пароль' }).closest('form')!)
  expect(screen.getByRole('alert').textContent).toContain('Пароли не совпадают')
  expect(changePassword).not.toHaveBeenCalled()
  fireEvent.change(screen.getByLabelText('Повторите новый пароль', { exact: true }), { target: { value: 'next-password' } })
  fireEvent.submit(screen.getByRole('button', { name: 'Сменить пароль' }).closest('form')!)
  await waitFor(() => expect(changePassword).toHaveBeenCalledExactlyOnceWith('old-password', 'next-password', 'next-password'))
  await screen.findByText('Пароль изменён. Остальные сессии завершены.')
  expect((screen.getByLabelText('Новый пароль', { exact: true }) as HTMLInputElement).value).toBe('')
})

it('shows a failed session load separately and supports retry', async () => {
  const loadSessions = vi.fn().mockRejectedValueOnce(new Error('Устройства недоступны')).mockResolvedValue([])
  render(<SecuritySettings actions={actions({ loadSessions })}/> )
  await screen.findByRole('alert')
  expect(screen.queryByText('Нет доступных сессий.')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Повторить' }))
  await screen.findByText('Нет доступных сессий.')
  expect(screen.queryByRole('alert')).toBeNull()
})

it('checks the server byte limit for passwords containing Cyrillic characters', () => {
  const changePassword = vi.fn()
  render(<SecuritySettings actions={actions({ changePassword })}/> )
  fireEvent.change(screen.getByLabelText('Новый пароль', { exact: true }), { target: { value: 'я'.repeat(40) } })
  fireEvent.change(screen.getByLabelText('Повторите новый пароль', { exact: true }), { target: { value: 'я'.repeat(40) } })
  fireEvent.submit(screen.getByRole('button', { name: 'Сменить пароль' }).closest('form')!)
  expect(screen.getByRole('alert').textContent).toContain('Пароль слишком длинный')
  expect(changePassword).not.toHaveBeenCalled()
})

it('does not let an old session request replace the current account response', async () => {
  let finish!: (items: AccountSession[]) => void
  const old = actions({ loadSessions: () => new Promise((resolve) => { finish = resolve }) })
  const view = render(<SecuritySettings actions={old}/> )
  view.rerender(<SecuritySettings actions={actions({ loadSessions: async () => [session(1, true)] })}/> )
  await screen.findByText('Эта сессия')
  await act(async () => finish([session(2)]))
  expect(screen.queryByRole('button', { name: 'Завершить сессию: Firefox' })).toBeNull()
  expect(screen.getByText('Эта сессия')).toBeTruthy()
})
