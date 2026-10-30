// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { downloadBlob } from './downloadBlob'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })
it('retains the object URL until the browser has acquired the download', () => {
  vi.useFakeTimers()
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:download'), revokeObjectURL: vi.fn() })
  downloadBlob(new Blob(['data']), 'diagnostics.json')
  expect(click).toHaveBeenCalledOnce()
  expect(document.querySelector('a[download]')).toBeNull()
  vi.advanceTimersByTime(59_999)
  expect(URL.revokeObjectURL).not.toHaveBeenCalled()
  vi.advanceTimersByTime(1)
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:download')
})
