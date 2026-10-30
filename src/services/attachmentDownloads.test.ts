import { expect, it } from 'vitest'
import { attachmentDownload } from './attachmentDownloads'
it('limits concurrent downloads and removes cancelled queued requests', async () => {
  let active = 0, maximum = 0, called = 0
  const finishes: (() => void)[] = []
  const controllers = Array.from({ length: 9 }, () => new AbortController())
  const tasks = controllers.map((controller) => attachmentDownload(controller.signal, async () => {
    called++; maximum = Math.max(maximum, ++active)
    await new Promise<void>((resolve) => finishes.push(resolve)); active--; return true
  }).catch(() => false))
  await Promise.resolve(); expect(called).toBe(4)
  controllers[8]!.abort()
  while (finishes.length || active) { finishes.splice(0).forEach((finish) => finish()); await new Promise<void>((resolve) => setTimeout(resolve, 0)) }
  const results = await Promise.all(tasks)
  expect(maximum).toBe(4); expect(called).toBe(8); expect(results.at(-1)).toBe(false)
})
