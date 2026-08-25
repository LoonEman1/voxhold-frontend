import { useEffect, useState, type FormEvent } from 'react'
import type { Channel, ChannelKind, CreatedInviteLink, IncomingInvite, Profile, Server, ServerRole } from '../domain/types'
import { countryByCode } from '../lib/countries'
import { formatDate, humanError } from '../lib/format'
import { createWebInviteURL } from '../lib/inviteLinks'
import { roleMeta } from '../lib/roles'
import { Avatar } from './Avatar'
import { CountryFlag, CountrySelect } from './CountrySelect'
import { EmptyState } from './EmptyState'
import { Icon } from './Icon'
import { Modal } from './Modal'

interface AsyncDialogProps {
  open: boolean
  onClose: () => void
}

export function ConfirmDialog({ open, onClose, title, description, confirmLabel, onConfirm }: AsyncDialogProps & {
  title: string
  description: string
  confirmLabel: string
  onConfirm(): Promise<void>
}) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { if (open) { setPending(false); setError('') } }, [open])
  const confirm = async () => {
    if (pending) return
    setPending(true); setError('')
    try { await onConfirm(); onClose() } catch (caught) { setError(humanError(caught)); setPending(false) }
  }
  return (
    <Modal open={open} onClose={pending ? () => undefined : onClose} title={title} eyebrow="ПОДТВЕРЖДЕНИЕ">
      <div className="logout-confirm">
        <span><Icon name="trash" size={26}/></span>
        <p>{description}</p>
        {error && <div className="form-error" role="alert">{error}</div>}
        <div><button className="button button--ghost" type="button" onClick={onClose} disabled={pending}>Отмена</button><button className="button button--danger" type="button" onClick={() => void confirm()} disabled={pending}>{pending ? <span className="spinner"/> : confirmLabel}</button></div>
      </div>
    </Modal>
  )
}

export function LogoutConfirmDialog({ open, onClose, onConfirm }: AsyncDialogProps & { onConfirm(): Promise<void> }) {  const [pending, setPending] = useState(false)
  useEffect(() => { if (open) setPending(false) }, [open])
  const confirm = async () => {
    if (pending) return
    setPending(true)
    await onConfirm()
  }
  return (
    <Modal open={open} onClose={pending ? () => undefined : onClose} title="Выйти из аккаунта?" eyebrow="ПОДТВЕРЖДЕНИЕ">
      <div className="logout-confirm">
        <span><Icon name="logout" size={26}/></span>
        <p>Текущая сессия завершится. Для возвращения потребуется снова ввести логин и пароль.</p>
        <div><button className="button button--ghost" type="button" onClick={onClose} disabled={pending}>Отмена</button><button className="button button--danger" type="button" onClick={() => void confirm()} disabled={pending}>{pending ? <span className="spinner"/> : 'Выйти'}</button></div>
      </div>
    </Modal>
  )
}

export function CreateServerDialog({ open, onClose, onSubmit }: AsyncDialogProps & { onSubmit(name: string): Promise<void> }) {
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  useEffect(() => { if (open) { setName(''); setError('') } }, [open])
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setPending(true); setError('')
    try { await onSubmit(name.trim()); onClose() } catch (caught) { setError(humanError(caught)) } finally { setPending(false) }
  }
  return (
    <Modal open={open} onClose={onClose} title="Новое пространство" eyebrow="СОЗДАТЬ СЕРВЕР">
      <form className="dialog-form" onSubmit={submit}>
        <p>Назовите место так, чтобы свои сразу поняли, куда попали.</p>
        <label><span>Название сервера</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Например, Ночная смена" maxLength={80} required autoFocus /></label>
        {error && <div className="form-error" role="alert">{error}</div>}
        <div className="dialog-actions"><button className="button button--ghost" type="button" onClick={onClose}>Отмена</button><button className="button button--primary" disabled={pending}>{pending ? <span className="spinner"/> : 'Создать сервер'}</button></div>
      </form>
    </Modal>
  )
}

