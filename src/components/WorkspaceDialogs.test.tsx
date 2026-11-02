// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { CreateServerDialog, CreateChannelDialog, ProfileDialog } from './WorkspaceDialogs'
import { ThemeProvider } from '../theme/ThemeContext'
import type { Profile } from '../domain/types'

afterEach(cleanup)

it.each(['server', 'channel', 'profile'] as const)('ignores a previous %s submission after closing and reopening the dialog', async (kind) => {
  let complete!: () => void
  const close = vi.fn(), submit = vi.fn(() => new Promise<void>((resolve) => { complete = resolve }))
  const content = (open: boolean) => <ThemeProvider>{kind === 'server' ? <CreateServerDialog open={open} onClose={close} onSubmit={submit}/> : kind === 'channel' ? <CreateChannelDialog open={open} onClose={close} onSubmit={submit}/> : <ProfileDialog open={open} onClose={close} onSubmit={submit} profile={profile}/>}</ThemeProvider>
  const { rerender } = render(content(true))
  const field = () => screen.getByLabelText(kind === 'server' ? 'Название сервера' : kind === 'channel' ? 'Название канала' : /О себе/)
  fireEvent.change(field(), { target: { value: 'Первый запрос' } })
  fireEvent.submit(field().closest('form')!)
  expect(submit).toHaveBeenCalledOnce()
  rerender(content(false)); rerender(content(true))
  fireEvent.change(field(), { target: { value: 'Новый черновик' } })
  await act(async () => complete())
  expect(close).not.toHaveBeenCalled()
  expect((field() as HTMLInputElement).value).toBe('Новый черновик')
  expect(screen.queryByRole('alert')).toBeNull()
})
const profile: Profile = { user_id: 1, username: 'Alice', about: '', country_code: null, created_at: 1, updated_at: 1, last_seen_at: 1 }
it('requires the exact username, retains errors and permits cancellation', async () => {
  const remove = vi.fn().mockRejectedValueOnce(new Error('Удаление недоступно')).mockResolvedValue(undefined)
  const close = vi.fn()
  render(<ThemeProvider><ProfileDialog open onClose={close} profile={profile} onSubmit={async () => undefined} onDeleteAccount={remove}/></ThemeProvider>)
  fireEvent.click(screen.getByRole('tab', { name: 'Безопасность' }))
  fireEvent.click(screen.getByRole('button', { name: 'Удалить аккаунт' }))
  const input = screen.getByRole('textbox', { name: 'Имя пользователя для удаления аккаунта' })
  const confirm = screen.getByRole('button', { name: 'Удалить аккаунт навсегда' }) as HTMLButtonElement
  fireEvent.change(input, { target: { value: 'alice' } })
  expect(confirm.disabled).toBe(true)
  fireEvent.click(confirm)
  expect(remove).not.toHaveBeenCalled()
  fireEvent.change(input, { target: { value: 'Alice' } })
  fireEvent.change(screen.getByLabelText('Пароль для удаления аккаунта'), { target: { value: 'pw' } })
  fireEvent.click(confirm)
  await screen.findByRole('alert')
  expect(close).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Отменить удаление' }))
  fireEvent.click(screen.getByRole('button', { name: 'Удалить аккаунт' }))
  expect((screen.getByRole('textbox', { name: 'Имя пользователя для удаления аккаунта' }) as HTMLInputElement).value).toBe('')
  fireEvent.change(screen.getByRole('textbox', { name: 'Имя пользователя для удаления аккаунта' }), { target: { value: 'Alice' } })
  fireEvent.change(screen.getByLabelText('Пароль для удаления аккаунта'), { target: { value: 'pw' } })
  fireEvent.click(screen.getByRole('button', { name: 'Удалить аккаунт навсегда' }))
  await waitFor(() => expect(close).toHaveBeenCalledTimes(1))
  expect(remove).toHaveBeenCalledTimes(2)
  expect(remove).toHaveBeenLastCalledWith('pw')
})
it('does not offer deletion when the owner cannot delete their account', () => {
  render(<ThemeProvider><ProfileDialog open onClose={vi.fn()} profile={profile} onSubmit={async () => undefined}/></ThemeProvider>)
  expect(screen.queryByRole('region', { name: 'Опасная зона' })).toBeNull()
})

it('switches the theme from the profile appearance section', () => {
  document.documentElement.dataset.theme = 'dark'
  render(<ThemeProvider><ProfileDialog open onClose={vi.fn()} profile={profile} onSubmit={async () => undefined}/></ThemeProvider>)
  fireEvent.click(screen.getByRole('tab', { name: 'Оформление' }))
  fireEvent.click(screen.getByRole('button', { name: 'Включить светлую тему' }))
  expect(document.documentElement.dataset.theme).toBe('light')
  fireEvent.click(screen.getByRole('button', { name: 'Включить тёмную тему' }))
  expect(document.documentElement.dataset.theme).toBe('dark')
})
