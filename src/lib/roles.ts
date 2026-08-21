import type { ServerRole } from '../domain/types'

export const roleMeta: Record<ServerRole, { label: string; shortLabel: string }> = {
  owner: { label: 'Владелец сервера', shortLabel: 'Владелец' },
  admin: { label: 'Администратор', shortLabel: 'Админ' },
  member: { label: 'Участник', shortLabel: 'Участник' },
}
