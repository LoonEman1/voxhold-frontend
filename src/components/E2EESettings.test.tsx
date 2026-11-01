// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { E2EESettings } from './E2EESettings'

afterEach(cleanup)

it('loads the channel policy and saves the switch', async () => {
  const actions = { load: vi.fn(async () => false), save: vi.fn(async (required: boolean) => required) }
  render(<E2EESettings actions={actions} channelId={7}/>)
  const toggle = screen.getByRole('checkbox', { name: 'Требовать сквозное шифрование' })
  expect(toggle).toBeDisabled()
  await waitFor(() => expect(toggle).toBeEnabled())
  expect(toggle).not.toBeChecked()
  fireEvent.click(toggle)
  await waitFor(() => expect(toggle).toBeChecked())
  expect(actions.save).toHaveBeenCalledWith(true)
  expect(screen.getByText(/Видео трансляций не шифруется/)).toBeInTheDocument()
})

it('keeps the saved value and shows the error when saving fails', async () => {
  const actions = { load: vi.fn(async () => true), save: vi.fn(async () => { throw new Error('Недостаточно прав') }) }
  render(<E2EESettings actions={actions} channelId={7}/>)
  const toggle = screen.getByRole('checkbox', { name: 'Требовать сквозное шифрование' })
  await waitFor(() => expect(toggle).toBeChecked())
  fireEvent.click(toggle)
  expect(await screen.findByRole('alert')).toHaveTextContent('Недостаточно прав')
  expect(toggle).toBeChecked()
})
