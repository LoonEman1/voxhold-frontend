import { CustomRoleBadges, useCommunity } from './Community'
import { RoleManager, StorageManager } from './CommunitySettings'
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import type { Channel, ChannelKind, Profile, RecordingStorage, Server, ServerRole } from '../domain/types'
import { countryByCode } from '../lib/countries'
import { formatDate, humanError } from '../lib/format'
import { roleMeta } from '../lib/roles'
import { Avatar } from './Avatar'
import { MemberPresence, usePresenceClock } from './MemberPresence'
import { AvatarEditor } from './AvatarEditor'
import type { AvatarCrop } from '../lib/avatarCrop'
import { CountryFlag, CountrySelect } from './CountrySelect'
import { Icon } from './Icon'
import { Modal } from './Modal'
import { useTheme } from '../theme/ThemeContext'

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
          <label className={kind === 'news' ? 'is-selected' : ''}><input type="radio" name="kind" checked={kind === 'news'} onChange={() => setKind('news')}/><span className="kind-icon"><Icon name="news"/></span><span><b>Новостной</b><small>Публикации авторов, реакции и комментарии</small></span><i/></label>
          <label className={kind === 'voice'  ? 'is-selected' : ''}><input type="radio" name="kind" checked={kind === 'voice'} onChange={() => setKind('voice')}/><span className="kind-icon"><Icon name="volume"/></span><span><b>Голосовой</b><small>Для живых разговоров</small></span><i/></label>
        </fieldset>
        <label><span>Название канала</span><div className="input-with-prefix"><Icon name={kind === 'news' ? 'news' : kind === 'text' ? 'hash' : 'volume'} size={16}/><input value={name} onChange={(e) => setName(e.target.value)} placeholder="новый-канал" maxLength={64} required /></div></label>
        {error && <div className="form-error" role="alert">{error}</div>}
        <div className="dialog-actions"><button className="button button--ghost" type="button" onClick={onClose}>Отмена</button><button className="button button--primary" disabled={pending}>{pending ? <span className="spinner"/> : 'Создать канал'}</button></div>
      </form>
    </Modal>
  )
}

export { InviteUserDialog } from './InviteUserDialog'

export function ProfileDialog({ open, onClose, profile, onSubmit, onAvatar, hasAvatar = false, onDeleteAccount }: AsyncDialogProps & { profile: Profile | null; onDeleteAccount?: () => Promise<void>; hasAvatar?: boolean; onAvatar?: (file: File | null, crop?: AvatarCrop) => Promise<void>; onSubmit(patch: { about: string; country_code: string }): Promise<void> }) {
  const { theme, toggleTheme } = useTheme()
  const [about, setAbout] = useState('')
  const [country, setCountry] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const [avatarPending, setAvatarPending] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleteName, setDeleteName] = useState('')
  const [deletePending, setDeletePending] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  useEffect(() => { if (open) { setConfirmingDelete(false); setDeleteName(''); setDeleteError('') } }, [open, profile?.user_id])
  const removeAccount = async () => {
    if (!onDeleteAccount || !profile?.username || deleteName !== profile.username || deletePending || pending || avatarPending) return
    setDeletePending(true); setDeleteError('')
    try { await onDeleteAccount(); onClose() } catch (caught) { setDeleteError(humanError(caught)) } finally { setDeletePending(false) }
  }
  useEffect(() => { if (open) { setAbout(profile?.about ?? ''); setCountry(profile?.country_code ?? ''); setError('') } }, [open, profile])
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (pending || avatarPending || deletePending) return; setPending(true); setError('')
    try { await onSubmit({ about: about.trim(), country_code: country }); onClose() } catch (caught) { setError(humanError(caught)) } finally { setPending(false) }
  }
  return (
    <Modal open={open} onClose={() => { if (!deletePending) onClose() }} title="Ваш профиль" eyebrow="КАК ВАС ВИДЯТ ДРУГИЕ" size="medium">
      <div className="profile-hero">{onAvatar ? open && <AvatarEditor key={profile?.user_id} userId={profile?.user_id} name={profile?.username ?? 'V'} hasAvatar={hasAvatar} disabled={pending || deletePending} onSave={onAvatar} onBusyChange={setAvatarPending}><h3>@{profile?.username}</h3><p>В Voxhold с {profile ? formatDate(profile.created_at) : 'недавно'}</p></AvatarEditor> : <><Avatar userId={profile?.user_id} name={profile?.username ?? 'V'} size="large"/><div><h3>@{profile?.username}</h3><p>В Voxhold с {profile ? formatDate(profile.created_at) : 'недавно'}</p></div></>}</div>
      <form className="dialog-form" onSubmit={submit}>
        <label><span>О себе <small>{about.length}/512</small></span><textarea value={about} onChange={(e) => setAbout(e.target.value)} maxLength={512} rows={4} placeholder="Пара слов о себе, интересах или текущем проекте…" /></label>
        <label><span>Страна проживания</span><CountrySelect value={country} onChange={setCountry} /></label>
        {error && <div className="form-error" role="alert">{error}</div>}
        <div className="dialog-actions"><button className="button button--ghost" type="button" onClick={onClose}>Отмена</button><button className="button button--primary" disabled={pending || avatarPending || deletePending}>{pending ? <span className="spinner"/> : 'Сохранить'}</button></div>
      </form>
      <section className="profile-appearance" aria-label="Оформление"><h3>Оформление</h3><button type="button" className="button button--ghost theme-toggle" onClick={toggleTheme} aria-label={theme === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему'}><Icon name={theme === 'dark' ? 'sun' : 'moon'}/>{theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}</button></section>
      {onDeleteAccount && <section className="danger-zone" aria-label="Опасная зона">
        <div><h3>Опасная зона</h3><p>Удаление аккаунта удалит профиль, настройки и доступ к этому инстансу. Старые сообщения останутся обезличенными. Это действие нельзя отменить.</p></div>
        {confirmingDelete ? <div className="danger-confirm dialog-form">
          <label><span>Для подтверждения введите имя пользователя: {profile?.username}</span><input aria-label="Имя пользователя для удаления аккаунта" value={deleteName} onChange={(event) => setDeleteName(event.target.value)} autoComplete="off" spellCheck={false} disabled={deletePending}/></label>
          <button type="button" className="button button--danger button--small" onClick={() => void removeAccount()} disabled={!profile?.username || deleteName !== profile.username || deletePending || pending || avatarPending}>{deletePending ? <span className="spinner"/> : 'Удалить аккаунт навсегда'}</button>
          <button type="button" className="button button--ghost button--small" onClick={() => { setConfirmingDelete(false); setDeleteName(''); setDeleteError('') }} disabled={deletePending}>Отменить удаление</button>
        </div> : <button type="button" className="button button--danger-outline" onClick={() => setConfirmingDelete(true)} disabled={pending || avatarPending}>Удалить аккаунт</button>}
        {deleteError && <div className="form-error" role="alert">{deleteError}</div>}
      </section>}
    </Modal>
  )
}

