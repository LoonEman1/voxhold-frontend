// @vitest-environment jsdom
import { StrictMode } from 'react'
import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { Avatar } from './Avatar'
import { AvatarProvider } from './AvatarProvider'
import type { VoxholdApi } from '../services/api'
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
it('fetches only known avatar versions, shares requests and revokes replaced image URLs', async () => {
  let next = 0
  vi.stubGlobal('IntersectionObserver', undefined)
  vi.stubGlobal('URL', { createObjectURL: vi.fn(() => `blob:avatar-${++next}`), revokeObjectURL: vi.fn() })
  const avatar = vi.fn<VoxholdApi['profile']['avatar']>(async () => new Blob(['image']))
  const api = { profile: { avatar } } as unknown as VoxholdApi
  const tree = (versions: ReadonlyMap<number, string | null>) => <StrictMode><AvatarProvider api={api} token="session" versions={versions}><Avatar userId={1} name="Alice"/><Avatar userId={1} name="Alice"/><Avatar userId={2} name="Bob"/></AvatarProvider></StrictMode>
  const { container, rerender } = render(tree(new Map([[1, 'v1']])))
  await waitFor(() => expect(container.querySelectorAll('img')).toHaveLength(2))
  // Bob has no avatar: initials, and no 404 probe.
  expect(avatar.mock.calls.filter(([, id]) => id === 2)).toHaveLength(0)
  expect(avatar.mock.calls.filter(([, id, version, signal]) => id === 1 && version === 'v1' && !signal?.aborted)).toHaveLength(1)
  const old = container.querySelector('img')!.src
  rerender(tree(new Map([[1, 'v2']])))
  await waitFor(() => expect(container.querySelector('img')?.src).not.toBe(old))
  expect(container.querySelectorAll('img')).toHaveLength(2)
  expect(avatar).toHaveBeenLastCalledWith('session', 1, 'v2', expect.any(AbortSignal))
  expect(URL.revokeObjectURL).toHaveBeenCalledWith(old)
  rerender(tree(new Map()))
  expect(container.querySelectorAll('img')).toHaveLength(2)
  rerender(tree(new Map([[1, null]])))
  await waitFor(() => expect(container.querySelectorAll('img')).toHaveLength(0))
})

it('retains cached avatars during token rotation and uses the latest token for new versions', async () => {
  vi.stubGlobal('IntersectionObserver', undefined)
  let next = 0
  vi.stubGlobal('URL', { createObjectURL: vi.fn(() => `blob:version-${++next}`), revokeObjectURL: vi.fn() })
  const avatar = vi.fn<VoxholdApi['profile']['avatar']>(async () => new Blob(['image'], { type: 'image/png' }))
  const api = { profile: { avatar } } as unknown as VoxholdApi
  const tree = (token: string, version: string, userId = 1) => <AvatarProvider api={api} token={token} userId={userId} versions={new Map([[1, version]])}><Avatar userId={1} name="Alice"/></AvatarProvider>
  const view = render(tree('old', 'v1'))
  await waitFor(() => expect(view.container.querySelector('img')).toBeTruthy())
  const url = view.container.querySelector('img')!.src
  view.rerender(tree('new', 'v1'))
  expect(view.container.querySelector('img')!.src).toBe(url)
  expect(avatar).toHaveBeenCalledOnce()
  view.rerender(tree('new', 'v2'))
  await waitFor(() => expect(avatar).toHaveBeenLastCalledWith('new', 1, 'v2', expect.any(AbortSignal)))
  view.rerender(tree('other-account', 'v2', 2))
  await waitFor(() => expect(avatar).toHaveBeenLastCalledWith('other-account', 1, 'v2', expect.any(AbortSignal)))
  expect(URL.revokeObjectURL).toHaveBeenCalledWith(url)
})
