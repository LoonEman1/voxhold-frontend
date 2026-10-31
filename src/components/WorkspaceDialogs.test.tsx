// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ProfileDialog } from './WorkspaceDialogs'
import { ThemeProvider } from '../theme/ThemeContext'
import type { Profile } from '../domain/types'

afterEach(cleanup)
const profile: Profile = { user_id: 1, username: 'Alice', about: '', country_code: null, created_at: 1, updated_at: 1, last_seen_at: 1 }
it('requires the exact username, retains errors and permits cancellation', async () => {
  const remove = vi.fn().mockRejectedValueOnce(new Error('Удаление недоступно')).mockResolvedValue(undefined)
  const close = vi.fn()
  render(<ThemeProvider><ProfileDialog open onClose={close} profile={profile} onSubmit={async () => undefined} onDeleteAccount={remove}/></ThemeProvider>)
  fireEvent.click(screen.getByRole('button', { name: 'Удалить аккаунт' }))
  const input = screen.getByRole('textbox', { name: 'Имя пользователя для удаления аккаунта' })
  const confirm = screen.getByRole('button', { name: 'Удалить аккаунт навсегда' }) as HTMLButtonElement
  fireEvent.change(input, { target: { value: 'alice' } })
  expect(confirm.disabled).toBe(true)
  fireEvent.click(confirm)
  expect(remove).not.toHaveBeenCalled()
  fireEvent.change(input, { target: { value: 'Alice' } })
  fireEvent.click(confirm)
  await screen.findByRole('alert')
  expect(close).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Отменить удаление' }))
  fireEvent.click(screen.getByRole('button', { name: 'Удалить аккаунт' }))
  expect((screen.getByRole('textbox', { name: 'Имя пользователя для удаления аккаунта' }) as HTMLInputElement).value).toBe('')
  fireEvent.change(screen.getByRole('textbox', { name: 'Имя пользователя для удаления аккаунта' }), { target: { value: 'Alice' } })
  fireEvent.click(screen.getByRole('button', { name: 'Удалить аккаунт навсегда' }))
  await waitFor(() => expect(close).toHaveBeenCalledTimes(1))
  expect(remove).toHaveBeenCalledTimes(2)
})
it('does not offer deletion when the owner cannot delete their account', () => {
  render(<ThemeProvider><ProfileDialog open onClose={vi.fn()} profile={profile} onSubmit={async () => undefined}/></ThemeProvider>)
  expect(screen.queryByRole('region', { name: 'Опасная зона' })).toBeNull()
})

it('switches the theme from the profile appearance section', () => {
  document.documentElement.dataset.theme = 'dark'
  render(<ThemeProvider><ProfileDialog open onClose={vi.fn()} profile={profile} onSubmit={async () => undefined}/></ThemeProvider>)
  fireEvent.click(screen.getByRole('button', { name: 'Включить светлую тему' }))
  expect(document.documentElement.dataset.theme).toBe('light')
  fireEvent.click(screen.getByRole('button', { name: 'Включить тёмную тему' }))
  expect(document.documentElement.dataset.theme).toBe('dark')
})
