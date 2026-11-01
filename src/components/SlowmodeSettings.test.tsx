import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { SlowmodeSettings } from './SlowmodeSettings'

it('loads the interval and saves a new one', async () => {
  const actions = { load: vi.fn().mockResolvedValue(0), save: vi.fn().mockResolvedValue(undefined) }
  render(<SlowmodeSettings actions={actions} channelId={1}/>)
  const select = await screen.findByRole('combobox')
  await waitFor(() => expect((select as HTMLSelectElement).disabled).toBe(false))
  fireEvent.change(select, { target: { value: '30' } })
  await waitFor(() => expect(actions.save).toHaveBeenCalledWith(30))
  expect((select as HTMLSelectElement).value).toBe('30')
})