export function MemberProfileDialog({ onMessage, online = false, open, onClose, profile, role, loading, error, canChangeRole, canBan, onRoleChange, onBan }: AsyncDialogProps & { onMessage?: () => void; online?: boolean; profile: Profile | null; role: ServerRole; loading: boolean; error: string; canChangeRole: boolean; canBan: boolean; onRoleChange(role: Exclude<ServerRole, 'owner'>): Promise<void>; onBan(): Promise<void> }) {
  const now = usePresenceClock(open)
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
        <div className="member-profile-avatar-slot" aria-label="Фотография профиля"><Avatar userId={profile.user_id} name={profile.username} size="large"/></div>
        <div className="member-profile-head"><div><h3>{profile.username}</h3><span>@{profile.username}</span></div><span className={`role-badge role-badge--${role}`}>{roleMeta[role].label}</span></div>
        <div className="member-profile-presence"><MemberPresence online={online} lastSeenAt={profile.last_seen_at} now={now}/></div>
        <dl className="profile-facts">
          <div><dt>В Voxhold с</dt><dd>{formatDate(profile.created_at)}</dd></div>
          <div><dt>Страна проживания</dt><dd>{country ? <><CountryFlag code={country.code}/> {country.name}</> : 'Не указана'}</dd></div>
        </dl>
        <section className="profile-about"><span>ОБО МНЕ</span><p>{profile.about || 'Пользователь пока ничего о себе не рассказал.'}</p></section>
        {(canChangeRole || canBan) && <section className="member-management">
          <div><span>УПРАВЛЕНИЕ УЧАСТНИКОМ</span><p>Изменения сразу увидят все участники сервера.</p></div>
          <CustomRoleBadges userId={profile.user_id}/>{onMessage && <button className="button button--primary" onClick={onMessage}>Написать</button>}
          {canChangeRole && <div className="member-role-control"><span>Роль</span><div><button className={role === 'member' ? 'is-active' : ''} onClick={() => void changeRole('member')} disabled={pending}>Участник</button><button className={role === 'admin' ? 'is-active' : ''} onClick={() => void changeRole('admin')} disabled={pending}>Администратор</button></div></div>}
          {canBan && <div className="member-kick-control">{confirmKick ? <><span>Забанить аккаунт {profile.username} на всём инстансе?</span><button className="button button--danger button--small" onClick={() => void ban()} disabled={pending}>{pending ? <span className="spinner"/> : 'Забанить'}</button><button className="button button--ghost button--small" onClick={() => setConfirmKick(false)} disabled={pending}>Отмена</button></> : <button className="button button--danger-outline button--small" onClick={() => setConfirmKick(true)}>Забанить аккаунт</button>}</div>}
          {manageError && <div className="form-error" role="alert">{manageError}</div>}
        </section>}
      </div>}
    </Modal>
  )
}

