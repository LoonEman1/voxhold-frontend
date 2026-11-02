import { useEffect, useMemo, useRef, useState } from 'react'
import type { AuditEntry } from '../domain/community'
import type { ServerMember } from '../domain/types'
import type { VoxholdApi } from '../services/api'
import { Avatar } from './Avatar'
import { Icon } from './Icon'
import '../styles/audit.css'

const actions: Record<string, string> = {
  'channel.created': 'Создание канала', 'channel.updated': 'Изменение канала', 'channel.deleted': 'Удаление канала',
  'channel.permissions': 'Изменение доступа к каналу', 'member.permissions': 'Изменение ролей участника',
  'member.banned': 'Блокировка участника', 'member.unbanned': 'Снятие блокировки', 'member.timeout': 'Тайм-аут участника',
  'message.deleted': 'Удаление сообщения', 'role.created': 'Создание роли', 'role.updated': 'Изменение роли', 'role.deleted': 'Удаление роли',
}
const detailNames: Record<string, string> = {
  reason: 'Причина', until: 'До', name: 'Название', old_name: 'Прежнее название', new_name: 'Новое название',
  before: 'До изменения', after: 'После изменения', role: 'Роль', permissions: 'Разрешения', restricted: 'Закрытый доступ',
}
const date = (seconds: number) => new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short' }).format(seconds * 1000)
const problem = (error: unknown) => error instanceof Error ? error.message : 'Не удалось загрузить журнал'
interface Page { items: AuditEntry[]; has_more: boolean }

function description(entry: AuditEntry) {
  if (entry.action === 'member.timeout' && entry.details?.until === null) return 'Снятие тайм-аута'
  return actions[entry.action] ?? 'Изменение настроек'
}

