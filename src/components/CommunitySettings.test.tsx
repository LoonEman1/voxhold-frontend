// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { RoleManager, StorageManager } from './CommunitySettings'
import { Modal } from './Modal'
import { createApi } from '../services/api'
import type { CleanupPlan } from '../domain/community'
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

it('locks cleanup filters while preview is pending and discards the previous deletion plan on recalculation', async () => {
  let complete!: (value: CleanupPlan) => void
  let preview = 0
  const category = { quota_bytes: 1024 ** 3, used_bytes: 100 }
  const api = createApi({ request: async <T,>(request: { path: string; method?: string }) => {
    let data: unknown = { capacity_bytes: 4 * 1024 ** 3, available_bytes: 3 * 1024 ** 3, reserve_percent: 10, categories: { images: category, files: category, recordings: category } }
    if (request.path.endsWith('/preview')) {
      preview++
      if (preview === 1) data = await new Promise<CleanupPlan>((resolve) => { complete = resolve })
      else throw new Error('Preview failed')
    }
    return { status: 200, data: data as T }
  } })
  render(<StorageManager api={api} token="fixture"/>)
  fireEvent.click(await screen.findByRole('button', { name: 'Рассчитать очистку' }))
  expect((screen.getByLabelText('Категория') as HTMLSelectElement).disabled).toBe(true)
  expect((screen.getByLabelText('Период') as HTMLSelectElement).disabled).toBe(true)
  await act(async () => complete({ token: 'images-plan', count: 3, bytes: 100 } as CleanupPlan))
  await screen.findByRole('button', { name: /Подтвердить удаление/ })
  fireEvent.click(screen.getByRole('button', { name: 'Рассчитать очистку' }))
  await screen.findByRole('alert')
  expect(screen.queryByRole('button', { name: /Подтвердить удаление/ })).toBeNull()
})