export function CreateChannelDialog({ open, onClose, onSubmit }: AsyncDialogProps & { onSubmit(name: string, kind: ChannelKind): Promise<void> }) {
  const [name, setName] = useState('')
  const [kind, setKind] = useState<ChannelKind>('text')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  useEffect(() => { if (open) { setName(''); setKind('text'); setError('') } }, [open])
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setPending(true); setError('')
    try { await onSubmit(name.trim().toLowerCase().replace(/\s+/g, '-'), kind); onClose() } catch (caught) { setError(humanError(caught)) } finally { setPending(false) }
  }
  return (
    <Modal open={open} onClose={onClose} title="Создать канал" eyebrow="НОВОЕ МЕСТО">
      <form className="dialog-form" onSubmit={submit}>
        <fieldset className="channel-kind"><legend>Тип канала</legend>
          <label className={kind === 'text' ? 'is-selected' : ''}><input type="radio" name="kind" checked={kind === 'text'} onChange={() => setKind('text')}/><span className="kind-icon"><Icon name="hash"/></span><span><b>Текстовый</b><small>Сообщения, файлы и идеи</small></span><i/></label>
          <label className={kind === 'voice' ? 'is-selected' : ''}><input type="radio" name="kind" checked={kind === 'voice'} onChange={() => setKind('voice')}/><span className="kind-icon"><Icon name="volume"/></span><span><b>Голосовой</b><small>Для живых разговоров</small></span><i/></label>
        </fieldset>
        <label><span>Название канала</span><div className="input-with-prefix"><Icon name={kind === 'text' ? 'hash' : 'volume'} size={16}/><input value={name} onChange={(e) => setName(e.target.value)} placeholder="новый-канал" maxLength={80} required /></div></label>
        {error && <div className="form-error" role="alert">{error}</div>}
        <div className="dialog-actions"><button className="button button--ghost" type="button" onClick={onClose}>Отмена</button><button className="button button--primary" disabled={pending}>{pending ? <span className="spinner"/> : 'Создать канал'}</button></div>
      </form>
    </Modal>
  )
}

