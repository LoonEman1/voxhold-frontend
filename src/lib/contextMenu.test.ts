// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'
import { preferNativeContextMenu } from './contextMenu'
afterEach(() => { window.getSelection()?.removeAllRanges(); document.body.replaceChildren() })
it('preserves native editing, links and the Shift override', () => {
  expect(preferNativeContextMenu({ target: document.createElement('textarea'), shiftKey: false })).toBe(true)
  const link = document.createElement('a'), icon = document.createElement('span'); link.href = 'https://example.test'; link.append(icon)
  expect(preferNativeContextMenu({ target: icon, shiftKey: false })).toBe(true)
  const target = document.createElement('p')
  expect(preferNativeContextMenu({ target, shiftKey: true })).toBe(true)
  expect(preferNativeContextMenu({ target, shiftKey: false })).toBe(false)
})
it('preserves copying selected message text', () => {
  const target = document.createElement('p'); target.textContent = 'copy selected text'; document.body.append(target)
  const range = document.createRange(); range.selectNodeContents(target); window.getSelection()!.addRange(range)
  expect(preferNativeContextMenu({ target, shiftKey: false })).toBe(true)
})
