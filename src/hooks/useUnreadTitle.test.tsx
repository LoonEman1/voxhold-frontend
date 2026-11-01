// @vitest-environment jsdom
import { renderHook } from '@testing-library/react'
import { expect, it } from 'vitest'
import { unreadTitle, useUnreadTitle } from './useUnreadTitle'

it('formats the title for mentions, plain unread and nothing', () => {
  expect(unreadTitle(0, 0)).toBe('Voxhold')
  expect(unreadTitle(5, 0)).toBe('• Voxhold')
  expect(unreadTitle(5, 3)).toBe('(3) Voxhold')
  expect(unreadTitle(500, 120)).toBe('(99+) Voxhold')
})

it('updates document.title and restores it on unmount', () => {
  const { rerender, unmount } = renderHook(({ count, mentions }) => useUnreadTitle(count, mentions), { initialProps: { count: 0, mentions: 0 } })
  expect(document.title).toBe('Voxhold')
  rerender({ count: 2, mentions: 1 })
  expect(document.title).toBe('(1) Voxhold')
  unmount()
  expect(document.title).toBe('Voxhold')
})
