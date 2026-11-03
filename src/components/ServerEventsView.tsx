import { useEffect, useRef, useState } from 'react'
import type { ServerEvent } from '../domain/community'
import type { VoxholdApi } from '../services/api'
import { featuresChanged } from '../services/communityEvents'
import { localDateInput } from '../lib/localDateInput'
import { Icon } from './Icon'
import { Modal } from './Modal'
import '../styles/community-features.css'
import '../styles/server-events.css'

interface Props { api: VoxholdApi; token: string; serverId: number | null; userId: number; admin: boolean; revision: number }
type Draft = { id?: number; title: string; description: string; date: string }
const problem = (error: unknown) => error instanceof Error ? error.message : 'Не удалось выполнить действие'
const dates = new Intl.DateTimeFormat('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })
const times = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' })
const months = new Intl.DateTimeFormat('ru-RU', { month: 'short' })

export function EventsView(props: Props) {
  // A different community/account must never inherit the previous event list or form.
  return <EventsAgenda key={`${props.serverId}:${props.userId}`} {...props}/>
}

function EventsAgenda({ api, token, serverId, userId, admin, revision }: Props) {
  const [items, setItems] = useState<ServerEvent[]>([])
  const [loading, setLoading] = useState(true), [loaded, setLoaded] = useState(false), [loadError, setLoadError] = useState('')
  const [retry, setRetry] = useState(0), [filter, setFilter] = useState<'upcoming' | 'recent'>('upcoming')
  const [editing, setEditing] = useState<Draft | null>(null), [cancelling, setCancelling] = useState<ServerEvent | null>(null)
  const [pending, setPending] = useState<number | 'create' | null>(null), [actionError, setActionError] = useState('')
  const [clock, setClock] = useState(Date.now())
  const operation = useRef<AbortController | null>(null)
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone

  useEffect(() => () => operation.current?.abort(), [])
  useEffect(() => {
    const update = () => { if (document.visibilityState !== 'hidden') setClock(Date.now()) }
    const timer = setInterval(update, 30_000)
    document.addEventListener('visibilitychange', update)
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', update) }
  }, [])
  useEffect(() => {
    if (!serverId) return
    const controller = new AbortController()
    setLoading(true); setLoadError('')
    void api.community.request<ServerEvent[]>(token, `/servers/${serverId}/events`, 'GET', undefined, controller.signal).then((value) => {
      if (controller.signal.aborted) return
      if (!Array.isArray(value)) throw new Error('Сервер вернул некорректный список событий')
      setItems(value); setLoaded(true); setClock(Date.now())
    }).catch((error) => { if (!controller.signal.aborted) setLoadError(problem(error)) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [api, token, serverId, revision, retry])

  const mutate = async (id: number | undefined, suffix: string, method: 'POST' | 'PUT' | 'DELETE', body?: unknown) => {
    if (!serverId || operation.current) return
    const controller = new AbortController()
    operation.current = controller; setPending(id ?? 'create'); setActionError('')
    try {
      await api.community.request(token, `/servers/${serverId}/events${id ? `/${id}` : ''}${suffix}`, method, body, controller.signal)
      if (controller.signal.aborted) return
      setEditing(null); setCancelling(null); setRetry((value) => value + 1); featuresChanged()
    } catch (error) { if (!controller.signal.aborted) setActionError(problem(error)) }
    finally { if (!controller.signal.aborted) { operation.current = null; setPending(null) } }
  }
  const create = () => {
    setActionError('')
    setEditing({ title: '', description: '', date: localDateInput(Date.now() / 1000 + 86400) })
  }
  if (!serverId) return <div className="server-events__empty"><Icon name="calendar" size={40}/><h2>Выберите сообщество</h2><p>Здесь будут его встречи и планы.</p></div>
  const upcoming = items.filter((item) => !item.cancelled && item.starts_at * 1000 > clock).sort((a, b) => a.starts_at - b.starts_at || a.id - b.id)
  const recent = items.filter((item) => item.cancelled || item.starts_at * 1000 <= clock).sort((a, b) => b.starts_at - a.starts_at || b.id - a.id)
  const visible = filter === 'upcoming' ? upcoming : recent

  return <div className="personal-scroll"><div className="server-events">
    <div className="server-events__heading"><div><span className="eyebrow">ПЛАНЫ СООБЩЕСТВА</span><h2>Встретимся здесь</h2><p>Собирайтесь на игры, обсуждения и общие дела.</p></div><button type="button" className="button button--primary" disabled={pending !== null} onClick={create}><Icon name="add" size={18}/>Создать событие</button></div>
    <div className="server-events__info"><span><Icon name="clock" size={16}/>Ваше время · <b>{timezone}</b></span><span><Icon name="bell" size={16}/>Напомним за 15 минут после ответа «Пойду» или «Возможно»</span></div>
    <div className="server-events__toolbar"><div className="server-events__filters" role="group" aria-label="Показать события">
      <button type="button" aria-pressed={filter === 'upcoming'} onClick={() => setFilter('upcoming')}>Предстоящие <span aria-hidden="true">{upcoming.length}</span></button>
      <button type="button" aria-pressed={filter === 'recent'} onClick={() => setFilter('recent')}>Недавние <span aria-hidden="true">{recent.length}</span></button>
    </div><button type="button" className="icon-button" disabled={loading} aria-label="Обновить события" title="Обновить события" onClick={() => setRetry((value) => value + 1)}><Icon name="refresh" size={18}/></button></div>
    {loadError && <div className="server-events__error" role="alert"><Icon name="warning" size={18}/><span>{loadError}</span><button type="button" className="button button--small button--secondary" disabled={loading} onClick={() => setRetry((value) => value + 1)}>Повторить загрузку</button></div>}
    {actionError && !editing && !cancelling && <div className="server-events__error" role="alert">{actionError}</div>}
    {loading && !loaded && !loadError && <div role="status" className="server-events__loading"><span className="spinner"/>Загружаем события…</div>}
    {loaded && !visible.length && !loadError && <div className="server-events__empty"><span><Icon name={filter === 'upcoming' ? 'calendar' : 'clock'} size={38}/></span><h3>{filter === 'upcoming' ? 'Пока без планов' : 'Здесь пока тихо'}</h3><p>{filter === 'upcoming' ? 'Запланируйте первую встречу — участники смогут присоединиться, а мы напомним о начале.' : 'Здесь появятся события, прошедшие за последние сутки, и отменённые встречи.'}</p>{filter === 'upcoming' && <button type="button" className="button button--secondary" disabled={pending !== null} onClick={create}>Запланировать встречу<Icon name="add" size={16}/></button>}</div>}
    <div className="server-events__list feature-list" aria-busy={loading}>
      {visible.map((item) => {
        const at = new Date(item.starts_at * 1000), active = !item.cancelled && item.starts_at * 1000 > clock
        const responding = pending === item.id
        return <article className={`server-event ${item.cancelled ? 'is-cancelled' : ''}`} key={item.id} aria-label={item.title}>
          <div className="server-event__date" aria-hidden="true"><span>{months.format(at).replace('.', '')}</span><b>{at.getDate()}</b></div>
          <div className="server-event__body"><div className="server-event__top"><time dateTime={at.toISOString()}>{dates.format(at)} · {times.format(at)}</time><span className={`server-event__status ${active ? 'is-upcoming' : ''}`}>{item.cancelled ? 'Отменено' : active ? 'Скоро' : 'Началось'}</span></div><h3>{item.title}</h3>{item.description && <p>{item.description}</p>}
            <div className="server-event__attendance"><Icon name="people" size={16}/><span>Пойдут: {item.going}</span><span>Возможно: {item.maybe}</span></div>
            {active && <div className="server-event__actions"><div className="server-event__responses" role="group" aria-label={`Ваш ответ: ${item.title}`}>{(['going', 'maybe'] as const).map((response) => <button type="button" key={response} aria-pressed={item.response === response} disabled={pending !== null} onClick={() => void mutate(item.id, '/response', item.response === response ? 'DELETE' : 'PUT', item.response === response ? undefined : { response })}><Icon name={response === 'going' ? 'check' : 'clock'} size={16}/>{response === 'going' ? 'Пойду' : 'Возможно'}</button>)}</div>{(admin || item.creator_user_id === userId) && <div className="server-event__manage"><button type="button" className="icon-button" disabled={pending !== null} aria-label={`Изменить: ${item.title}`} title="Изменить событие" onClick={() => { setActionError(''); setEditing({ id: item.id, title: item.title, description: item.description, date: localDateInput(item.starts_at) }) }}><Icon name="edit" size={17}/></button><button type="button" className="icon-button" disabled={pending !== null} aria-label={`Отменить событие: ${item.title}`} title="Отменить событие" onClick={() => { setActionError(''); setCancelling(item) }}><Icon name="close" size={17}/></button></div>}{responding && <span className="sr-only" role="status">Сохраняем ответ…</span>}</div>}
          </div>
        </article>
      })}
    </div>
    {editing && <Modal open title={editing.id ? 'Изменить событие' : 'Создать событие'} eyebrow="ПЛАНЫ СООБЩЕСТВА" onClose={() => { if (!operation.current) setEditing(null) }}><form className="feature-form server-event-form" onSubmit={(event) => {
      event.preventDefault()
      const startsAt = Math.floor(new Date(editing.date).getTime() / 1000)
      if (!editing.title.trim()) { setActionError('Укажите название события'); return }
      if (!Number.isFinite(startsAt) || startsAt <= Date.now() / 1000) { setActionError('Выберите дату и время в будущем'); return }
      void mutate(editing.id, '', editing.id ? 'PUT' : 'POST', { title: editing.title.trim(), description: editing.description.trim(), starts_at: startsAt, timezone })
    }}><fieldset disabled={pending !== null}><label>Название<input required maxLength={150} placeholder="Например, вечер настольных игр" value={editing.title} onChange={(event) => setEditing({ ...editing, title: event.target.value })}/></label><label>Описание<textarea maxLength={3000} placeholder="Что планируем и как подготовиться" value={editing.description} onChange={(event) => setEditing({ ...editing, description: event.target.value })}/></label><label>Дата и время<input aria-label="Дата и время" required type="datetime-local" value={editing.date} onChange={(event) => setEditing({ ...editing, date: event.target.value })}/><small>Ваш часовой пояс: {timezone}</small></label></fieldset>{actionError && <p className="form-error" role="alert">{actionError}</p>}<div className="server-event-form__footer"><button type="button" className="button button--ghost" disabled={pending !== null} onClick={() => setEditing(null)}>Назад</button><button className="button button--primary" disabled={pending !== null}>{pending !== null ? 'Сохраняем…' : 'Сохранить'}</button></div></form></Modal>}
    {cancelling && <Modal open title="Отменить событие" onClose={() => { if (!operation.current) setCancelling(null) }}><div className="feature-form"><p>Отменить «{cancelling.title}»? Участники увидят статус отмены, напоминание не придёт.</p>{actionError && <p className="form-error" role="alert">{actionError}</p>}<div className="server-event-form__footer"><button type="button" className="button button--secondary" disabled={pending !== null} onClick={() => setCancelling(null)}>Оставить событие</button><button type="button" className="button button--danger" disabled={pending !== null} onClick={() => void mutate(cancelling.id, '', 'DELETE')}>{pending !== null ? 'Отменяем…' : 'Отменить событие'}</button></div></div></Modal>}
  </div></div>
}
