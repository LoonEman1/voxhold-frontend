import { useCallback, useEffect, useState, type FormEvent } from 'react'
import type { AccountSession } from '../domain/types'
import { formatDate, humanError } from '../lib/format'

export interface SecurityActions {
  changePassword(current: string, next: string, confirm: string): Promise<void>
  loadSessions(): Promise<AccountSession[]>
  revokeSession(id: number): Promise<void>
  revokeOthers(): Promise<void>
}

export function SecuritySettings({ actions }: { actions: SecurityActions }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const [sessions, setSessions] = useState<AccountSession[]>([])
  const refresh = useCallback(async () => {
    try { setSessions(await actions.loadSessions()) } catch (caught) { setError(humanError(caught)) }
  }, [actions])
  useEffect(() => { void refresh() }, [refresh])
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (pending) return
    setPending(true); setError(''); setMessage('')
    try {
      await actions.changePassword(current, next, confirm)
      setCurrent(''); setNext(''); setConfirm('')
      setMessage('Пароль изменён. Остальные сессии завершены.')
      await refresh()
    } catch (caught) { setError(humanError(caught)) } finally { setPending(false) }
  }
  const run = async (action: () => Promise<void>) => {
    setError('')
    try { await action(); await refresh() } catch (caught) { setError(humanError(caught)) }
  }
  return (
    <section className="profile-security" aria-label="Безопасность">
      <h3>Безопасность</h3>
      <form className="dialog-form" onSubmit={submit}>
        <label><span>Текущий пароль</span><input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required/></label>
        <label><span>Новый пароль</span><input type="password" autoComplete="new-password" minLength={8} maxLength={72} value={next} onChange={(e) => setNext(e.target.value)} required/></label>
        <label><span>Повторите новый пароль</span><input type="password" autoComplete="new-password" minLength={8} maxLength={72} value={confirm} onChange={(e) => setConfirm(e.target.value)} required/></label>
        <button className="button button--ghost" disabled={pending}>Сменить пароль</button>
      </form>
      {message && <div className="form-success" role="status">{message}</div>}
      {error && <div className="form-error" role="alert">{error}</div>}
      <h4>Активные сессии</h4>
      <ul className="session-list">
        {sessions.map((item) => (
          <li key={item.id}>
            <span>{item.user_agent || 'Неизвестное устройство'}{item.client_ip ? ` · ${item.client_ip}` : ''}{item.current ? ' · эта сессия' : ''}</span>
            <small>{item.last_used_at ? `Активность: ${formatDate(item.last_used_at)}` : `Вход: ${formatDate(item.created_at)}`}</small>
            {!item.current && <button type="button" className="button button--ghost button--small" onClick={() => void run(() => actions.revokeSession(item.id))}>Завершить</button>}
          </li>
        ))}
      </ul>
      {sessions.some((item) => !item.current) && <button type="button" className="button button--ghost button--small" onClick={() => void run(actions.revokeOthers)}>Завершить все остальные</button>}
    </section>
  )
}