export function InviteUserDialog({ open, onClose, server, onSubmit, onCreateLink }: AsyncDialogProps & {
  server: Server | null
  onSubmit(username: string): Promise<void>
  onCreateLink(input: { expires_in_seconds: number; max_uses: number | null; allow_registration: boolean }): Promise<CreatedInviteLink>
}) {
  const [mode, setMode] = useState<'direct' | 'link'>('direct')
  const [username, setUsername] = useState('')
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const [pending, setPending] = useState(false)
  const [allowRegistration, setAllowRegistration] = useState(false)
  const [lifetime, setLifetime] = useState(24 * 60 * 60)
  const [maxUses, setMaxUses] = useState(25)
  const [generatedURL, setGeneratedURL] = useState('')
  useEffect(() => { if (open) { setMode('direct'); setUsername(''); setError(''); setDone(false); setGeneratedURL(''); setAllowRegistration(false); setLifetime(24 * 60 * 60); setMaxUses(25) } }, [open])
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setPending(true); setError('')
    try { await onSubmit(username.trim()); setDone(true) } catch (caught) { setError(humanError(caught)) } finally { setPending(false) }
  }
  const createLink = async (event: FormEvent) => {
    event.preventDefault(); setPending(true); setError('')
    try {
      const link = await onCreateLink({ expires_in_seconds: lifetime, max_uses: maxUses, allow_registration: allowRegistration })
      setGeneratedURL(createWebInviteURL(link.token, `${window.location.origin}${window.location.pathname}`))
    } catch (caught) { setError(humanError(caught)) } finally { setPending(false) }
  }
  const changeMode = (next: 'direct' | 'link') => { setMode(next); setDone(false); setGeneratedURL(''); setError('') }
  return (
    <Modal open={open} onClose={onClose} title={`Пригласить в ${server?.name ?? 'сервер'}`} eyebrow="СОБЕРИТЕ СВОИХ" size="medium">
      <div className="auth-tabs invite-mode-tabs" role="tablist">
        <button type="button" className={mode === 'direct' ? 'is-active' : ''} onClick={() => changeMode('direct')}>По имени</button>
        <button type="button" className={mode === 'link' ? 'is-active' : ''} onClick={() => changeMode('link')}>По ссылке</button>
      </div>
      {mode === 'direct' && (done ? <div className="dialog-success"><span><Icon name="check" size={28}/></span><h3>Приглашение отправлено</h3><p>Оно появится во входящих у пользователя.</p><button className="button button--primary" onClick={onClose}>Готово</button></div> :
      <form className="dialog-form" onSubmit={submit}>
        <p>Введите точное имя пользователя Voxhold.</p>
        <label><span>Имя пользователя</span><input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="username" maxLength={32} required autoFocus /></label>
        {error && <div className="form-error" role="alert">{error}</div>}
        <div className="dialog-actions"><button className="button button--ghost" type="button" onClick={onClose}>Отмена</button><button className="button button--primary" disabled={pending}>{pending ? <span className="spinner"/> : 'Отправить'}</button></div>
      </form>)}
      {mode === 'link' && (generatedURL ? <div className="dialog-form invite-link-result"><p>Ссылка откроет страницу этого сервера. Там приглашённый сможет запустить приложение или продолжить вход и регистрацию в браузере.</p><label><span>Ссылка-приглашение</span><input readOnly value={generatedURL} onFocus={(event) => event.currentTarget.select()}/></label>{error && <div className="form-error" role="alert">{error}</div>}<div className="dialog-actions"><button className="button button--ghost" type="button" onClick={() => setGeneratedURL('')}>Создать ещё</button><button className="button button--primary" type="button" onClick={() => void navigator.clipboard.writeText(generatedURL)}>Копировать</button></div></div> :
      <form className="dialog-form" onSubmit={createLink}>
        <label className="invite-option"><input type="checkbox" checked={allowRegistration} onChange={(event) => { const checked = event.target.checked; setAllowRegistration(checked); if (checked && lifetime > 24 * 60 * 60) setLifetime(24 * 60 * 60); if (checked && maxUses > 100) setMaxUses(1) }}/><span><b>Допускать незарегистрированных</b><small>По этой ссылке можно будет создать новый аккаунт.</small></span></label>
        <label><span>Срок действия</span><select value={lifetime} onChange={(event) => setLifetime(Number(event.target.value))}><option value={60 * 60}>1 час</option><option value={6 * 60 * 60}>6 часов</option><option value={24 * 60 * 60}>1 сутки</option>{!allowRegistration && <option value={7 * 24 * 60 * 60}>7 дней</option>}{!allowRegistration && <option value={30 * 24 * 60 * 60}>30 дней</option>}</select></label>
        <label><span>Количество использований</span><input type="number" min={1} max={allowRegistration ? 100 : 1000} value={maxUses} onChange={(event) => setMaxUses(Number(event.target.value))} required/></label>
        <p>{allowRegistration ? 'Безопасный режим: максимум сутки и ограниченное число регистраций.' : 'Ссылка работает только для уже зарегистрированных пользователей.'}</p>
        {error && <div className="form-error" role="alert">{error}</div>}
        <div className="dialog-actions"><button className="button button--ghost" type="button" onClick={onClose}>Отмена</button><button className="button button--primary" disabled={pending}>{pending ? <span className="spinner"/> : 'Создать ссылку'}</button></div>
      </form>)}
    </Modal>
  )
}

export function InvitesDialog({ open, onClose, invites, onRespond }: AsyncDialogProps & { invites: IncomingInvite[]; onRespond(invite: IncomingInvite, action: 'accept' | 'decline'): Promise<void> }) {
  const [pendingId, setPendingId] = useState<number | null>(null)
  const [error, setError] = useState('')
  const respond = async (invite: IncomingInvite, action: 'accept' | 'decline') => {
    setPendingId(invite.id); setError('')
    try { await onRespond(invite, action) } catch (caught) { setError(humanError(caught)) } finally { setPendingId(null) }
  }
  return (
    <Modal open={open} onClose={onClose} title="Приглашения" eyebrow={`${invites.length} ВХОДЯЩИХ`} size="medium">
      <div className="invite-list">
        {invites.length === 0 ? <EmptyState icon="inbox" title="Здесь пока тихо">Новые приглашения появятся в этом окне.</EmptyState> : invites.map((invite) => (
          <article className="invite-card" key={invite.id}>
            <Avatar name={invite.server_name}/><div><h3>{invite.server_name}</h3><p><b>@{invite.inviter_username}</b> приглашает вас присоединиться</p><small>до {formatDate(invite.expires_at)}</small></div>
            <div className="invite-card__actions"><button className="button button--primary button--small" onClick={() => void respond(invite, 'accept')} disabled={pendingId === invite.id}>Принять</button><button className="button button--ghost button--small" onClick={() => void respond(invite, 'decline')} disabled={pendingId === invite.id}>Отклонить</button></div>
          </article>
        ))}
        {error && <div className="form-error" role="alert">{error}</div>}
      </div>
    </Modal>
  )
}

