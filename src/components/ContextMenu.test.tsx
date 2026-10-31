// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ContextMenu } from './ContextMenu'
afterEach(cleanup)
it('focuses enabled items, supports arrow/home/end navigation and restores focus on Escape', () => {
  const trigger = document.createElement('button'); document.body.append(trigger); trigger.focus()
  const close = vi.fn()
  const result = render(<ContextMenu menu={{ x: 20, y: 20, items: [
    { key: 'a', kind: 'action', label: 'Первый', onSelect: vi.fn() },
    { key: 'disabled', kind: 'action', label: 'Недоступный', disabled: true, onSelect: vi.fn() },
    { key: 'b', kind: 'action', label: 'Последний', onSelect: vi.fn() },
  ] }} onClose={close}/>)
  const first = screen.getByRole('menuitem', { name: 'Первый' }), last = screen.getByRole('menuitem', { name: 'Последний' })
  expect(document.activeElement).toBe(first)
  fireEvent.keyDown(first, { key: 'ArrowDown' }); expect(document.activeElement).toBe(last)
  fireEvent.keyDown(last, { key: 'ArrowDown' }); expect(document.activeElement).toBe(first)
  fireEvent.keyDown(first, { key: 'End' }); expect(document.activeElement).toBe(last)
  fireEvent.keyDown(last, { key: 'Home' }); expect(document.activeElement).toBe(first)
  fireEvent.keyDown(first, { key: 'ArrowUp' }); expect(document.activeElement).toBe(last)
  fireEvent.keyDown(last, { key: 'Escape' }); expect(close).toHaveBeenCalledOnce()
  result.unmount(); expect(document.activeElement).toBe(trigger); trigger.remove()
})
