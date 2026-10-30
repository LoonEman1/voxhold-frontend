// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { createApi } from '../services/api'
import { CommunityProvider } from './Community'
import { MessageContextMenu } from './MessageContextMenu'
import { PollCard } from './CommunityFeatures'
import type { Poll } from '../domain/community'
afterEach(() => { cleanup(); vi.useRealTimers() })
it('refreshes conversations without refetching roles/privacy for every message', async()=>{
 const calls:string[]=[]
 const api=createApi({request:async<T,>({path}:{path:string})=>{calls.push(path);return{status:200,data:(path.endsWith('/message-privacy')?{mode:'shared',blocked_user_ids:[]}:path.endsWith('/inbox')?{items:[],has_more:false}:[])as T}}})
 render(<CommunityProvider api={api} token="test" userId={1} serverId={1} owner members={[]} onMessage={()=>undefined} onNavigate={()=>undefined}><div>Workspace</div></CommunityProvider>)
 await waitFor(()=>expect(calls.filter((v)=>v.endsWith('/roles')).length).toBe(1))
 const privacy=calls.filter((v)=>v.endsWith('/message-privacy')).length
 act(()=>window.dispatchEvent(new Event('voxhold:community')))
 await waitFor(()=>expect(calls.filter((v)=>v.split('?')[0]!.endsWith('/conversations')).length).toBe(2))
 expect(calls.filter((v)=>v.endsWith('/roles')).length).toBe(1)
 expect(calls.filter((v)=>v.endsWith('/message-privacy')).length).toBe(privacy)
 act(()=>window.dispatchEvent(new Event('voxhold:roles')))
 await waitFor(()=>expect(calls.filter((v)=>v.endsWith('/roles')).length).toBe(2))
})
it('ignores a queued unchanged scroll after opening a message menu, but closes when content moves',()=>{
 const close=vi.fn(), noop=()=>undefined
 render(<><div className="messages" data-testid="viewport"/><MessageContextMenu message={{id:1,channel_id:1,author:{user_id:1,username:'owner'},content:'saved',created_at:1,edited_at:null}} x={100} y={100} canEdit={false} canDelete={false} canPin={false} pinned={false} pending={{}} onClose={close} onReact={noop} onReply={noop} onEdit={noop} onPin={noop} onCopy={noop} onDelete={noop}/></>)
 const viewport=screen.getByTestId('viewport')
 fireEvent.scroll(viewport);expect(close).not.toHaveBeenCalled()
 viewport.scrollTop=20;fireEvent.scroll(viewport);expect(close).toHaveBeenCalledTimes(1)
})

it('updates polls through realtime without periodic requests or clearing an unsent choice', async () => {
  vi.useFakeTimers()
  const initial: Poll = { id: 7, question: 'Когда?', multiple: false, anonymous: true, closes_at: Date.now() / 1000 + 3600, revision: 1, options: [{ id: 10, label: 'Сегодня', count: 0, me: false }, { id: 11, label: 'Завтра', count: 0, me: false }] }
  const latest = { ...initial, revision: 2 }
  const request = vi.fn(async () => ({ status: 200, data: latest }))
  const api = createApi({ request: request as Parameters<typeof createApi>[0]['request'] })
  const view = render(<PollCard initial={initial} api={api} token="test"/>)
  fireEvent.click(screen.getByRole('radio', { name: /Сегодня/ }))
  await act(async () => { await vi.advanceTimersByTimeAsync(16_000) })
  expect(request).not.toHaveBeenCalled()
  view.rerender(<PollCard initial={latest} api={api} token="test"/>)
  expect((screen.getByRole('radio', { name: /Сегодня/ }) as HTMLInputElement).checked).toBe(true)
  await act(async () => { window.dispatchEvent(new CustomEvent('voxhold:feature-event', { detail: { type: 'community.poll', data: { poll_id: 7 } } })) })
  expect(request).toHaveBeenCalledOnce()
  expect((screen.getByRole('radio', { name: /Сегодня/ }) as HTMLInputElement).checked).toBe(true)
})