function detailValue(key: string, value: unknown) {
  if (key === 'permissions' && typeof value === 'number') return [[1, 'Чтение'], [2, 'Сообщения'], [4, 'Голос'], [8, 'Трансляции'], [16, 'Модерация']].filter(([bit]) => (value & Number(bit)) !== 0).map(([, name]) => name).join(', ') || 'Нет разрешений'
  if (key === 'role' && typeof value === 'string') return ({ owner: 'Владелец', admin: 'Администратор', member: 'Участник' } as Record<string, string>)[value] ?? value
  if (key === 'until') return typeof value === 'number' ? date(value) : 'Без тайм-аута'
  if (typeof value === 'boolean') return value ? 'Да' : 'Нет'
  if (value === null) return 'Не задано'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

export function AuditView({ api, token, serverId, members = [] }: { api: VoxholdApi; token: string; serverId: number | null; members?: ServerMember[] }) {
  const [items, setItems] = useState<AuditEntry[]>([]), [actor, setActor] = useState(''), [action, setAction] = useState('')
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [more, setMore] = useState(false), [revision, setRevision] = useState(0)
  const [knownActors, setKnownActors] = useState<Record<string, string>>({})
  const generation = useRef(0), olderRequest = useRef<AbortController | null>(null)
  const filters = useMemo(() => {
    const query = new URLSearchParams()
    if (actor) query.set('actor_id', actor)
    if (action) query.set('action', action)
    return query.toString()
  }, [actor, action])
  const remember = (entries: AuditEntry[]) => setKnownActors((current) => ({ ...current, ...Object.fromEntries(entries.filter((entry) => entry.actor_user_id !== null).map((entry) => [String(entry.actor_user_id), entry.actor_name])) }))

  useEffect(() => {
    const current = ++generation.current, controller = new AbortController()
    olderRequest.current?.abort(); olderRequest.current = null
    setItems([]); setMore(false); setError(''); setBusy(!!serverId)
    if (serverId) void api.community.request<Page>(token, `/servers/${serverId}/audit?${filters}`, 'GET', undefined, controller.signal).then((page) => {
      if (controller.signal.aborted || generation.current !== current) return
      setItems(page.items); setMore(page.has_more); remember(page.items); setBusy(false)
    }).catch((caught: unknown) => { if (!controller.signal.aborted && generation.current === current) { setError(problem(caught)); setBusy(false) } })
    return () => { controller.abort(); olderRequest.current?.abort() }
  }, [api, token, serverId, filters, revision])

  const older = async () => {
    if (busy || !serverId || !more || !items.length) return
    const current = generation.current, controller = new AbortController()
    olderRequest.current = controller
    setBusy(true); setError('')
    try {
      const query = new URLSearchParams(filters); query.set('before', String(items.at(-1)!.id))
      const page = await api.community.request<Page>(token, `/servers/${serverId}/audit?${query}`, 'GET', undefined, controller.signal)
      if (controller.signal.aborted || generation.current !== current) return
      setItems((values) => [...new Map([...values, ...page.items].map((entry) => [entry.id, entry])).values()].sort((a, b) => b.id - a.id))
      setMore(page.has_more); remember(page.items)
    } catch (caught) { if (!controller.signal.aborted && generation.current === current) setError(problem(caught)) }
    finally { if (!controller.signal.aborted && generation.current === current) { olderRequest.current = null; setBusy(false) } }
  }
  const actors = { ...knownActors, ...Object.fromEntries(members.map((member) => [String(member.user_id), member.username])) }
  const choices = Object.entries(actors).sort((a, b) => a[1].localeCompare(b[1], 'ru'))
  const emptyTarget: Record<string, string> = { user: 'Участник', channel: 'Канал', role: 'Роль', message: 'Сообщение', server: 'Сообщество' }
  const missingTarget: Record<string, string> = { user: 'Участник удалён или недоступен', channel: 'Канал удалён или недоступен', role: 'Роль удалена или недоступна', message: 'Удалённое сообщение', server: 'Сообщество недоступно' }
  return <div className="personal-scroll"><section className="personal-page audit-log" aria-label="Записи журнала администрации">
    <div className="audit-log__intro"><span><Icon name="audit" size={25}/></span><div><h2>История изменений</h2><p>Кто изменил настройки, роли и доступ в этом сообществе. Записи появляются автоматически после действий администрации.</p></div></div>
    {!serverId ? <p>Выберите сообщество, чтобы посмотреть его журнал.</p> : <>
      <div className="audit-log__filters">
        <label>Кто выполнил действие<select value={actor} onChange={(event) => setActor(event.target.value)}><option value="">Все участники</option>{choices.map(([id, name]) => <option value={id} key={id}>{name}</option>)}</select></label>
        <label>Действие<select value={action} onChange={(event) => setAction(event.target.value)}><option value="">Все действия</option>{Object.entries(actions).map(([id, name]) => <option value={id} key={id}>{name}</option>)}</select></label>
        <button className="button button--secondary" disabled={busy} onClick={() => setRevision((value) => value + 1)}>Обновить</button>
        {(actor || action) && <button className="button button--ghost" onClick={() => { setActor(''); setAction('') }}>Сбросить фильтры</button>}
      </div>
      <p className="audit-log__hint">В фильтре выбирается автор действия. В записи ниже показано, кого или чего коснулось изменение. По нажатию на имя можно оставить только действия этого человека.</p>
      <div className="audit-log__entries">{items.map((entry) => {
        const details = Object.entries(entry.details ?? {}).filter(([key]) => key in detailNames)
        return <article className="audit-log__entry" key={entry.id}>
          <Avatar userId={entry.actor_user_id ?? undefined} name={entry.actor_name || 'Администратор'}/>
          <div><div className="audit-log__entry-heading">{entry.actor_user_id ? <button className="feature-link" title={`Показать действия ${entry.actor_name}`} onClick={() => setActor(String(entry.actor_user_id))}>{entry.actor_name}</button> : <b>{entry.actor_name || 'Удалённый участник'}</b>}<time dateTime={new Date(entry.created_at * 1000).toISOString()}>{date(entry.created_at)}</time></div>
            <p className="audit-log__action">{description(entry)}</p><p className="audit-log__target">{entry.target_name ? `${emptyTarget[entry.target_type] ?? 'Объект'}: ${entry.target_name}` : missingTarget[entry.target_type] ?? 'Объект недоступен'}</p>
            {details.length > 0 && <dl className="audit-log__details">{details.map(([key, value]) => <div key={key}><dt>{detailNames[key]}</dt><dd>{detailValue(key, value)}</dd></div>)}</dl>}
          </div>
        </article>
      })}</div>
      {busy && <p role="status">Загружаем записи…</p>}{error && <p role="alert">{error}</p>}
      {!busy && !error && !items.length && <div className="audit-log__empty"><Icon name="audit" size={28}/><h3>{actor || action ? 'Записей по этим фильтрам нет' : 'Пока всё без изменений'}</h3><p>{actor || action ? 'Попробуйте выбрать другого участника или сбросить фильтры.' : 'Здесь появятся изменения каналов и ролей, блокировки и другие действия администрации.'}</p></div>}
      {more && <button className="button button--secondary" disabled={busy} onClick={() => void older()}>Показать более ранние записи</button>}
    </>}
  </section></div>
}
