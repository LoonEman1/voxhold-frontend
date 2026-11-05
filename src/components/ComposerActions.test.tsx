// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ComposerAttachmentButton, ComposerSendButton } from './ComposerActions'

beforeEach(() => vi.stubGlobal('PointerEvent', MouseEvent))
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals() })

it('opens four actions without submitting and supports keyboard selection and Escape', () => {
  const submit = vi.fn(), attach = vi.fn(), schedule = vi.fn()
  render(<form onSubmit={(event) => { event.preventDefault(); submit() }}><ComposerAttachmentButton onAttach={attach} onPoll={vi.fn()} onSchedule={schedule} onScheduled={vi.fn()}/></form>)
  const trigger = screen.getByRole('button', { name: 'Добавить к сообщению' })
  fireEvent.click(trigger)
  expect(screen.getAllByRole('menuitem')).toHaveLength(4)
  expect(document.activeElement).toBe(screen.getAllByRole('menuitem')[0])
  fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' })
  expect(document.activeElement).toBe(screen.getAllByRole('menuitem')[1])
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
  expect(screen.queryByRole('menu')).toBeNull()
  expect(document.activeElement).toBe(trigger)
  fireEvent.click(trigger); fireEvent.click(screen.getByRole('menuitem', { name: /Прикрепить файл/ }))
  expect(attach).toHaveBeenCalledOnce(); expect(submit).not.toHaveBeenCalled()
})

it('sends a normal click but suppresses sending after a long press', () => {
  vi.useFakeTimers()
  const submit = vi.fn(), schedule = vi.fn()
  render(<form onSubmit={(event) => { event.preventDefault(); submit() }}><ComposerSendButton disabled={false} onSchedule={schedule}>Send</ComposerSendButton></form>)
  const trigger = screen.getByRole('button', { name: 'Отправить' })
  fireEvent.click(trigger); expect(submit).toHaveBeenCalledOnce(); submit.mockClear()
  fireEvent.pointerDown(trigger, { button: 0 })
  act(() => vi.advanceTimersByTime(450))
  expect(screen.getByRole('menu')).toBeTruthy()
  fireEvent.pointerUp(trigger); fireEvent.click(trigger)
  expect(submit).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('menuitem', { name: /Отложить сообщение/ }))
  expect(schedule).toHaveBeenCalledOnce(); expect(submit).not.toHaveBeenCalled()
})

it('cancels a pending hold when the pointer leaves and offers a keyboard alternative', () => {
  vi.useFakeTimers()
  render(<ComposerSendButton disabled={false} onSchedule={vi.fn()}>Send</ComposerSendButton>)
  const trigger = screen.getByRole('button', { name: 'Отправить' })
  fireEvent.pointerDown(trigger, { button: 0 }); fireEvent.pointerLeave(trigger)
  act(() => vi.advanceTimersByTime(600))
  expect(screen.queryByRole('menu')).toBeNull()
  fireEvent.keyDown(trigger, { key: 'ArrowUp' })
  expect(screen.getByRole('menu')).toBeTruthy()
  fireEvent.pointerDown(document.body)
  expect(screen.queryByRole('menu')).toBeNull()
})
