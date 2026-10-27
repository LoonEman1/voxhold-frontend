import { useEffect, useMemo, useState } from 'react'
import type { Channel, ChannelAccess, ServerMember } from '../domain/types'
import type { VoxholdApi } from '../services/api'
import { humanError } from '../lib/format'
import { Avatar } from './Avatar'
import { Icon } from './Icon'

const fingerprint = (value: ChannelAccess) => JSON.stringify({ restricted: value.restricted, user_ids: [...value.user_ids].sort((a, b) => a - b), roles: [...value.roles].sort() })

export function ChannelAccessSettings({ api, token, channel, members, onSaved }: {
  api: VoxholdApi; token: string; channel: Channel; members: ServerMember[]; onSaved: () => void
}) {
  const [saved, setSaved] = useState<ChannelAccess | null>(null)
  const [value, setValue] = useState<ChannelAccess | null>(null)
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const [revision, setRevision] = useState(0)
  const [success, setSuccess] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    setSaved(null); setValue(null); setError(''); setSuccess(false)
    api.channels.access(token, channel.server_id, channel.id, controller.signal).then((access) => {
      if (!controller.signal.aborted) { setSaved(access); setValue(access) }
    }).catch((caught: unknown) => { if (!controller.signal.aborted) setError(humanError(caught)) })
    return () => controller.abort()
  }, [api, token, channel.server_id, channel.id, revision])
  const selected = useMemo(() => new Set(value?.user_ids), [value?.user_ids])
  const people = useMemo(() => members.filter((member) => member.role === 'member' && member.username.toLocaleLowerCase().includes(search.toLocaleLowerCase())), [members, search])
  const change = (next: ChannelAccess) => { setValue(next); setSuccess(false); setError('') }
  const save = async () => {
    if (!value || pending) return
    setPending(true); setError(''); setSuccess(false)
    try {
      const access = await api.channels.setAccess(token, channel.server_id, channel.id, value)
      setSaved(access); setValue(access); setSuccess(true); onSaved()
    } catch (caught) { setError(humanError(caught)) } finally { setPending(false) }
  }
  const allowed = members.filter((member) => !value?.restricted || member.role !== 'member' || value.roles.includes(member.role) || selected.has(member.user_id)).length
  return <section className="channel-access settings-section" aria-labelledby="channel-access-title">
    <div className="channel-access__heading"><span className="channel-access__symbol"><Icon name="lock" size={20}/></span><div><h3 id="channel-access-title">Доступ к каналу</h3><p>Выберите, кто сможет видеть канал{channel.kind === 'voice' ? ', общаться и смотреть трансляции' : ' и читать его историю'}.</p></div></div>
    {!value ? error ? <div className="form-error" role="alert">{error}<button className="button button--ghost button--small" onClick={() => setRevision((current) => current + 1)}>Повторить</button></div> : <p role="status">Загружаем настройки доступа…</p> : <>
      <fieldset className="channel-access__modes" disabled={pending}><legend className="sr-only">Видимость канала</legend>
        {[false, true].map((restricted) => <label key={String(restricted)} className={value.restricted === restricted ? 'is-selected' : ''}><input type="radio" name={`channel-access-${channel.id}`} checked={value.restricted === restricted} onChange={() => change({ ...value, restricted })}/><Icon name={restricted ? 'lock' : 'people'} size={20}/><span><b>{restricted ? 'Закрытый канал' : 'Для всех участников'}</b><small>{restricted ? 'Только выбранные люди и роли' : 'Доступен каждому на сервере'}</small></span></label>)}
      </fieldset>
      <div className="channel-access__admin"><Icon name="check" size={16}/><span>Владелец и администраторы всегда имеют доступ.</span></div>
      {value.restricted && <>
        <div className="channel-access__section-title"><b>Доступ по роли</b><span>Права роли действуют для всех её участников</span></div>
        <label className="channel-access__role"><input type="checkbox" checked={value.roles.includes('member')} disabled={pending} onChange={(event) => change({ ...value, roles: event.target.checked ? [...value.roles.filter((role) => role !== 'member'), 'member'] : value.roles.filter((role) => role !== 'member') })}/><span><b>Участник</b><small>Все обычные участники, включая новых</small></span><span className="channel-access__pill">Роль</span></label>
        <div className="channel-access__section-title"><b>Отдельные участники <small>{selected.size}</small></b><span>Индивидуальный доступ в дополнение к ролям</span></div>
        <label className="channel-access__search"><Icon name="search" size={16}/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Найти участника" aria-label="Найти участника для доступа"/></label>
        <div className="channel-access__people" aria-label="Участники с индивидуальным доступом">
          {people.map((member) => <label key={member.user_id}><input type="checkbox" checked={selected.has(member.user_id)} disabled={pending} onChange={(event) => change({ ...value, user_ids: event.target.checked ? [...value.user_ids, member.user_id] : value.user_ids.filter((id) => id !== member.user_id) })}/><Avatar userId={member.user_id} name={member.username} size="small"/><span><b title={member.username}>{member.username}</b><small>{selected.has(member.user_id) ? 'Индивидуальный доступ' : value.roles.includes('member') ? 'Доступ по роли' : 'Доступ не предоставлен'}</small></span></label>)}
          {people.length === 0 && <p className="channel-access__empty">{search ? 'Никого не нашли' : 'Других участников пока нет'}</p>}
        </div>
      </>}
      <footer className="channel-access__footer"><span><Icon name={value.restricted ? 'lock' : 'people'} size={15}/>{value.restricted ? `Канал будет доступен ${allowed} из ${members.length}` : 'Канал доступен всем'}</span><button className="button button--primary" disabled={pending || !saved || fingerprint(saved) === fingerprint(value)} onClick={() => void save()}>{pending ? <span className="spinner"/> : <Icon name="check" size={16}/>}Сохранить доступ</button></footer>
      {error && <div className="form-error" role="alert">{error}</div>}
      {success && <p className="channel-access__success" role="status">Доступ обновлён. Изменения уже действуют.</p>}
    </>}
  </section>
}