export function ChannelSettingsDialog({ open, onClose, channel, onRename, onRemove, accessPanel }: AsyncDialogProps & { accessPanel?: ReactNode; channel: Channel | null; onRename(name: string): Promise<void>; onRemove(): Promise<void> }) {
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const [confirming, setConfirming] = useState(false)
  useEffect(() => { if (open) { setName(channel?.name ?? ''); setError(''); setConfirming(false) } }, [open, channel?.id, channel?.name])
  const rename = async (event: FormEvent) => {
    event.preventDefault(); setPending(true); setError('')
    try { await onRename(name.trim().toLowerCase().replace(/\s+/g, '-')); onClose() } catch (caught) { setError(humanError(caught)) } finally { setPending(false) }
  }
  const remove = async () => {
    setPending(true); setError('')
    try { await onRemove(); onClose() } catch (caught) { setError(humanError(caught)) } finally { setPending(false) }
  }
  return (
    <Modal open={open} onClose={onClose} title="Изменить канал" eyebrow={channel?.kind === 'news' ? 'НОВОСТНОЙ КАНАЛ' : channel?.kind === 'voice' ? 'ГОЛОСОВОЙ КАНАЛ' : 'ТЕКСТОВЫЙ КАНАЛ'} size="medium">
      <form className="dialog-form settings-section" onSubmit={rename}>
        <div><h3>Название канала</h3><p>Тип канала останется прежним.</p></div>
        <label><span>Название</span><div className="input-with-prefix"><Icon name={channel?.kind === 'news' ? 'news' : channel?.kind === 'voice' ? 'volume' : 'hash'} size={16}/><input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} required /></div></label>
        <button className="button button--secondary align-self-end" disabled={pending}>Сохранить</button>
      </form>
      {accessPanel}
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
  onDownloadDiagnostics(): Promise<void>
  onSaveCorsOrigins(origins: string[]): Promise<string[]>
  recordingStorage?: RecordingStorage | null
  onSaveRecordingQuota?(quotaBytes: number): Promise<void>
  storageApi?: import('../services/api').VoxholdApi
  storageToken?: string
}

const GIB = 2 ** 30
const gib = (bytes: number) => (bytes / GIB).toLocaleString('ru-RU', { maximumFractionDigits: 1 })

