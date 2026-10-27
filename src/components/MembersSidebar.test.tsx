// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Channel, ServerMember } from '../domain/types'
import { MembersSidebar, type ChannelMemberLoader } from './MembersSidebar'

afterEach(cleanup)
const members = [
  { user_id: 1, username: 'Alice', role: 'owner' },
  { user_id: 2, username: 'Bob', role: 'admin' },
  { user_id: 3, username: 'Carol', role: 'member' },
] as ServerMember[]
const channel = { id: 1, server_id: 1, name: 'Private voice', kind: 'voice' } as Channel
function props(loader: ChannelMemberLoader) {
  return { channel, members, onlineUserIds: new Set([1, 2]), onLoadMembers: loader, onClose: vi.fn(), onOpenProfile: vi.fn(), onMemberContextMenu: vi.fn() }
}
describe('channel and server member lists', () => {
  it('shows permitted users including offline users, retains all users and only presence dots', async () => {
    const onLoadMembers = vi.fn(async () => ({ user_ids: [1, 3] }))
    const handlers = props(onLoadMembers)
    const { container } = render(<MembersSidebar {...handlers}/>)
    const panel = screen.getByRole('tabpanel')
    await waitFor(() => expect(within(panel).getAllByRole('button')).toHaveLength(2))
    expect(panel.textContent).toContain('Carol')
    expect(panel.textContent).not.toContain('Bob')
    expect(within(panel).getByLabelText('Не в сети')).toBeTruthy()
    expect(container.querySelector('.role-dot')).toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: 'Все участники' }))
    expect(within(panel).getAllByRole('button')).toHaveLength(3)
    fireEvent.click(within(panel).getByText('Bob'))
    expect(handlers.onOpenProfile).toHaveBeenCalledWith(members[1])
    fireEvent.contextMenu(within(panel).getByText('Carol'))
    expect(handlers.onMemberContextMenu).toHaveBeenCalled()
    expect(onLoadMembers).toHaveBeenCalledTimes(1)
  })
  it('never substitutes the whole server on a denied roster and allows retry', async () => {
    const loader = vi.fn().mockRejectedValueOnce(new Error('Доступ закрыт')).mockResolvedValue({ user_ids: [2] })
    render(<MembersSidebar {...props(loader)}/>)
    expect((await screen.findByRole('alert')).textContent).toContain('Доступ закрыт')
    expect(screen.queryByText('Alice')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }))
    await screen.findByText('Bob')
    expect(screen.queryByText('Alice')).toBeNull()
  })
  it('ignores a late response from the previous channel and refreshes on membership changes', async () => {
    let resolveFirst!: (value: { user_ids: number[] }) => void
    const loader = vi.fn().mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve })).mockResolvedValue({ user_ids: [2] })
    const initial = props(loader)
    const { rerender } = render(<MembersSidebar {...initial}/>)
    rerender(<MembersSidebar {...initial} channel={{ ...channel, id: 2, kind: 'text' }}/>)
    await screen.findByText('Bob')
    expect(loader.mock.calls[0]![1].aborted).toBe(true)
    await act(async () => resolveFirst({ user_ids: [1, 3] }))
    expect(screen.queryByText('Carol')).toBeNull()
    rerender(<MembersSidebar {...initial} channel={{ ...channel, id: 2, kind: 'text' }} members={members.slice(1)}/>)
    await waitFor(() => expect(loader).toHaveBeenCalledTimes(3))
  })
})

it('reloads channel access immediately on a realtime invalidation with an unchanged catalog', async () => {
  const loader = vi.fn().mockResolvedValueOnce({ user_ids: [1, 3] }).mockResolvedValueOnce({ user_ids: [1, 2] })
  const handlers = props(loader)
  const { rerender } = render(<MembersSidebar {...handlers} refreshKey={0}/>)
  await screen.findByText('Carol')
  rerender(<MembersSidebar {...handlers} refreshKey={1}/>)
  await screen.findByText('Bob')
  expect(screen.queryByText('Carol')).toBeNull()
  expect(loader).toHaveBeenCalledTimes(2)
})
