// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { Modal } from './Modal'

describe('Modal', () => {
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    document.body.classList.remove('modal-open')
  })

  it('does not steal focus again when parent state creates a new onClose callback', () => {
    vi.useFakeTimers()
    const first = render(<Modal open title="Настройки" onClose={() => undefined}><input aria-label="Устройство"/></Modal>)
    act(() => vi.runAllTimers())
    const input = first.getByLabelText('Устройство')
    input.focus()

    first.rerender(<Modal open title="Настройки" onClose={() => undefined}><input aria-label="Устройство"/></Modal>)
    act(() => vi.runAllTimers())

    expect(document.activeElement).toBe(input)
  })
})

function Nested({ initial = false }: { initial?: boolean }) {
  const [outer, setOuter] = useState(true), [inner, setInner] = useState(initial)
  return <><button>Фон</button><Modal open={outer} title="Внешняя" onClose={() => setOuter(false)}><button onClick={() => setInner(true)}>Открыть внутреннюю</button><button disabled>Недоступная</button><Modal open={inner} title="Внутренняя" onClose={() => setInner(false)}><button>Последняя</button></Modal></Modal></>
}
it('closes only the top modal and restores focus without unlocking its parent', () => {
  render(<Nested/>)
  const trigger = screen.getByRole('button', { name: 'Открыть внутреннюю' }); trigger.focus(); fireEvent.click(trigger)
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(screen.queryByRole('dialog', { name: 'Внутренняя' })).toBeNull()
  expect(screen.getByRole('dialog', { name: 'Внешняя' })).toBeTruthy()
  expect(document.body.classList.contains('modal-open')).toBe(true)
  expect(document.activeElement).toBe(trigger)
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(document.body.classList.contains('modal-open')).toBe(false)
  cleanup()
})
it('orders initially nested modals correctly and cycles Tab inside the top one', () => {
  vi.useFakeTimers()
  render(<Nested initial/>)
  act(() => vi.runAllTimers())
  const inner = screen.getByRole('dialog', { name: 'Внутренняя' })
  const first = inner.querySelector('button')!, last = screen.getByRole('button', { name: 'Последняя' })
  expect(document.activeElement).toBe(first)
  last.focus(); fireEvent.keyDown(document, { key: 'Tab' }); expect(document.activeElement).toBe(first)
  fireEvent.keyDown(document, { key: 'Tab', shiftKey: true }); expect(document.activeElement).toBe(last)
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(screen.queryByRole('dialog', { name: 'Внутренняя' })).toBeNull()
  expect(screen.getByRole('dialog', { name: 'Внешняя' })).toBeTruthy()
  cleanup(); vi.useRealTimers()
})
