// @vitest-environment jsdom
import { StrictMode } from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { AuthProvider, useAuth } from './AuthContext'
import type { AuthPayload, Session } from '../domain/types'
import type { VoxholdApi } from '../services/api'
import { notifyUnauthorized } from '../services/authEvents'

const user = { id: 1, username: 'Alice', created_at: 1 }
const session = (token: string, seconds = 3600): Session => ({ token, expires_at: Math.floor(Date.now()/1000)+seconds })
function deferred<T>() { let resolve!: (value:T) => void; let reject!: (reason: unknown) => void; const promise = new Promise<T>((a,b) => { resolve=a; reject=b }); return { promise,resolve,reject } }
let auth!: ReturnType<typeof useAuth>
function Probe() { auth = useAuth(); return <p>{auth.ready ? auth.token ?? 'out' : 'loading'}</p> }
afterEach(() => { cleanup(); vi.useRealTimers() })
function mount(seconds=60, strict=false) {
  const pending = deferred<Session>()
  const refresh = vi.fn(() => pending.promise)
  const login = vi.fn(async () => ({ user, session: session('login') }))
  let stored: AuthPayload | null = {user,session:session('old',seconds)}
  const storage = {read: <T,>() => stored as T | null, write: (_key:string,value:unknown) => {stored=value as AuthPayload}, remove: () => {stored=null} }
  const api = {auth:{refresh,login,logout:vi.fn(async()=>{})}} as unknown as VoxholdApi
  const provider=<AuthProvider api={api} storage={storage}><Probe/></AuthProvider>
  const view=render(strict ? <StrictMode>{provider}</StrictMode> : provider)
  return {pending,refresh,view,stored:()=>stored}
}
it.each([false,true])('rotates once during startup, including StrictMode=%s', async(strict) => {
  const m=mount(60,strict)
  expect(m.refresh).toHaveBeenCalledTimes(1)
  await act(async()=>m.pending.resolve(session('new')))
  expect(screen.getByText('new')).toBeTruthy()
  expect(m.stored()?.session.token).toBe('new')
  act(()=>notifyUnauthorized('old'))
  expect(auth.token).toBe('new')
  act(()=>notifyUnauthorized('new'))
  expect(auth.token).toBeNull()
})
it.each(['success','failure'])('does not revive a logged-out session after refresh %s',async(outcome)=>{
  const m=mount()
  await act(()=>auth.logout())
  await act(async()=>{ if(outcome==='success') m.pending.resolve(session('new')); else m.pending.reject(new Error('401')) })
  expect(auth.token).toBeNull(); expect(m.stored()).toBeNull()
})
it('ignores refresh and late 401 after a new login',async()=>{
  const m=mount()
  await act(()=>auth.login('Alice','password'))
  act(()=>notifyUnauthorized('old'))
  await act(async()=>m.pending.reject(new Error('401')))
  expect(auth.token).toBe('login'); expect(m.stored()?.session.token).toBe('login')
})
it('does not write an unmounted provider',async()=>{
  const m=mount(); m.view.unmount()
  await act(async()=>m.pending.resolve(session('new')))
  expect(m.stored()?.session.token).toBe('old')
})
it('expires an already expired session without rotation',()=>{
  const m=mount(-1)
  expect(m.refresh).not.toHaveBeenCalled(); expect(auth.token).toBeNull()
})
it('schedules long sessions without overflowing browser timers',async()=>{
  vi.useFakeTimers()
  const m=mount(30*86400)
  expect(m.refresh).not.toHaveBeenCalled()
  await act(async()=>vi.advanceTimersByTimeAsync((30*86400-300)*1000))
  expect(m.refresh).toHaveBeenCalledTimes(1)
  await act(async()=>m.pending.resolve(session('new')))
  expect(auth.token).toBe('new')
})

it('waits for an in-flight rotation before accepting an old-token 401', async () => {
  const m = mount()
  act(() => notifyUnauthorized('old'))
  expect(auth.token).toBe('old')
  await act(async () => m.pending.resolve(session('new')))
  expect(auth.token).toBe('new')
  expect(m.stored()?.session.token).toBe('new')
})
it('waits for a rotation in another tab before expiring', async () => {
  let stored: AuthPayload | null = { user, session: session('old') }
  const lock = deferred<void>()
  const storage = {
    read: <T,>() => stored as T | null,
    write: (_key: string, value: unknown) => { stored = value as AuthPayload },
    remove: () => { stored = null },
    withLock: async <T,>(_key: string, action: () => Promise<T>) => { await lock.promise; return action() },
  }
  render(<AuthProvider api={{ auth: {} } as VoxholdApi} storage={storage}><Probe/></AuthProvider>)
  act(() => notifyUnauthorized('old'))
  expect(auth.token).toBe('old')
  stored = { user, session: session('other-tab') }
  await act(async () => lock.resolve())
  expect(auth.token).toBe('other-tab')
})
it('retains a valid session and retries transient refresh failures', async () => {
  vi.useFakeTimers()
  const m = mount()
  const { ApiError } = await import('../services/api')
  m.refresh.mockImplementationOnce(async () => session('recovered'))
  await act(async () => m.pending.reject(new ApiError('temporarily unavailable', 503)))
  expect(auth.token).toBe('old')
  await act(async () => vi.advanceTimersByTimeAsync(1_000))
  expect(auth.token).toBe('recovered')
})
