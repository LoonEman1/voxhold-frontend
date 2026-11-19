import { ApiError } from '../services/api'
// @vitest-environment jsdom
import { StrictMode } from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { AuthProvider, useAuth } from './AuthContext'
import type { AuthPayload, Session } from '../domain/types'
import type { VoxholdApi } from '../services/api'
import { notifyUnauthorized } from '../services/authEvents'
import { createBrowserSessionStorage } from '../platform/transport'

const user = { id: 1, username: 'Alice', created_at: 1 }
const session = (token: string, seconds = 3600): Session => ({ token, expires_at: Math.floor(Date.now()/1000)+seconds })
function deferred<T>() { let resolve!: (value:T) => void; let reject!: (reason: unknown) => void; const promise = new Promise<T>((a,b) => { resolve=a; reject=b }); return { promise,resolve,reject } }
let auth!: ReturnType<typeof useAuth>
function Probe() { auth = useAuth(); return <p>{auth.ready ? auth.token ?? 'out' : 'loading'}</p> }
afterEach(() => { cleanup(); vi.useRealTimers(); localStorage.clear(); sessionStorage.clear() })

function browserTab() {
  const data = new Map<string, string>()
  return createBrowserSessionStorage(() => ({
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => { data.set(key, value) },
  }))
}

it('switches accounts in the current tab and scopes refresh and logout to that account', async () => {
  const key = 'voxhold.session.v1'
  const primary = { user, session: session('primary') }
  const alternate = { user: { ...user, id: 2, username: 'Bob' }, session: session('alternate') }
  const api = { auth: { login: vi.fn(async () => alternate), logout: vi.fn(async () => undefined) } } as unknown as VoxholdApi
  localStorage.setItem(key, JSON.stringify(primary))
  const mainStorage = browserTab(), secondStorage = browserTab()
  const main = render(<AuthProvider api={api} storage={mainStorage}><Probe/></AuthProvider>)
  const tab = render(<AuthProvider api={api} storage={secondStorage}><Probe/></AuthProvider>)
  expect(screen.getAllByText('primary')).toHaveLength(2)
  await act(() => auth.switchAccount())
  expect(screen.getByText('out')).toBeTruthy()
  expect(screen.getByText('primary')).toBeTruthy()
  await act(() => auth.login('Bob', 'password'))
  expect(screen.getByText('primary')).toBeTruthy()
  expect(screen.getByText('alternate')).toBeTruthy()
  const renewed = { ...alternate, session: session('renewed') }
  secondStorage.write(key, renewed)
  act(() => window.dispatchEvent(new StorageEvent('storage', { key: `${key}.account.2`, storageArea: localStorage })))
  expect(screen.getByText('renewed')).toBeTruthy()
  expect(mainStorage.read(key)).toEqual(primary)
  await act(() => auth.logout())
  expect(api.auth.logout).toHaveBeenCalledWith('renewed')
  expect(screen.getByText('primary')).toBeTruthy()
  expect(secondStorage.read(key)).toBeNull()
  expect(mainStorage.read(key)).toEqual(primary)
  tab.unmount()
  main.unmount()
})

it('lets two initially signed-out ordinary tabs complete different logins in parallel', async () => {
  const alternate = { user: { ...user, id: 2, username: 'Bob' }, session: session('alternate') }
  const pending = deferred<AuthPayload>()
  const api = { auth: { login: vi.fn((name: string) => name === 'Bob'
    ? pending.promise : Promise.resolve({ user, session: session('primary') })) } } as unknown as VoxholdApi
  render(<AuthProvider api={api} storage={browserTab()}><Probe/></AuthProvider>)
  const firstLogin = auth.login
  render(<AuthProvider api={api} storage={browserTab()}><Probe/></AuthProvider>)
  const secondLogin = auth.login
  act(() => { void secondLogin('Bob', 'password') })
  await act(() => firstLogin('Alice', 'password'))
  act(() => window.dispatchEvent(new StorageEvent('storage', { key: 'voxhold.session.v1.account.1', storageArea: localStorage })))
  await act(async () => pending.resolve(alternate))
  expect(screen.getByText('primary')).toBeTruthy()
  expect(screen.getByText('alternate')).toBeTruthy()
})
it('finishes an in-flight refresh before switching away from a session shared with another tab', async () => {
  const key = 'voxhold.session.v1'
  const pending = deferred<Session>()
  const refresh = vi.fn(() => pending.promise)
  const api = { auth: { refresh } } as unknown as VoxholdApi
  localStorage.setItem(key, JSON.stringify({ user, session: session('primary', 60) }))
  const otherTab = browserTab()
  otherTab.read(key)
  render(<AuthProvider api={api} storage={browserTab()}><Probe/></AuthProvider>)
  expect(refresh).toHaveBeenCalledOnce()
  const switching = auth.switchAccount()
  await act(async () => { pending.resolve(session('renewed')); await switching })
  expect(screen.getByText('out')).toBeTruthy()
  expect(otherTab.read<AuthPayload>(key)?.session.token).toBe('renewed')
})

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

it.each([0,429,503])('retains a valid session after refresh status %s and retries', async (status) => {
  vi.useFakeTimers()
  const m=mount(60,true)
  await act(async () => m.pending.reject(new ApiError('temporary',status)))
  expect(auth.token).toBe('old'); expect(m.stored()?.session.token).toBe('old')
  m.refresh.mockResolvedValue(session('renewed'))
  await act(async () => vi.advanceTimersByTimeAsync(1000))
  expect(auth.token).toBe('renewed')
})
it('expires confirmed unauthorized refresh and does not retry', async () => {
  const m=mount(60)
  await act(async () => m.pending.reject(new ApiError('unauthorized',401)))
  expect(auth.token).toBeNull(); expect(m.stored()).toBeNull()
})

it('adopts the new token when the old WebSocket is revoked before refresh returns', async () => {
  const m=mount(60)
  act(() => notifyUnauthorized('old'))
  expect(auth.token).toBe('old')
  await act(async () => m.pending.resolve(session('rotated')))
  expect(auth.token).toBe('rotated'); expect(m.stored()?.session.token).toBe('rotated')
})