export function ServerSettingsDialog({
  open,
  onClose,
  server,
  corsOrigins,
  corsOriginsLoading,
  onRename,
  onDownloadDiagnostics,
  onSaveCorsOrigins,
  recordingStorage = null,
  onSaveRecordingQuota,
  storageApi, storageToken,
}: ServerSettingsDialogProps) {
  const community = useCommunity()
  const [tab, setTab] = useState<'general' | 'roles' | 'storage'>('general')
  useEffect(() => { if (open) setTab('general') }, [open])
  const [name, setName] = useState('')
  const [corsValue, setCorsValue] = useState('')
  const [quotaValue, setQuotaValue] = useState('')
  const [quotaPending, setQuotaPending] = useState(false)
  useEffect(() => {
    if (open && recordingStorage) setQuotaValue(String(Math.round(recordingStorage.quota_bytes / GIB)))
  }, [open, recordingStorage])
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const [diagnosticsPending, setDiagnosticsPending] = useState(false)
  const [corsPending, setCorsPending] = useState(false)
  useEffect(() => {
    if (open) {
      setName(server?.name ?? '')
      setCorsValue((corsOrigins ?? []).join('\n'))
      setError('')
    }
  }, [corsOrigins, open, server])
  const rename = async (event: FormEvent) => {
    event.preventDefault(); setPending(true); setError('')
    try { await onRename(name.trim()) } catch (caught) { setError(humanError(caught)) } finally { setPending(false) }
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
  const saveRecordingQuota = async (event: FormEvent) => {
    event.preventDefault()
    if (quotaPending || !recordingStorage || !onSaveRecordingQuota) return
    const value = Number(quotaValue)
    const min = recordingStorage.min_quota_bytes / GIB, max = recordingStorage.max_quota_bytes / GIB
    if (!Number.isInteger(value) || value < min || value > max) { setError(`Лимит записей — целое число от ${min} до ${max} ГБ`); return }
    setQuotaPending(true); setError('')
    try { await onSaveRecordingQuota(value * GIB) } catch (caught) { setError(humanError(caught)) } finally { setQuotaPending(false) }
  }
  return (
    <Modal open={open} onClose={onClose} title="Настройки сервера" eyebrow={server?.name.toUpperCase()} size="medium">
      {owner && storageApi && <nav className="server-settings-tabs" aria-label="Раздел настроек сервера">{([['general', 'settings', 'Основное'], ['roles', 'people', 'Роли и права'], ['storage', 'inbox', 'Хранилище']] as const).map(([value, icon, label]) => <button key={value} aria-pressed={tab === value} onClick={() => setTab(value)}><Icon name={icon} size={17}/>{label}</button>)}</nav>}
      {tab === 'roles' && open && owner && storageApi && storageToken && server && <RoleManager api={storageApi} token={storageToken} serverId={server.id} members={community?.members ?? []}/>}
      {tab === 'storage' && open && owner && storageApi && storageToken && <StorageManager api={storageApi} token={storageToken}/>}
      {tab === 'general' && <>
      {owner && <form className="dialog-form settings-section" onSubmit={rename}><div><h3>Название</h3><p>Его увидят все участники пространства.</p></div><label><span>Название сервера</span><input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required /></label><button className="button button--secondary align-self-end" disabled={pending}>Сохранить</button></form>}
      {owner && <form className="dialog-form settings-section" onSubmit={saveCorsOrigins}><div><h3>Доступ внешних клиентов</h3><p>Разрешите браузерным клиентам на других доменах обращаться к API и WebSocket этого инстанса.</p></div><label><span>Разрешённые origin</span><textarea rows={5} value={corsValue} onChange={(event) => setCorsValue(event.target.value)} disabled={corsOriginsLoading || corsPending} placeholder={corsOriginsLoading ? 'Загрузка…' : 'https://client.example.com\nhttp://localhost:5173'} spellCheck={false}/></label><small className="field-hint">По одному точному origin на строку: схема, домен и необязательный порт. Без пути и wildcard.</small><button className="button button--secondary align-self-end" disabled={corsOriginsLoading || corsPending}>{corsPending ? <span className="spinner"/> : 'Сохранить CORS'}</button></form>}
      {owner && !storageApi && onSaveRecordingQuota && <form className="dialog-form settings-section" onSubmit={saveRecordingQuota}><div><h3>Хранилище записей</h3><p>Сколько места на сервере можно занять копиями записей звонков. Копия хранится 24 часа; файл больше 2 ГБ или сверх лимита остаётся только у записавшего.</p></div><label><span>Лимит, ГБ</span><input type="number" inputMode="numeric" step={1} min={recordingStorage ? recordingStorage.min_quota_bytes / GIB : 1} max={recordingStorage ? recordingStorage.max_quota_bytes / GIB : undefined} value={quotaValue} onChange={(event) => setQuotaValue(event.target.value)} disabled={!recordingStorage || quotaPending} placeholder={recordingStorage ? undefined : 'Загрузка…'}/></label><small className="field-hint">{recordingStorage ? `Занято ${gib(recordingStorage.used_bytes)} из ${gib(recordingStorage.quota_bytes)} ГБ · по умолчанию ${gib(recordingStorage.default_quota_bytes)} ГБ. Уменьшение не удаляет уже сохранённые копии — они исчезнут по истечении 24 часов.` : 'Загружаем текущий лимит…'}</small><button className="button button--secondary align-self-end" disabled={!recordingStorage || quotaPending}>{quotaPending ? <span className="spinner"/> : 'Сохранить лимит'}</button></form>}
      {owner && <div className="dialog-form settings-section"><div><h3>Диагностика клиентов</h3><p>HTTP, WebSocket и WebRTC-метрики автоматически хранятся на сервере 24 часа. Секреты, сообщения, SDP и ICE-адреса удаляются.</p></div><button className="button button--secondary align-self-end" type="button" disabled={diagnosticsPending} onClick={() => void downloadDiagnostics()}>{diagnosticsPending ? <span className="spinner"/> : 'Скачать JSON'}</button></div>}
      {owner && <div className="instance-notice"><Icon name="lock"/><div><b>Владелец инстанса</b><p>Владелец не может удалить пространство или свой аккаунт из приложения.</p></div></div>}
      {error && <div className="form-error" role="alert">{error}</div>}
      </>}
    </Modal>
  )
}
