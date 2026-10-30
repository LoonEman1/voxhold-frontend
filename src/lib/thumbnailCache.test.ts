import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { acquireThumbnail, clearThumbnails, dropThumbnail, releaseThumbnail, storeThumbnail } from './thumbnailCache'
let next = 0
const revoke = vi.fn()
beforeEach(() => { next = 0; revoke.mockClear(); vi.stubGlobal('URL', { createObjectURL: () => `blob:${++next}`, revokeObjectURL: revoke }) })
afterEach(() => { clearThumbnails(); vi.unstubAllGlobals() })
const blob = new Blob(['jpeg'], { type: 'image/jpeg' })

it('shares leases and revokes stale entries only after their last user leaves', () => {
  const url = storeThumbnail('a', blob)
  expect(acquireThumbnail('a')).toBe(url)
  releaseThumbnail('a'); dropThumbnail('a')
  expect(acquireThumbnail('a')).toBeNull(); expect(revoke).not.toHaveBeenCalled()
  expect(() => storeThumbnail('a', blob)).toThrow(/удалено/)
  releaseThumbnail('a'); expect(revoke).toHaveBeenCalledWith(url)
})
it('keeps 80 unused entries in LRU order without evicting active ones', () => {
  const active = storeThumbnail('active', blob)
  for (let i = 0; i < 81; i++) { storeThumbnail(String(i), blob); releaseThumbnail(String(i)) }
  expect(acquireThumbnail('0')).toBeNull()
  expect(acquireThumbnail('1')).not.toBeNull(); releaseThumbnail('1')
  storeThumbnail('81', blob); releaseThumbnail('81')
  expect(acquireThumbnail('2')).toBeNull()
  expect(acquireThumbnail('active')).toBe(active)
})
it('deduplicates concurrent stores and separates account/instance keys', () => {
  const url = storeThumbnail('instanceA:1:file', blob)
  expect(storeThumbnail('instanceA:1:file', blob)).toBe(url)
  expect(storeThumbnail('instanceA:2:file', blob)).not.toBe(url)
  expect(storeThumbnail('instanceB:1:file', blob)).not.toBe(url)
  releaseThumbnail('instanceA:1:file'); releaseThumbnail('instanceA:1:file')
  expect(revoke).not.toHaveBeenCalled()
  clearThumbnails(); expect(revoke).toHaveBeenCalledTimes(3)
})