export function ProfileDialog({ open, onClose, profile, onSubmit }: AsyncDialogProps & { profile: Profile | null; onSubmit(patch: { about: string; country_code: string }): Promise<void> }) {
  const [about, setAbout] = useState('')
  const [country, setCountry] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  useEffect(() => { if (open) { setAbout(profile?.about ?? ''); setCountry(profile?.country_code ?? ''); setError('') } }, [open, profile])
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setPending(true); setError('')
    try { await onSubmit({ about: about.trim(), country_code: country }); onClose() } catch (caught) { setError(humanError(caught)) } finally { setPending(false) }
  }
  return (
    <Modal open={open} onClose={onClose} title="Ваш профиль" eyebrow="КАК ВАС ВИДЯТ ДРУГИЕ" size="medium">
      <div className="profile-hero"><Avatar name={profile?.username ?? 'V'} size="large"/><div><h3>@{profile?.username}</h3><p>В Voxhold с {profile ? formatDate(profile.created_at) : 'недавно'}</p></div></div>
      <form className="dialog-form" onSubmit={submit}>
        <label><span>О себе <small>{about.length}/512</small></span><textarea value={about} onChange={(e) => setAbout(e.target.value)} maxLength={512} rows={4} placeholder="Пара слов о себе, интересах или текущем проекте…" /></label>
        <label><span>Страна проживания</span><CountrySelect value={country} onChange={setCountry} /></label>
        {error && <div className="form-error" role="alert">{error}</div>}
        <div className="dialog-actions"><button className="button button--ghost" type="button" onClick={onClose}>Отмена</button><button className="button button--primary" disabled={pending}>{pending ? <span className="spinner"/> : 'Сохранить'}</button></div>
      </form>
    </Modal>
  )
}

export function MemberProfileDialog({ open, onClose, profile, role, loading, error, canChangeRole, canBan, onRoleChange, onBan }: AsyncDialogProps & { profile: Profile | null; role: ServerRole; loading: boolean; error: string; canChangeRole: boolean; canBan: boolean; onRoleChange(role: Exclude<ServerRole, 'owner'>): Promise<void>; onBan(): Promise<void> }) {
  const country = countryByCode(profile?.country_code)
  const [pending, setPending] = useState(false)
  const [manageError, setManageError] = useState('')
  const [confirmKick, setConfirmKick] = useState(false)
  useEffect(() => { if (open) { setPending(false); setManageError(''); setConfirmKick(false) } }, [open, profile?.user_id])
  const changeRole = async (nextRole: Exclude<ServerRole, 'owner'>) => {
    if (nextRole === role || pending) return
    setPending(true); setManageError('')
    try { await onRoleChange(nextRole) } catch (caught) { setManageError(humanError(caught)) } finally { setPending(false) }
  }
  const ban = async () => {
    if (pending) return
    setPending(true); setManageError('')
    try { await onBan() } catch (caught) { setManageError(humanError(caught)); setPending(false) }
  }
  return (
    <Modal open={open} onClose={onClose} title="Профиль участника" eyebrow="ВИЗИТНАЯ КАРТОЧКА" size="medium">
      {loading ? <div className="profile-view-loading"><span className="spinner"/><p>Загружаем профиль…</p></div> : error ? <div className="profile-view-error"><Icon name="close"/><p>{error}</p></div> : profile && <div className="member-profile-card">
        <div className="member-profile-cover"><i/><i/><i/></div>
        <div className="member-profile-avatar-slot" aria-label="Место для будущей фотографии профиля"><Avatar name={profile.username} size="large"/></div>
        <div className="member-profile-head"><div><h3>{profile.username}</h3><span>@{profile.username}</span></div><span className={`role-badge role-badge--${role}`}>{roleMeta[role].label}</span></div>
        <dl className="profile-facts">
          <div><dt>В Voxhold с</dt><dd>{formatDate(profile.created_at)}</dd></div>
          <div><dt>Страна проживания</dt><dd>{country ? <><CountryFlag code={country.code}/> {country.name}</> : 'Не указана'}</dd></div>
        </dl>
        <section className="profile-about"><span>ОБО МНЕ</span><p>{profile.about || 'Пользователь пока ничего о себе не рассказал.'}</p></section>
        {(canChangeRole || canBan) && <section className="member-management">
          <div><span>УПРАВЛЕНИЕ УЧАСТНИКОМ</span><p>Изменения сразу увидят все участники сервера.</p></div>
          {canChangeRole && <div className="member-role-control"><span>Роль</span><div><button className={role === 'member' ? 'is-active' : ''} onClick={() => void changeRole('member')} disabled={pending}>Участник</button><button className={role === 'admin' ? 'is-active' : ''} onClick={() => void changeRole('admin')} disabled={pending}>Администратор</button></div></div>}
          {canBan && <div className="member-kick-control">{confirmKick ? <><span>Забанить аккаунт {profile.username} на всём инстансе?</span><button className="button button--danger button--small" onClick={() => void ban()} disabled={pending}>{pending ? <span className="spinner"/> : 'Забанить'}</button><button className="button button--ghost button--small" onClick={() => setConfirmKick(false)} disabled={pending}>Отмена</button></> : <button className="button button--danger-outline button--small" onClick={() => setConfirmKick(true)}>Забанить аккаунт</button>}</div>}
          {manageError && <div className="form-error" role="alert">{manageError}</div>}
        </section>}
        <div className="avatar-roadmap"><Icon name="sparkles" size={15}/><span>Здесь предусмотрено место под загружаемый аватар, когда backend добавит файловое хранилище.</span></div>
      </div>}
    </Modal>
  )
}

