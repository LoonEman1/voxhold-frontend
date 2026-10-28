// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { createApi } from '../services/api'
import { CommunityNavigation, CommunityProvider } from './Community'
import { StorageManager } from './CommunitySettings'
import { MessageAttachments, useAttachmentUpload } from './MessageAttachments'
import type { Message } from '../domain/types'

afterEach(cleanup)
function fixture(request: (input: { path: string; method?: string; body?: unknown; rawBody?: BodyInit; onUploadProgress?: (n: number) => void }) => unknown) {
  return createApi({ request: async <T,>(input: Parameters<typeof request>[0]) => ({ status: 200, data: await request(input) as T }) })
}
const defaults = (path: string) => path.endsWith('/inbox') ? { items: [], has_more: false } : path.endsWith('/message-privacy') ? { mode: 'shared', blocked_user_ids: [] } : []
it('opens a direct conversation from a member action and retains the same retry key after failure', async () => {
  const sends: { content: string; client_message_id: string }[] = []
  const api = fixture(async ({ path, method, body }) => {
    if (path.endsWith('/conversations') && method === 'POST') return { id: 7 }
    if (path.endsWith('/conversations')) return [{ id: 7, direct: true, name: 'Беседа', members: [{ user_id: 2, username: 'member' }], unread_count: 0 }]
    if (path.endsWith('/messages') && method === 'POST') { const input = body as typeof sends[number]; sends.push(input); if (sends.length === 1) throw new Error('connection lost'); return { id: 1, conversation_id: 7, author: { user_id: 1, username: 'owner' }, content: input.content, created_at: 1 } }
    if (path.endsWith('/messages')) return { messages: [], has_more: false }
    return defaults(path)
  })
  render(<CommunityProvider api={api} token="test" userId={1} serverId={1} owner members={[]} onMessage={() => undefined} onNavigate={() => undefined}><CommunityNavigation/></CommunityProvider>)
  act(() => window.dispatchEvent(new CustomEvent('voxhold:open-direct', { detail: 2 })))
  const input = await screen.findByLabelText('Сообщение в беседу')
  fireEvent.change(input, { target: { value: 'hello' } }); fireEvent.click(screen.getByRole('button', { name: 'Отправить' }))
  await screen.findByRole('alert'); fireEvent.click(screen.getByRole('button', { name: 'Повторить отправку' }))
  await waitFor(() => expect(sends).toHaveLength(2)); expect(sends[0]?.client_message_id).toBe(sends[1]?.client_message_id)
})
it('invalidates a cleanup preview when category changes and only submits the reviewed token', async () => {
  const calls: { path: string; body?: unknown }[] = []
  const api = fixture(({ path, body }) => { calls.push({ path, body }); if (path.endsWith('/preview')) return { token: 'reviewed-plan', count: 2, bytes: 1024 }; if (path.endsWith('/cleanup')) return { count: 2, bytes: 1024 }; return { capacity_bytes: 30 * 1024 ** 3, available_bytes: 30 * 1024 ** 3, reserve_percent: 15, categories: { images: { quota_bytes: 10 * 1024 ** 3, used_bytes: 0 }, files: { quota_bytes: 10 * 1024 ** 3, used_bytes: 0 }, recordings: { quota_bytes: 10 * 1024 ** 3, used_bytes: 0 } } } })
  render(<StorageManager api={api} token="test"/>); await screen.findByRole('button', { name: 'Рассчитать очистку' })
  fireEvent.click(screen.getByRole('button', { name: 'Рассчитать очистку' })); await screen.findByRole('button', { name: /Подтвердить удаление/ })
  fireEvent.change(screen.getByLabelText('Категория'), { target: { value: 'files' } }); expect(screen.queryByRole('button', { name: /Подтвердить удаление/ })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Рассчитать очистку' })); fireEvent.click(await screen.findByRole('button', { name: /Подтвердить удаление/ }))
  await waitFor(() => expect(calls.find((c) => c.path.endsWith('/cleanup'))?.body).toEqual({ token: 'reviewed-plan' }))
})
function UploadFixture() { const upload = useAttachmentUpload({ id: 2, server_id: 1, name: 'chat', kind: 'text', position: 0, created_by: 1, created_at: 1 }, true); return <section onPaste={upload.onPaste} onDrop={upload.onDrop} onDragOver={upload.onDragOver}>{upload.control}</section> }
it('retries an interrupted file upload with its original attachment and message keys', async () => {
  const uploads: string[] = [], messages: string[] = [], received = vi.fn()
  const api = fixture(({ path, body, onUploadProgress }) => { if (path.includes('/attachments/')) { uploads.push(path); if (uploads.length === 1) throw new Error('connection lost'); onUploadProgress?.(1); return { id: 'a', filename: 'a.txt', mime_type: 'text/plain', size_bytes: 2 } }; if (path.endsWith('/messages')) { messages.push((body as { client_message_id: string }).client_message_id); return { id: 5, channel_id: 2, attachments: [{ id: 'a' }] } as Message }; return defaults(path) })
  const { container } = render(<CommunityProvider api={api} token="test" userId={1} serverId={1} owner members={[]} onMessage={received} onNavigate={() => undefined}><UploadFixture/></CommunityProvider>)
  fireEvent.change(container.querySelector('input[type=file]')!, { target: { files: [new File(['hi'], 'a.txt', { type: 'text/plain' })] } }); fireEvent.click(await screen.findByRole('button', { name: 'Повторить' }))
  await waitFor(() => expect(received).toHaveBeenCalledTimes(1)); expect(uploads).toHaveLength(2); expect(uploads[0]).toBe(uploads[1]); expect(messages).toHaveLength(1)
})
it('renders a permanent server-removal placeholder without fetching deleted content', () => {
  render(<MessageAttachments attachments={[{ id: 'removed', filename: 'old.png', mime_type: 'image/png', size_bytes: 99, deleted: true }]}/>); expect(screen.getByText(/Вложение удалено сервером/)).toBeTruthy(); expect(screen.queryByRole('img')).toBeNull()
})
