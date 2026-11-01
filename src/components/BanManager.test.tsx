// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { BanManager } from './BanManager'
import type { VoxholdApi } from '../services/api'

it('lists bans with reasons and unbans after confirmation', async () => {
  const listBans = vi.fn()
    .mockResolvedValueOnce([{ user_id: 7, username: 'spammer', banned_by: 1, reason: 'spam', created_at: 1700000000 }])
    .mockResolvedValueOnce([])
  const unbanMember = vi.fn().mockResolvedValue(undefined)
  const api = { servers: { listBans, unbanMember } } as unknown as VoxholdApi
  render(<BanManager api={api} token="t" serverId={1}/>)
  expect(await screen.findByText('spam')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Разбанить' }))
  const buttons = await screen.findAllByRole('button', { name: 'Разбанить' })
  fireEvent.click(buttons[buttons.length - 1]!)
  await waitFor(() => expect(unbanMember).toHaveBeenCalledWith('t', 1, 7))
  await screen.findByText('Заблокированных пользователей нет.')
})