export function ChannelSettingsDialog({ open, onClose, channel, onRename, onRemove }: AsyncDialogProps & { channel: Channel | null; onRename(name: string): Promise<void>; onRemove(): Promise<void> }) {
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const [confirming, setConfirming] = useState(false)
  useEffect(() => { if (open) { setName(channel?.name ?? ''); setError(''); setConfirming(false) } }, [open, channel])
  const rename = async (event: FormEvent) => {
    event.preventDefault(); setPending(true); setError('')
    try { await onRename(name.trim().toLowerCase().replace(/\s+/g, '-')); onClose() } catch (caught) { setError(humanError(caught)) } finally { setPending(false) }
  }
  const remove = async () => {
    setPending(true); setError('')
    try { await onRemove(); onClose() } catch (caught) { setError(humanError(caught)) } finally { setPending(false) }
  }
  return (
    <Modal open={open} onClose={onClose} title="Изменить канал" eyebrow={channel?.kind === 'voice' ? 'ГОЛОСОВОЙ КАНАЛ' : 'ТЕКСТОВЫЙ КАНАЛ'} size="medium">
      <form className="dialog-form settings-section" onSubmit={rename}>
        <div><h3>Название канала</h3><p>Тип канала останется прежним.</p></div>
        <label><span>Название</span><div className="input-with-prefix"><Icon name={channel?.kind === 'voice' ? 'volume' : 'hash'} size={16}/><input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} required /></div></label>
        <button className="button button--secondary align-self-end" disabled={pending}>Сохранить</button>
      </form>
      <div className="danger-zone"><div><h3>Удалить канал</h3><p>Канал и его история исчезнут для всех участников. Это действие нельзя отменить.</p></div>{confirming ? <div className="danger-confirm"><span>Точно удалить «{channel?.name}»?</span><button className="button button--danger button--small" onClick={() => void remove()} disabled={pending}>{pending ? <span className="spinner"/> : 'Удалить'}</button><button className="button button--ghost button--small" onClick={() => setConfirming(false)}>Отмена</button></div> : <button className="button button--danger-outline" onClick={() => setConfirming(true)}>Удалить канал</button>}</div>
      {error && <div className="form-error dialog-standalone-error" role="alert">{error}</div>}
    </Modal>
  )
}

interface ServerSettingsDialogProps extends AsyncDialogProps {
  server: Server | null
  corsOrigins: string[] | null
  corsOriginsLoading: boolean
  onRename(name: string): Promise<void>
  onDeleteAccount(): Promise<void>
  onDownloadDiagnostics(): Promise<void>
  onSaveCorsOrigins(origins: string[]): Promise<string[]>
}

