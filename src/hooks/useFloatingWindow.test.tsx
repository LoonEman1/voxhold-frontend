// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { constrainWindow, useFloatingWindow } from './useFloatingWindow'

beforeEach(() => {
  localStorage.clear(); vi.useFakeTimers()
  vi.stubGlobal('PointerEvent', class extends MouseEvent { pointerId: number; constructor(type: string, init: PointerEventInit = {}) { super(type, init); this.pointerId = init.pointerId ?? 1 } })
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

it('keeps windows outside navigation and inside even a very small viewport', () => {
  const bounds = constrainWindow({ x: -400, y: 1000, width: 800, height: 700 }, { width: 390, height: 600, left: 0, bottom: 63 })
  expect(bounds).toEqual({ x: 12, y: 12, width: 366, height: 513 })
  const desktop = constrainWindow({ x: 0, y: 10, width: 400, height: 300 }, { width: 1280, height: 900, left: 76, bottom: 0 })
  expect(desktop.x).toBe(88)
})

it('places previews above the mobile navigation and restores that position with Home', () => {
  vi.stubGlobal('innerWidth', 390); vi.stubGlobal('innerHeight', 700)
  function Fixture() {
    const floating = useFloatingWindow({ storageKey: 'preview-test', width: 360, height: 225, minHeight: 175, placement: 'bottom-right' })
    return <aside ref={floating.ref} style={floating.style} data-testid="preview"><button onKeyDown={floating.moveKey}>Move</button></aside>
  }
  render(<Fixture/>); act(() => vi.advanceTimersByTime(20))
  const preview = screen.getByTestId('preview')
  expect(Number.parseFloat(preview.style.top) + 225).toBe(700 - 63 - 12)
  const original = preview.style.top
  fireEvent.keyDown(screen.getByRole('button'), { key: 'ArrowUp' })
  expect(preview.style.top).not.toBe(original)
  fireEvent.keyDown(screen.getByRole('button'), { key: 'Home' })
  expect(preview.style.top).toBe(original)
})

it('moves without React renders on every pointer event and saves only the final bounds', () => {
  let renders = 0
  function Fixture() {
    renders++
    const window = useFloatingWindow({ storageKey: 'window-test', width: 400, height: 300 })
    return <aside ref={window.ref} style={window.style} data-testid="window"><button onPointerDown={window.beginMove} onKeyDown={window.moveKey}>Move</button></aside>
  }
  render(<Fixture/>); act(() => vi.advanceTimersByTime(20))
  const node = screen.getByTestId('window'), before = Number.parseFloat(node.style.left), initialRenders = renders
  const save = vi.spyOn(Storage.prototype, 'setItem')
  fireEvent.pointerDown(screen.getByRole('button'), { button: 0, pointerId: 1, clientX: 500, clientY: 100 })
  for (let i = 1; i <= 20; i++) fireEvent.pointerMove(window, { pointerId: 1, clientX: 500 - i * 2, clientY: 100 + i })
  act(() => vi.advanceTimersByTime(20))
  expect(Number.parseFloat(node.style.left)).toBe(before - 40)
  expect(renders).toBe(initialRenders)
  expect(save).not.toHaveBeenCalled()
  fireEvent.pointerUp(window, { pointerId: 1 })
  act(() => vi.advanceTimersByTime(160))
  expect(save).toHaveBeenCalledOnce()
  expect(document.body).not.toHaveClass('is-adjusting-window')
  const final = node.style.left
  fireEvent.pointerMove(window, { pointerId: 1, clientX: 0, clientY: 0 })
  act(() => vi.advanceTimersByTime(20))
  expect(node.style.left).toBe(final)
})

it('tolerates damaged storage, supports keyboard resizing and removes active drag handlers on unmount', () => {
  localStorage.setItem('window-test', '{bad json')
  function Fixture() {
    const window = useFloatingWindow({ storageKey: 'window-test', width: 400, height: 300 })
    return <aside ref={window.ref} style={window.style} data-testid="window"><button onPointerDown={window.beginResize} onKeyDown={window.resizeKey}>Resize</button></aside>
  }
  const { unmount } = render(<Fixture/>); act(() => vi.advanceTimersByTime(20))
  fireEvent.keyDown(screen.getByRole('button'), { key: 'ArrowRight', shiftKey: true })
  expect(screen.getByTestId('window').style.width).toBe('440px')
  fireEvent.pointerDown(screen.getByRole('button'), { button: 0, pointerId: 1 })
  expect(document.body).toHaveClass('is-adjusting-window')
  unmount()
  expect(document.body).not.toHaveClass('is-adjusting-window')
  const stored = localStorage.getItem('window-test')
  fireEvent.pointerMove(window, { pointerId: 1, clientX: 900, clientY: 900 })
  act(() => vi.advanceTimersByTime(200))
  expect(localStorage.getItem('window-test')).toBe(stored)
})
