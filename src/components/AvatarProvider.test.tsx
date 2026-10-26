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
  const tree = (versions: ReadonlyMap<number, string>) => <StrictMode><AvatarProvider api={api} token="session" versions={versions}><Avatar userId={1} name="Alice"/><Avatar userId={1} name="Alice"/><Avatar userId={2} name="Bob"/></AvatarProvider></StrictMode>
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
  await waitFor(() => expect(container.querySelectorAll('img')).toHaveLength(0))
})
