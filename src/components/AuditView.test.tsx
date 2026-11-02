// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { AuditEntry } from '../domain/community'
import type { ServerMember } from '../domain/types'
import type { VoxholdApi } from '../services/api'
import { AuditView } from './AuditView'

afterEach(cleanup)
const entry = (id: number, actor: number, target: string): AuditEntry => ({ id, actor_user_id: actor, actor_name: actor === 1 ? 'Аня' : 'Борис', action: 'member.banned', target_type: 'user', target_id: 5, target_name: target, details: { reason: 'Спам' }, created_at: 1800000000 })

it('offers names instead of asking for IDs and ignores an old page after filters change', async () => {
  let resolveOlder!: (page: unknown) => void
  const request = vi.fn((_token: string, path: string) => {
    if (path.includes('before=')) return new Promise((resolve) => { resolveOlder = resolve })
    return Promise.resolve({ items: [entry(path.includes('actor_id=2') ? 9 : 10, path.includes('actor_id=2') ? 2 : 1, path.includes('actor_id=2') ? 'Новое действие' : 'Исходное действие')], has_more: !path.includes('actor_id=2') })
  })
  const api = { community: { request } } as unknown as VoxholdApi
  render(<AuditView api={api} token="test" serverId={1} members={[{ user_id: 2, username: 'Борис' }] as ServerMember[]}/>)
  await screen.findByText('Участник: Исходное действие')
  expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
  expect(screen.getByLabelText('Кто выполнил действие')).toHaveTextContent('Борис')
  expect(screen.getByText('Спам')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Показать более ранние записи' }))
  fireEvent.change(screen.getByLabelText('Кто выполнил действие'), { target: { value: '2' } })
  await screen.findByText('Участник: Новое действие')
  await act(async () => resolveOlder({ items: [entry(8, 1, 'Устаревшая страница')], has_more: false }))
  expect(screen.queryByText('Участник: Устаревшая страница')).not.toBeInTheDocument()
  expect(screen.queryByText('Участник: Исходное действие')).not.toBeInTheDocument()
})
