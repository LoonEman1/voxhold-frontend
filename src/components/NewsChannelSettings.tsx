import { useEffect, useState } from 'react'
import type { Channel, NewsSettings, ServerMember } from '../domain/types'
import type { VoxholdApi } from '../services/api'
import { humanError } from '../lib/format'
import { Avatar } from './Avatar'
import { Icon } from './Icon'

const fingerprint = (value: NewsSettings) => JSON.stringify({ ...value, publisher_ids: [...value.publisher_ids].sort((a, b) => a - b) })

export function NewsChannelSettings({ api, token, channel, members, onSaved }: {
  api: VoxholdApi; token: string; channel: Channel; members: ServerMember[]; onSaved: () => void
}) {
  const [saved, setSaved] = useState<NewsSettings | null>(null), [value, setValue] = useState<NewsSettings | null>(null)
  const [search, setSearch] = useState(''), [error, setError] = useState(''), [success, setSuccess] = useState(false)
  const [pending, setPending] = useState(false), [revision, setRevision] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setValue(null); setSaved(null); setError(''); setSuccess(false)
    void api.channels.news(token, channel.server_id, channel.id, controller.signal).then((next) => {
      if (!controller.signal.aborted) { setSaved(next); setValue(next) }
    }).catch((caught: unknown) => { if (!controller.signal.aborted) setError(humanError(caught)) })
    return () => controller.abort()
  }, [api, token, channel.id, channel.server_id, revision])
  const change = (next: NewsSettings) => { setValue(next); setSuccess(false) }
  const save = async () => {
    if (!value || pending) return
    setPending(true); setError(''); setSuccess(false)
    try {
      const next = await api.channels.setNews(token, channel.server_id, channel.id, value)
      setSaved(next); setValue(next); setSuccess(true); onSaved()
    } catch (caught) { setError(humanError(caught)) } finally { setPending(false) }
  }
  return <section className="channel-access settings-section" aria-labelledby="news-settings-title">
    <div className="channel-access__heading"><span className="channel-access__symbol"><Icon name="news" size={22}/></span><div><h3 id="news-settings-title">Публикации и комментарии</h3><p>Авторы публикуют новости. Читатели ставят реакции и участвуют в обсуждениях.</p></div></div>
    {!value ? error ? <div className="form-error" role="alert">{error}<button type="button" className="button button--ghost" onClick={() => setRevision((n) => n + 1)}>Повторить</button></div> : <p role="status">Загружаем настройки…</p> : <>
      <label className="channel-access__role"><input type="checkbox" checked={value.comments_enabled} disabled={pending} onChange={(event) => change({ ...value, comments_enabled: event.target.checked })}/><span><b>Разрешить комментарии</b><small>Отдельное обсуждение под каждой публикацией. При отключении история сохраняется.</small></span></label>
      <div className="channel-access__section-title"><b>Авторы канала <small>{value.publisher_ids.length}</small></b><span>Владелец и администраторы могут публиковать всегда.</span></div>
      <p className="news-settings-hint">Для закрытого канала авторам также нужен доступ в разделе ниже.</p>
      <label className="channel-access__search"><Icon name="search" size={16}/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Найти автора" aria-label="Найти автора канала"/></label>
      <div className="channel-access__people" aria-label="Авторы новостного канала">{members.filter((member) => member.role === 'member' && member.username.toLocaleLowerCase().includes(search.toLocaleLowerCase())).map((member) => <label key={member.user_id}><input type="checkbox" checked={value.publisher_ids.includes(member.user_id)} disabled={pending} onChange={(event) => change({ ...value, publisher_ids: event.target.checked ? [...value.publisher_ids, member.user_id] : value.publisher_ids.filter((id) => id !== member.user_id) })}/><Avatar userId={member.user_id} name={member.username} size="small"/><span><b>{member.username}</b><small>{value.publisher_ids.includes(member.user_id) ? 'Может публиковать' : 'Читатель'}</small></span></label>)}</div>
      <footer className="channel-access__footer"><span><Icon name="news" size={16}/>Настройки новостного канала</span><button type="button" className="button button--primary" disabled={pending || !saved || fingerprint(saved) === fingerprint(value)} onClick={() => void save()}>{pending ? <span className="spinner"/> : 'Сохранить публикации'}</button></footer>
      {success && <p role="status" className="channel-access__success">Настройки публикаций сохранены.</p>}
      {error && <div className="form-error" role="alert">{error}</div>}
    </>}
  </section>
}
