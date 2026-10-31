// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { RoleManager } from './CommunitySettings'
import { Modal } from './Modal'
import { createApi } from '../services/api'
afterEach(() => { cleanup(); vi.restoreAllMocks() })
it('confirms role deletion in a nested dialog, retains errors, and never calls native confirm', async () => {
  const native = vi.spyOn(window, 'confirm'), remove = vi.fn().mockRejectedValueOnce(new Error('Нет доступа')).mockResolvedValue(undefined)
  const api = createApi({ request: async <T,>(request: { path: string; method?: string }) => {
    if (request.method === 'DELETE') await remove()
    return { status: 200, data: (request.path.endsWith('/roles') ? [{ id: 1, name: 'Авторы', permissions: 15, color: '#aaa', user_ids: [] }] : []) as T }
  } })
  render(<Modal open title="Настройки сервера" onClose={vi.fn()}><RoleManager api={api} token="fixture" serverId={1} members={[]}/></Modal>)
  fireEvent.click(await screen.findByRole('button', { name: 'Удалить' }))
  expect(screen.getByRole('dialog', { name: 'Удалить роль?' })).toBeTruthy()
  expect(native).not.toHaveBeenCalled(); expect(remove).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Удалить роль' }))
  await screen.findByText('Не удалось связаться с сервером')
  expect(screen.getByRole('dialog', { name: 'Удалить роль?' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Удалить роль' }))
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Удалить роль?' })).toBeNull())
  expect(remove).toHaveBeenCalledTimes(2); expect(document.body.classList.contains('modal-open')).toBe(true)
})