export function ServerSettingsDialog({
  open,
  onClose,
  server,
  corsOrigins,
  corsOriginsLoading,
  onRename,
  onDeleteAccount,
  onDownloadDiagnostics,
  onSaveCorsOrigins,
}: ServerSettingsDialogProps) {
  const [name, setName] = useState('')
  const [corsValue, setCorsValue] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const [diagnosticsPending, setDiagnosticsPending] = useState(false)
  const [corsPending, setCorsPending] = useState(false)
  const [confirming, setConfirming] = useState(false)
  useEffect(() => {
    if (open) {
      setName(server?.name ?? '')
      setCorsValue((corsOrigins ?? []).join('\n'))
      setError('')
      setConfirming(false)
    }
  }, [corsOrigins, open, server])
  const rename = async (event: FormEvent) => {
    event.preventDefault(); setPending(true); setError('')
    try { await onRename(name.trim()) } catch (caught) { setError(humanError(caught)) } finally { setPending(false) }
  }
  const remove = async () => {
    setPending(true); setError('')
    try { await onDeleteAccount(); onClose() } catch (caught) { setError(humanError(caught)) } finally { setPending(false) }
  }
  const owner = server?.role === 'owner'
  const downloadDiagnostics = async () => {
    if (diagnosticsPending) return
    setDiagnosticsPending(true); setError('')
    try { await onDownloadDiagnostics() } catch (caught) { setError(humanError(caught)) } finally { setDiagnosticsPending(false) }
  }
  const saveCorsOrigins = async (event: FormEvent) => {
    event.preventDefault()
    if (corsPending || corsOriginsLoading) return
    const origins = corsValue.split(/\r?\n/).map((origin) => origin.trim()).filter(Boolean)
    setCorsPending(true); setError('')
    try {
      const saved = await onSaveCorsOrigins(origins)
      setCorsValue((saved ?? []).join('\n'))
    } catch (caught) {
      setError(humanError(caught))
    } finally {
      setCorsPending(false)
    }
  }
  return (
    <Modal open={open} onClose={onClose} title="Настройки сервера" eyebrow={server?.name.toUpperCase()} size="medium">
      {owner && <form className="dialog-form settings-section" onSubmit={rename}><div><h3>Название</h3><p>Его увидят все участники пространства.</p></div><label><span>Название сервера</span><input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required /></label><button className="button button--secondary align-self-end" disabled={pending}>Сохранить</button></form>}
      {owner && <form className="dialog-form settings-section" onSubmit={saveCorsOrigins}><div><h3>Доступ внешних клиентов</h3><p>Разрешите браузерным клиентам на других доменах обращаться к API и WebSocket этого инстанса.</p></div><label><span>Разрешённые origin</span><textarea rows={5} value={corsValue} onChange={(event) => setCorsValue(event.target.value)} disabled={corsOriginsLoading || corsPending} placeholder={corsOriginsLoading ? 'Загрузка…' : 'https://client.example.com\nhttp://localhost:5173'} spellCheck={false}/></label><small className="field-hint">По одному точному origin на строку: схема, домен и необязательный порт. Без пути и wildcard.</small><button className="button button--secondary align-self-end" disabled={corsOriginsLoading || corsPending}>{corsPending ? <span className="spinner"/> : 'Сохранить CORS'}</button></form>}
      {owner && <div className="dialog-form settings-section"><div><h3>Диагностика клиентов</h3><p>HTTP, WebSocket и WebRTC-метрики автоматически хранятся на сервере 24 часа. Секреты, сообщения, SDP и ICE-адреса удаляются.</p></div><button className="button button--secondary align-self-end" type="button" disabled={diagnosticsPending} onClick={() => void downloadDiagnostics()}>{diagnosticsPending ? <span className="spinner"/> : 'Скачать JSON'}</button></div>}
      {!owner && <div className="danger-zone"><div><h3>Удалить аккаунт</h3><p>Профиль, настройки и доступ к этому инстансу будут удалены. Старые сообщения останутся обезличенными.</p></div>{confirming ? <div className="danger-confirm"><span>Удалить аккаунт без возможности восстановления?</span><button className="button button--danger button--small" onClick={() => void remove()} disabled={pending}>{pending ? <span className="spinner"/> : 'Удалить аккаунт'}</button><button className="button button--ghost button--small" onClick={() => setConfirming(false)}>Отмена</button></div> : <button className="button button--danger-outline" onClick={() => setConfirming(true)}>Удалить аккаунт</button>}</div>}
      {owner && <div className="instance-notice"><Icon name="lock"/><div><b>Владелец инстанса</b><p>Владелец не может удалить пространство или свой аккаунт из приложения.</p></div></div>}
      {error && <div className="form-error" role="alert">{error}</div>}
    </Modal>
  )
}
