import { useCallback, useEffect, useState } from 'react'
import type { ServerBan } from '../domain/types'
import { formatDate, humanError } from '../lib/format'
import type { VoxholdApi } from '../services/api'
import { ConfirmDialog } from './ConfirmDialog'

export function BanManager({ api, token, serverId }: { api: VoxholdApi; token: string; serverId: number }) {
  const [bans, setBans] = useState<ServerBan[] | null>(null)
  const [error, setError] = useState('')
  const [pendingUnban, setPendingUnban] = useState<ServerBan | null>(null)
  const refresh = useCallback(async () => {
    try { setBans(await api.servers.listBans(token, serverId)); setError('') } catch (caught) { setError(humanError(caught)) }
  }, [api, token, serverId])
  useEffect(() => { void refresh() }, [refresh])
  return (
    <div className="community-settings">
      {error && <div className="form-error" role="alert">{error}</div>}
      {bans && bans.length === 0 && <p>Заблокированных пользователей нет.</p>}
      {bans && bans.length > 0 && <>
        <p>Разбан снимает блокировку входа. Чтобы вернуть человека на сервер, отправьте ему новое приглашение.</p>
        <ul className="ban-list">
          {bans.map((ban) => (
            <li key={ban.user_id}>
              <b>@{ban.username}</b> <small>{formatDate(ban.created_at)}</small>
              <span>{ban.reason || 'Причина не указана'}</span>
              <button type="button" className="button button--ghost button--small" onClick={() => setPendingUnban(ban)}>Разбанить</button>
            </li>
          ))}
        </ul>
      </>}
      <ConfirmDialog
        open={!!pendingUnban}
        onClose={() => setPendingUnban(null)}
        title="Разбанить пользователя?"
        description={`Пользователь @${pendingUnban?.username ?? ''} снова сможет войти в аккаунт. На сервер он вернётся только по новому приглашению.`}
        confirmLabel="Разбанить"
        onConfirm={async () => { if (pendingUnban) { await api.servers.unbanMember(token, serverId, pendingUnban.user_id); await refresh() } }}
      />
    </div>
  )
}
