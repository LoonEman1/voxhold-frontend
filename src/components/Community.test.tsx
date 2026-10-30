// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { createApi } from '../services/api'
import { CommunityContent, CommunityNavigation, CommunityProvider } from './Community'
import { StorageManager } from './CommunitySettings'
import { MessageAttachments, useAttachmentUpload } from './MessageAttachments'

afterEach(cleanup)
function fixture(request: (input: { path: string; method?: string; body?: unknown; rawBody?: BodyInit; onUploadProgress?: (n: number) => void; signal?: AbortSignal }) => unknown) {
  return createApi({ request: async <T,>(input: Parameters<typeof request>[0]) => ({ status: 200, data: await request(input) as T }) })
}
const defaults = (path: string) => path.endsWith('/inbox') ? { items: [], has_more: false } : path.endsWith('/message-privacy') ? { mode: 'shared', blocked_user_ids: [] } : []
it('opens a direct conversation from a member action and retains the same retry key after failure', async () => {
  let historyLoads = 0
  const sends: { content: string; client_message_id: string }[] = []
  const api = fixture(async ({ path, method, body }) => {
    if (path.split('?')[0]!.endsWith('/conversations') && method === 'POST') return { id: 7 }
    if (path.split('?')[0]!.endsWith('/conversations')) return [{ id: 7, direct: true, name: 'Беседа', members: [{ user_id: 2, username: 'member' }], unread_count: 0 }]
    if (path.endsWith('/messages') && method === 'POST') { const input = body as typeof sends[number]; sends.push(input); if (sends.length === 1) throw new Error('connection lost'); return { id: 1, conversation_id: 7, author: { user_id: 1, username: 'owner' }, content: input.content, created_at: 1 } }
    if (path.endsWith('/messages')) { historyLoads++; return { messages: [], has_more: false } }
    return defaults(path)
  })
  render(<CommunityProvider api={api} token="test" userId={1} serverId={1} owner members={[]} onMessage={() => undefined} onNavigate={() => undefined}><CommunityNavigation/><CommunityContent><div>Каналы</div></CommunityContent></CommunityProvider>)
  act(() => window.dispatchEvent(new CustomEvent('voxhold:open-direct', { detail: 2 })))
  const input = await screen.findByLabelText('Сообщение в беседу')
  fireEvent.change(input, { target: { value: 'hello' } }); fireEvent.click(screen.getByRole('button', { name: 'Отправить' }))
  await screen.findByRole('alert')
  const beforeRefresh = historyLoads
  act(() => window.dispatchEvent(new Event('focus')))
  await waitFor(() => expect(historyLoads).toBeGreaterThan(beforeRefresh))
  expect(screen.getByRole('alert')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Повторить отправку' }))
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
function UploadFixture({ onSend }: { onSend: (ids: string[]) => void | Promise<void> }) { const upload = useAttachmentUpload({ id: 2, server_id: 1, name: 'chat', kind: 'text', position: 0, created_by: 1, created_at: 1 }, true); return <section onPaste={upload.onPaste} onDrop={upload.onDrop} onDragOver={upload.onDragOver}>{upload.control}<button disabled={upload.preparing} onClick={() => { void upload.prepare().then(async (ids) => { await onSend(ids); upload.commit(ids) }).finally(upload.release) }}>Отправить набор</button></section> }
it('stages files until sending and retries upload with its original attachment key', async () => {
  const uploads: string[] = [], received = vi.fn(), messages = vi.fn()
  const api = fixture(({ path, onUploadProgress }) => { if (path.includes('/attachments/')) { uploads.push(path); if (uploads.length === 1) throw new Error('connection lost'); onUploadProgress?.(1); return { id: 'a', filename: 'a.txt', mime_type: 'text/plain', size_bytes: 2 } }; if (path.endsWith('/messages')) messages(); return defaults(path) })
  const { container } = render(<CommunityProvider api={api} token="test" userId={1} serverId={1} owner members={[]} onMessage={() => undefined} onNavigate={() => undefined}><UploadFixture onSend={received}/></CommunityProvider>)
  fireEvent.change(container.querySelector('input[type=file]')!, { target: { files: [new File(['hi'], 'a.txt', { type: 'text/plain' })] } }); fireEvent.click(await screen.findByRole('button', { name: 'Повторить' }))
  await screen.findByText(/Готово к отправке/)
  expect(received).not.toHaveBeenCalled(); expect(messages).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Отправить набор' }))
  await waitFor(() => expect(received).toHaveBeenCalledWith(['a'])); expect(uploads).toHaveLength(2); expect(uploads[0]).toBe(uploads[1])
})
it('renders a permanent server-removal placeholder without fetching deleted content', () => {
  render(<MessageAttachments attachments={[{ id: 'removed', filename: 'old.png', mime_type: 'image/png', size_bytes: 99, deleted: true }]}/>); expect(screen.getByText(/Вложение удалено сервером/)).toBeTruthy(); expect(screen.queryByRole('img')).toBeNull()
})

it('retains a pasted file for the next draft while a text message is being sent', async () => {
  let finish!: () => void
  const pending = new Promise<void>((resolve) => { finish = resolve })
  const received = vi.fn().mockImplementationOnce(() => pending)
  const api = fixture(({ path }) => path.includes('/attachments/') ? { id: 'next', filename: 'next.txt', mime_type: 'text/plain', size_bytes: 2 } : defaults(path))
  const { container } = render(<CommunityProvider api={api} token="test" userId={1} serverId={1} owner members={[]} onMessage={() => undefined} onNavigate={() => undefined}><UploadFixture onSend={received}/></CommunityProvider>)
  fireEvent.click(screen.getByRole('button', { name: 'Отправить набор' }))
  await waitFor(() => expect(received).toHaveBeenCalledWith([]))
  fireEvent.paste(container.querySelector('section')!, { clipboardData: { files: [new File(['hi'], 'next.txt', { type: 'text/plain' })] } })
  await screen.findByText(/Готово к отправке/)
  await act(async () => { finish(); await pending })
  expect(screen.getByText('next.txt')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Отправить набор' }))
  await waitFor(() => expect(received).toHaveBeenLastCalledWith(['next']))
})
it('snapshots the attachment batch before awaiting uploads and leaves later pastes unsent', async () => {
  let finish!: (value: unknown) => void
  const pending = new Promise((resolve) => { finish = resolve })
  const received = vi.fn()
  let uploadNumber = 0
  const realApi = fixture(({ path }) => path.includes('/attachments/') ? ++uploadNumber === 1 ? pending : { id: 'later', filename: 'later.txt', mime_type: 'text/plain', size_bytes: 2 } : defaults(path))
  const { container } = render(<CommunityProvider api={realApi} token="test" userId={1} serverId={1} owner members={[]} onMessage={() => undefined} onNavigate={() => undefined}><UploadFixture onSend={received}/></CommunityProvider>)
  fireEvent.change(container.querySelector('input[type=file]')!, { target: { files: [new File(['hi'], 'first.txt', { type: 'text/plain' })] } })
  await waitFor(() => expect(uploadNumber).toBe(1))
  fireEvent.click(screen.getByRole('button', { name: 'Отправить набор' }))
  fireEvent.paste(container.querySelector('section')!, { clipboardData: { files: [new File(['hi'], 'later.txt', { type: 'text/plain' })] } })
  await act(async () => { finish({ id: 'first', filename: 'first.txt', mime_type: 'text/plain', size_bytes: 2 }); await pending })
  await waitFor(() => expect(received).toHaveBeenCalledWith(['first']))
  expect(screen.queryByText('first.txt')).toBeNull()
  expect(screen.getByText('later.txt')).toBeTruthy()
  await screen.findByText(/Готово к отправке/)
  fireEvent.click(screen.getByRole('button', { name: 'Отправить набор' }))
  await waitFor(() => expect(received).toHaveBeenLastCalledWith(['later']))
})

it('does not poll lists and applies notification payloads without a list reload', async () => {
  const request = vi.fn(({ path }: { path: string }) => defaults(path))
  const api = fixture(request)
  render(<CommunityProvider api={api} token="test" userId={1} serverId={1} owner members={[]} onMessage={() => {}} onNavigate={() => {}}><CommunityNavigation/></CommunityProvider>)
  await waitFor(() => expect(request).toHaveBeenCalledTimes(4))
  const baseline = request.mock.calls.length
  vi.useFakeTimers()
  await act(async () => { await vi.advanceTimersByTimeAsync(45_000) })
  expect(request).toHaveBeenCalledTimes(baseline)
  act(() => window.dispatchEvent(new CustomEvent('voxhold:notification', { detail: { server_id: 1, channel_id: 2, server_name: 'Server', channel_name: 'General', mentioned: true, message: { id: 9, author: { user_id: 2, username: 'Bob' }, content: 'hello', created_at: 1 } } })))
  await act(async () => { await vi.advanceTimersByTimeAsync(1_000) })
  expect(request).toHaveBeenCalledTimes(baseline)
  act(() => window.dispatchEvent(new Event('voxhold:ready')))
  await act(async () => { await vi.advanceTimersByTimeAsync(500) })
  expect(request).toHaveBeenCalledTimes(baseline + 2)
  vi.useRealTimers()
})

it('does not create an active object URL for an SVG draft', async () => {
  const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:preview')
  const api = fixture(({ path }) => path.includes('/attachments/') ? { id: 'svg', filename: 'active.svg', mime_type: 'image/svg+xml', size_bytes: 6 } : defaults(path))
  const view = render(<CommunityProvider api={api} token="test" userId={1} serverId={1} owner members={[]} onMessage={() => undefined} onNavigate={() => undefined}><UploadFixture onSend={() => undefined}/></CommunityProvider>)
  fireEvent.change(view.container.querySelector('input[type=file]')!, { target: { files: [new File(['<svg/>'], 'active.svg', { type: 'image/svg+xml' })] } })
  await screen.findByText(/Готово к отправке/)
  expect(create).not.toHaveBeenCalled()
  create.mockRestore()

})

it('finishes a multi-page direct catch-up while further realtime revisions arrive', async () => {
  let historyLoads = 0, pausedSignal: AbortSignal | undefined, release!: (value: unknown) => void
  const pending = new Promise((resolve) => { release = resolve })
  const messages = Array.from({length:150},(_,n)=>({id:n+1,conversation_id:7,author:{user_id:2,username:'member'},content:`catchup-${n+1}`,client_message_id:String(n+1),created_at:1}))
  const api=fixture(({path,method,signal})=>{
    if(path.endsWith('/conversations') && method==='POST')return{id:7}
    if(path.endsWith('/conversations'))return[{id:7,direct:true,name:'Review',members:[],unread_count:0}]
    if(path.includes('/conversations/7/messages')){
      historyLoads++
      if(historyLoads===1)return{messages:messages.slice(0,50),has_more:false}
      if(historyLoads===2){pausedSignal=signal;return pending}
      const before=Number(new URL(path,'https://example.test').searchParams.get('before')??Infinity)
      const page=messages.filter((m)=>m.id<before).reverse()
      return{messages:page.slice(0,50),has_more:page.length>50}
    }
    return defaults(path)
  })
  render(<CommunityProvider api={api} token="test" userId={1} serverId={1} owner members={[]} onMessage={()=>undefined} onNavigate={()=>undefined}><CommunityContent><div>Channels</div></CommunityContent></CommunityProvider>)
  act(()=>window.dispatchEvent(new CustomEvent('voxhold:open-direct',{detail:2})))
  await screen.findByText('catchup-50')
  act(()=>window.dispatchEvent(new Event('voxhold:community')))
  await waitFor(()=>expect(historyLoads).toBe(2))
  act(()=>window.dispatchEvent(new Event('voxhold:community')))
  await act(async()=>{await new Promise((resolve)=>setTimeout(resolve,600))})
  expect(pausedSignal?.aborted).toBe(false)
  await act(async()=>release({messages:messages.slice(100).reverse(),has_more:true}))
  await screen.findByText('catchup-150')
  expect(screen.getByText('catchup-51')).toBeTruthy()
})
