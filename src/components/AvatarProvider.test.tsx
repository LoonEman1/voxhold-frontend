// @vitest-environment jsdom
import { StrictMode } from 'react'
import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { Avatar } from './Avatar'
import { AvatarProvider, avatarChanged } from './AvatarProvider'
import type { VoxholdApi } from '../services/api'
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
it('shares visible avatar requests and invalidates/revokes old image URLs after updates', async () => {
  let next = 0
  vi.stubGlobal('IntersectionObserver', undefined)
  vi.stubGlobal('URL', { createObjectURL: vi.fn(() => `blob:avatar-${++next}`), revokeObjectURL: vi.fn() })
  const avatar = vi.fn(async () => new Blob(['image']))
  const api = { profile: { avatar } } as unknown as VoxholdApi
  const { container } = render(<StrictMode><AvatarProvider api={api} token="session"><Avatar userId={1} name="Alice"/><Avatar userId={1} name="Alice"/></AvatarProvider></StrictMode>)
  await waitFor(() => expect(container.querySelectorAll('img')).toHaveLength(2))
  expect(avatar).toHaveBeenCalledTimes(1)
  const old = container.querySelector('img')!.src
  avatarChanged(1)
  await waitFor(() => expect(container.querySelector('img')?.src).not.toBe(old))
  await waitFor(() => expect(container.querySelectorAll('img')).toHaveLength(2))
  expect(avatar).toHaveBeenCalledTimes(2)
  expect(URL.revokeObjectURL).toHaveBeenCalledWith(old)
})
