import { useMemo, useState } from 'react'
import { Avatar } from './Avatar'
import { Icon } from './Icon'

interface Person { user_id: number; username: string }

export function ConversationCreator({ members, initialIds = [], busy, onCreate }: {
  members: Person[]
  initialIds?: number[]
  busy: boolean
  onCreate: (ids: number[], name: string) => Promise<boolean>
}) {
  const [ids, setIds] = useState(() => initialIds.filter((id) => members.some((member) => member.user_id === id)))
  const [name, setName] = useState(''), [search, setSearch] = useState('')
  const visible = useMemo(() => members.filter((member) => member.username.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())), [members, search])
  const group = ids.length > 1
  return <div className="personal-scroll"><form className="personal-page conversation-creator" onSubmit={(event) => { event.preventDefault(); if (!busy && ids.length) void onCreate(ids, group ? name.trim() : '') }}>
    <h2>{group ? 'Создать беседу' : 'С кем поговорим?'}</h2>
    <p>Выберите одного человека для личного диалога или нескольких для беседы. Всего можно добавить до 15 участников.</p>
    <label className="personal-search"><Icon name="search" size={16}/><input autoFocus type="search" aria-label="Найти участника" placeholder="Имя участника" value={search} onChange={(event) => setSearch(event.target.value)}/></label>
    <fieldset className="conversation-creator__people" disabled={busy}><legend>Участники · выбрано {ids.length}</legend>{visible.map((member) => {
      const checked = ids.includes(member.user_id)
      return <label key={member.user_id} className={checked ? 'is-selected' : ''}>
        <input type="checkbox" aria-label={member.username} checked={checked} disabled={!checked && ids.length >= 15} onChange={(event) => setIds((current) => event.target.checked ? [...current, member.user_id] : current.filter((id) => id !== member.user_id))}/>
        <Avatar name={member.username} userId={member.user_id}/><span>{member.username}</span>
      </label>
    })}{!visible.length && <p>{members.length ? 'Никого не нашли по этому имени.' : 'Участники появятся после вступления в сообщество или открытия личного диалога.'}</p>}</fieldset>
    {group && <label className="conversation-creator__name">Название беседы <span>необязательно</span><input maxLength={100} value={name} onChange={(event) => setName(event.target.value)} placeholder="Например, команда проекта"/></label>}
    <button className="button button--primary" disabled={busy || !ids.length} type="submit">{busy ? 'Создаём…' : group ? 'Создать беседу' : 'Начать диалог'}</button>
  </form></div>
}
