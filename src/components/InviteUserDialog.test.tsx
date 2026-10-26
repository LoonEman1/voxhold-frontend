// @vitest-environment jsdom
import { StrictMode } from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ActiveInviteLink, InviteLinkPage, Server } from '../domain/types'
import { InviteUserDialog } from './InviteUserDialog'

const server: Server = { id: 1, name: 'First', role: 'owner', created_by: 1, created_at: 1, joined_at: 1 }
const first: ActiveInviteLink = { id: 10, server_id: 1, created_by: 2, creator_username: 'Other admin', expires_at: 1_900_000_000, created_at: 1_700_000_000, max_uses: 25, use_count: 3, allow_registration: true }
const second: ActiveInviteLink = { ...first, id: 9, creator_username: 'Owner', max_uses: null, allow_registration: false }
const page = (links: ActiveInviteLink[], before: number | null = null): InviteLinkPage => ({ invite_links: links, pagination: { next_before_id: before, has_more: before !== null } })
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done }); return { promise, resolve } }
function props() {
  return {
    open: true, onClose: vi.fn(), server,
    onCreateLink: vi.fn(async () => ({ ...first, server_name: server.name, token: 'new-token' })),
    onListLinks: vi.fn(async (_before?: number, _signal?: AbortSignal) => page([first])),
    onRevokeLink: vi.fn(async (_id: number) => {}),
  }
}
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('invite management', () => {
  it.each(['owner', 'admin'] as const)('lets %s list links from another creator and confirms revocation', async (role) => {
    const input = props(); input.server = { ...server, role }
    render(<InviteUserDialog {...input}/>)
    expect(input.onListLinks).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Активные ссылки' }))
    const row = await screen.findByRole('article', { name: 'Ссылка №10' })
    expect(within(row).getByText('Other admin')).toBeTruthy()
    expect(within(row).getByText('3 / 25')).toBeTruthy()
    fireEvent.click(within(row).getByRole('button', { name: 'Закрыть ссылку' }))
    expect(input.onRevokeLink).not.toHaveBeenCalled()
    fireEvent.click(within(row).getByRole('button', { name: 'Отмена' }))
    fireEvent.click(within(row).getByRole('button', { name: 'Закрыть ссылку' }))
    fireEvent.click(within(row).getByRole('button', { name: 'Да, закрыть' }))
    await waitFor(() => expect(input.onRevokeLink).toHaveBeenCalledWith(10))
    await screen.findByText('Активных ссылок пока нет.')
    expect(screen.queryByRole('article', { name: 'Ссылка №10' })).toBeNull()
  })

  it('hides management from members and does not request private lists', () => {
    const input = props(); input.server = { ...server, role: 'member' }
    render(<InviteUserDialog {...input}/>)
    expect(screen.queryByRole('button', { name: 'Активные ссылки' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Создать ссылку' })).toBeNull()
    expect(input.onListLinks).not.toHaveBeenCalled()
  })

  it('keeps a link visible after a failed revoke and allows retry', async () => {
    const input = props()
    input.onRevokeLink.mockRejectedValueOnce(new Error('Сеть недоступна'))
    render(<InviteUserDialog {...input}/>)
    fireEvent.click(screen.getByRole('button', { name: 'Активные ссылки' }))
    await screen.findByRole('article', { name: 'Ссылка №10' })
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть ссылку' }))
    fireEvent.click(screen.getByRole('button', { name: 'Да, закрыть' }))
    await screen.findByRole('alert')
    expect(screen.getByRole('article', { name: 'Ссылка №10' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Да, закрыть' }))
    await screen.findByText('Активных ссылок пока нет.')
    expect(input.onRevokeLink).toHaveBeenCalledTimes(2)
  })

  it('loads cursor pages without duplicates and refreshes expired entries away', async () => {
    const input = props()
    input.onListLinks.mockResolvedValueOnce(page([first], first.id)).mockResolvedValueOnce(page([first, second])).mockResolvedValueOnce(page([second]))
    render(<InviteUserDialog {...input}/>)
    fireEvent.click(screen.getByRole('button', { name: 'Активные ссылки' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Показать ещё' }))
    await screen.findByRole('article', { name: 'Ссылка №9' })
    expect(screen.getAllByRole('article')).toHaveLength(2)
    expect(input.onListLinks.mock.calls[1]?.[0]).toBe(10)
    fireEvent.click(screen.getByRole('button', { name: 'Обновить' }))
    await waitFor(() => expect(screen.queryByRole('article', { name: 'Ссылка №10' })).toBeNull())
    expect(screen.getByRole('article', { name: 'Ссылка №9' })).toBeTruthy()
  })

  it('does not restore a closed link into the generated-address panel', async () => {
    const input = props()
    render(<InviteUserDialog {...input}/>)
    fireEvent.click(screen.getByRole('button', { name: 'Создать ссылку' }))
    const url = await screen.findByRole('textbox', { name: 'Ссылка-приглашение' })
    expect((url as HTMLInputElement).value).toContain('new-token')
    fireEvent.click(screen.getByRole('button', { name: 'Активные ссылки' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Закрыть ссылку' }))
    fireEvent.click(screen.getByRole('button', { name: 'Да, закрыть' }))
    await screen.findByText('Активных ссылок пока нет.')
    fireEvent.click(screen.getByRole('button', { name: 'Новая ссылка' }))
    expect(screen.queryByRole('textbox', { name: 'Ссылка-приглашение' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Создать ссылку' })).toBeTruthy()
  })

  it('aborts list requests when closing the dialog, including StrictMode replay', async () => {
    const input = props(), pending = deferred<InviteLinkPage>()
    input.onListLinks.mockReturnValue(pending.promise)
    const { rerender } = render(<StrictMode><InviteUserDialog {...input}/></StrictMode>)
    fireEvent.click(screen.getByRole('button', { name: 'Активные ссылки' }))
    await waitFor(() => expect(input.onListLinks.mock.calls.length).toBeGreaterThan(0))
    const signals = input.onListLinks.mock.calls.map((call) => call[1]!)
    rerender(<StrictMode><InviteUserDialog {...input} open={false}/></StrictMode>)
    expect(signals.every((signal) => signal.aborted)).toBe(true)
    pending.resolve(page([first]))
    await Promise.resolve()
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
