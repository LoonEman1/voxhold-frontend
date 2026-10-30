import { expect, it, vi } from 'vitest'
import { attachmentRequest } from './attachmentRequests'

it('bounds concurrent requests and cancels a queued download without starting it', async () => {
  let finish!: () => void
  const pending = new Promise<void>((resolve) => { finish = resolve })
  const live = new AbortController(), cancelled = new AbortController()
  const first = attachmentRequest(live.signal, () => pending)
  const second = attachmentRequest(live.signal, () => pending)
  const load = vi.fn(async () => {})
  const queued = attachmentRequest(cancelled.signal, load)
  cancelled.abort()
  await expect(queued).rejects.toMatchObject({ name: 'AbortError' })
  expect(load).not.toHaveBeenCalled()
  finish(); await Promise.all([first, second])
  await attachmentRequest(live.signal, load)
  expect(load).toHaveBeenCalledOnce()
})
