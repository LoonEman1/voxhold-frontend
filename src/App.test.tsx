// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useEffect } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import type { VoxholdApi } from './services/api'

const fixture = vi.hoisted(() => ({ auth: { ready: true, token: 'old' }, mounts: vi.fn(), unmounts: vi.fn() }))
vi.mock('./auth/AuthContext', () => ({ useAuth: () => fixture.auth, AuthProvider: ({ children }: { children: unknown }) => children }))
vi.mock('./platform/clientDiagnostics', () => ({ clientDiagnostics: { configure: vi.fn(), record: vi.fn() } }))
vi.mock('./pages/WorkspacePage', () => ({ WorkspacePage: function Workspace() { useEffect(() => { fixture.mounts(); return () => fixture.unmounts() }, []); return <p>Workspace mounted</p> } }))
vi.mock('./components/InviteAppPrompt', () => ({ InviteAppPrompt: ({ onStayInBrowser }: { onStayInBrowser(): void }) => <button onClick={onStayInBrowser}>Stay in browser</button> }))
import { AppRouter } from './App'

afterEach(() => { cleanup(); fixture.mounts.mockClear(); fixture.unmounts.mockClear(); fixture.auth.token = 'old'; window.history.replaceState(null, '', '/') })
it('keeps accepted workspace mounted during rotation and responds to new invite hashes', async () => {
  window.history.replaceState(null, '', '#/invite/one')
  const resolve = vi.fn(async () => ({ server_name: 'Server', creator_username: 'Owner', expires_at: Date.now() / 1000 + 3600 }))
  const accept = vi.fn(async () => ({}))
  const api = { inviteLinks: { resolve, accept } } as unknown as VoxholdApi
  const view = render(<AppRouter api={api}/>)
  fireEvent.click(await screen.findByRole('button', { name: 'Stay in browser' }))
  await screen.findByText('Workspace mounted')
  expect(fixture.mounts).toHaveBeenCalledOnce()
  expect(window.location.hash).toBe('')
  fixture.auth.token = 'rotated'
  view.rerender(<AppRouter api={api}/>)
  expect(fixture.mounts).toHaveBeenCalledOnce()
  expect(fixture.unmounts).not.toHaveBeenCalled()
  await act(async () => { window.location.hash = '#/invite/two'; window.dispatchEvent(new HashChangeEvent('hashchange')) })
  await waitFor(() => expect(resolve).toHaveBeenLastCalledWith('two', expect.any(AbortSignal)))
  expect(await screen.findByRole('button', { name: 'Stay in browser' })).toBeTruthy()
})
