import { useEffect, useState } from 'react'
import type { FeatureDestination, ScheduledMessage } from '../domain/community'
import type { VoxholdApi } from '../services/api'
import { communityPages } from '../services/communityPages'
import { featuresChanged } from '../services/communityEvents'
import { Modal } from './Modal'
import { Icon } from './Icon'
import '../styles/community-features.css'

const problem = (error: unknown) => error instanceof Error ? error.message : 'Не удалось выполнить действие'
const when = (seconds: number) => new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short' }).format(seconds * 1000)
const dateInput = (seconds: number) => {
  const date = new Date(seconds * 1000)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

export function ScheduledMessagesDialog({ api, token, destination, onClose }: { api: VoxholdApi; token: string; destination: FeatureDestination; onClose: () => void }) {
  return <Modal open title="Отложенные сообщения" size="medium" onClose={onClose}><ScheduledMessages key={`${destination.kind}:${destination.id}`} api={api} token={token} destination={destination}/></Modal>
}

export function ScheduledMessages({ api, token, destination }: { api: VoxholdApi; token: string; destination: FeatureDestination }) {
  const [items, setItems] = useState<ScheduledMessage[]>([]), [error, setError] = useState(''), [loading, setLoading] = useState(true)
  const [revision, setRevision] = useState(0), [busy, setBusy] = useState(false), [edit, setEdit] = useState<ScheduledMessage | null>(null)
  const [text, setText] = useState(''), [sendAt, setSendAt] = useState(''), [pollClosesAt, setPollClosesAt] = useState('')
  const { kind, id } = destination
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true); setError(''); setItems([])
    const query = new URLSearchParams({ destination_kind: kind, destination_id: String(id) })
    void communityPages<ScheduledMessage>(api, token, `/me/scheduled-messages?${query}`, 'scheduled_messages', controller.signal).then((values) => {
      if (controller.signal.aborted) return
      // Old servers ignore the new query parameters. Keep the dialog scoped
      // even with those servers, and exclude completed/cancelled messages.
      setItems(values.filter((item) => item.destination.kind === kind && item.destination.id === id && (item.status === 'pending' || item.status === 'failed')).sort((a, b) => a.send_at - b.send_at || a.id - b.id))
      setLoading(false)
    }).catch((caught: unknown) => { if (!controller.signal.aborted) { setError(problem(caught)); setLoading(false) } })
    return () => controller.abort()
  }, [api, token, kind, id, revision])
  useEffect(() => {
    const changed = () => setRevision((value) => value + 1)
    const event = (value: Event) => { const type = (value as CustomEvent<{ type?: string }>).detail?.type; if (!type || type === 'conversation.scheduled') changed() }
    window.addEventListener('voxhold:community', event)
    window.addEventListener('focus', changed)
    return () => { window.removeEventListener('voxhold:community', event); window.removeEventListener('focus', changed) }
  }, [])
  const action = async (request: () => Promise<unknown>) => {
    if (busy) return
    setBusy(true); setError('')
    try { await request(); setEdit(null); setRevision((value) => value + 1); featuresChanged() }
    catch (caught) { setError(problem(caught)) }
    finally { setBusy(false) }
  }
  const save = () => {
    if (!edit) return
    const at = Math.floor(new Date(sendAt).getTime() / 1000), closesAt = Math.floor(new Date(pollClosesAt).getTime() / 1000)
    if (!Number.isFinite(at) || at <= Date.now() / 1000) { setError('Укажите время отправки в будущем'); return }
    if (edit.payload.poll && (!Number.isFinite(closesAt) || closesAt <= at)) { setError('Опрос должен завершаться позже времени отправки'); return }
    void action(() => api.community.request(token, `/me/scheduled-messages/${edit.id}`, 'PUT', {
      destination: edit.destination,
      payload: { ...edit.payload, content: text.trim(), ...(edit.payload.poll ? { poll: { ...edit.payload.poll, question: text.trim(), closes_at: closesAt } } : {}) },
      send_at: at,
    }))
  }
  return <section className="scheduled-chat" aria-label="Отложенные сообщения этого чата">
    <p className="feature-hint">Здесь только ваши сообщения для этого чата. Сервер отправит их в указанное время, даже если приложение закрыто.</p>
    <p className="feature-hint">Часовой пояс: {Intl.DateTimeFormat().resolvedOptions().timeZone}</p>
    {loading && <p role="status">Загружаем отложенные сообщения…</p>}
    {!loading && !items.length && !error && <div className="scheduled-chat__empty"><Icon name="clock" size={30}/><h3>В этом чате нет отложенных сообщений</h3><p>Чтобы запланировать отправку, нажмите «Отложить сообщение» под полем ввода.</p></div>}
    {items.map((item) => <article className="scheduled-chat__item" key={item.id}>
      <time dateTime={new Date(item.send_at * 1000).toISOString()}>{when(item.send_at)}</time><span className={item.status === 'failed' ? 'form-error' : 'feature-hint'}>{item.status === 'failed' ? 'Не отправлено' : 'Ожидает отправки'}</span>
      <p>{item.payload.content}</p>{!!item.payload.attachment_ids?.length && <small>Вложений: {item.payload.attachment_ids.length}</small>}
      {item.error && <p className="form-error">{item.error}</p>}
      <div className="feature-actions"><button type="button" className="button button--small button--secondary" disabled={busy} onClick={() => { setEdit(item); setText(item.payload.content); setSendAt(dateInput(item.send_at > Date.now() / 1000 ? item.send_at : Date.now() / 1000 + 3600)); setPollClosesAt(item.payload.poll ? dateInput(item.payload.poll.closes_at) : ''); setError('') }}>Изменить</button><button type="button" className="button button--small button--ghost" disabled={busy} onClick={() => void action(() => api.community.request(token, `/me/scheduled-messages/${item.id}`, 'DELETE'))}>Отменить отправку</button></div>
    </article>)}
    {edit && <form className="feature-form scheduled-chat__editor" onSubmit={(event) => { event.preventDefault(); save() }}>
      <h3>Изменить отложенное сообщение</h3><label>{edit.payload.poll ? 'Вопрос опроса' : 'Сообщение'}<textarea autoFocus required={!!edit.payload.poll || !edit.payload.attachment_ids?.length} maxLength={edit.payload.poll ? 300 : 5120} value={text} onChange={(event) => setText(event.target.value)}/></label>
      <label>Время отправки<input required type="datetime-local" step="1" value={sendAt} onChange={(event) => setSendAt(event.target.value)}/></label>
      {edit.payload.poll && <label>Опрос завершится<input required type="datetime-local" step="1" value={pollClosesAt} onChange={(event) => setPollClosesAt(event.target.value)}/></label>}
      <div className="feature-actions"><button className="button button--primary" disabled={busy}>Сохранить</button><button className="button button--ghost" type="button" disabled={busy} onClick={() => setEdit(null)}>Назад к списку</button></div>
    </form>}
    {error && <p className="form-error" role="alert">{error}</p>}
  </section>
}
