// @vitest-environment jsdom
import { act, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Modal } from './Modal'

describe('Modal', () => {
  afterEach(() => {
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
