import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react'
import type { AccountSession } from '../domain/types'
import { formatDate, humanError } from '../lib/format'
import { Icon } from './Icon'

export interface SecurityActions {
  changePassword(current: string, next: string, confirm: string): Promise<void>
  loadSessions(): Promise<AccountSession[]>
  revokeSession(id: number): Promise<void>
  revokeOthers(): Promise<void>
}

function PasswordField({ label, value, onChange, current = false }: { label: string; value: string; onChange(value: string): void; current?: boolean }) {
  const [visible, setVisible] = useState(false)
  const id = useId()
  return <div className="password-form-field"><label htmlFor={id}><span>{label}</span></label><div className="password-field"><input id={id} type={visible ? 'text' : 'password'} autoComplete={current ? 'current-password' : 'new-password'} minLength={current ? undefined : 8} maxLength={current ? undefined : 72} value={value} onChange={(event) => onChange(event.target.value)} required/><button type="button" className="icon-button" aria-label={`${visible ? 'Скрыть' : 'Показать'}: ${label.toLocaleLowerCase()}`} aria-pressed={visible} onClick={() => setVisible((shown) => !shown)}><Icon name={visible ? 'eyeOff' : 'eye'} size={18}/></button></div></div>
}

export function SecuritySettings({ actions }: { actions: SecurityActions }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState<string | number | null>(null)
  const [sessions, setSessions] = useState<AccountSession[]>([])
  const [loading, setLoading] = useState(true)
  const [sessionError, setSessionError] = useState('')
  const generation = useRef(0), locked = useRef(false)
  const cancelRequests = useCallback(() => { ++generation.current }, [])
  const refresh = useCallback(async () => {
    const request = ++generation.current
    setLoading(true); setSessionError('')
    try {
      const values = await actions.loadSessions()
      if (request === generation.current) setSessions(values)
    } catch (caught) {
      if (request === generation.current) setSessionError(humanError(caught))
    } finally {
      if (request === generation.current) setLoading(false)
    }
  }, [actions])
  useEffect(() => { void refresh(); return cancelRequests }, [refresh, cancelRequests])

  const run = async (key: string | number, action: () => Promise<void>, success: string) => {
    if (locked.current) return
    locked.current = true; setPending(key); setError(''); setMessage('')
    try { await action(); setMessage(success); await refresh() }
    catch (caught) { setError(humanError(caught)) }
    finally { locked.current = false; setPending(null) }
  }
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (new TextEncoder().encode(next).length > 72) { setMessage(''); setError('Пароль слишком длинный. Сократите его: кириллица и эмодзи занимают больше места.'); return }
    if (next !== confirm) { setMessage(''); setError('Пароли не совпадают. Повторите новый пароль.'); return }
    void run('password', async () => {
      await actions.changePassword(current, next, confirm)
      setCurrent(''); setNext(''); setConfirm('')
    }, 'Пароль изменён. Остальные сессии завершены.')
  }
  return <section className="profile-security" aria-label="Безопасность">
    <div className="profile-section-heading"><span><Icon name="lock" size={20}/></span><div><h3>Пароль и доступ</h3><p>Защитите аккаунт и управляйте устройствами.</p></div></div>
    <form className="dialog-form security-password-form" onSubmit={submit} aria-busy={pending === 'password'}>
      <PasswordField label="Текущий пароль" value={current} onChange={setCurrent} current/>
      <PasswordField label="Новый пароль" value={next} onChange={setNext}/>
      <PasswordField label="Повторите новый пароль" value={confirm} onChange={setConfirm}/>
      <small className="field-hint">От 8 символов. После смены пароля остальные устройства выйдут из аккаунта.</small>
      <button type="submit" className="button button--secondary" disabled={pending !== null}>{pending === 'password' && <span className="spinner"/>}{pending === 'password' ? 'Сохраняем…' : 'Сменить пароль'}</button>
    </form>
    {message && <div className="form-success" role="status">{message}</div>}
    {error && <div className="form-error" role="alert">{error}</div>}
    <div className="session-heading"><div><h4>Активные сессии</h4><p>Завершите сеанс на устройстве, которым больше не пользуетесь.</p></div><button type="button" className="icon-button" aria-label="Обновить сессии" title="Обновить сессии" disabled={loading || pending !== null} onClick={() => void refresh()}><Icon name="clock" size={18}/></button></div>
    {loading && !sessions.length && <div className="session-empty" role="status"><span className="spinner"/>Загружаем устройства…</div>}
    {sessionError && <div className="session-load-error" role="alert"><span>{sessionError}</span><button type="button" className="button button--ghost button--small" disabled={loading || pending !== null} onClick={() => void refresh()}>Повторить</button></div>}
    {!loading && !sessionError && !sessions.length && <p className="session-empty">Нет доступных сессий.</p>}
    <ul className="session-list" aria-label="Устройства с доступом к аккаунту" aria-busy={loading}>
      {sessions.map((item) => <li key={item.id} className={item.current ? 'is-current' : ''}>
        <span className="session-device-icon" aria-hidden="true"><Icon name="monitor" size={20}/></span>
        <div className="session-details"><div className="session-device-name"><b title={item.user_agent || undefined}>{item.user_agent || 'Неизвестное устройство'}</b>{item.current && <span className="session-current">Эта сессия</span>}</div>{item.client_ip && <span className="session-ip">{item.client_ip}</span>}<small>{item.last_used_at ? `Активность: ${formatDate(item.last_used_at)}` : `Вход: ${formatDate(item.created_at)}`}</small></div>
        {!item.current && <button type="button" className="button button--ghost button--small session-revoke" disabled={pending !== null} aria-label={`Завершить сессию: ${item.user_agent || 'Неизвестное устройство'}`} onClick={() => void run(item.id, () => actions.revokeSession(item.id), 'Сессия завершена.')}>{pending === item.id ? <span className="spinner"/> : <Icon name="logout" size={14}/>}Завершить</button>}
      </li>)}
    </ul>
    {sessions.some((item) => !item.current) && <button type="button" className="button button--danger-outline button--small session-revoke-others" disabled={pending !== null} onClick={() => void run('others', () => actions.revokeOthers(), 'Остальные сессии завершены.')}>{pending === 'others' && <span className="spinner"/>}Завершить все остальные</button>}
  </section>
}
