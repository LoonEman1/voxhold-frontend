import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Profile, ServerRole } from '../domain/types'
import type { CustomRole } from '../domain/community'
import { roleMeta } from '../lib/roles'
import { countryByCode } from '../lib/countries'
import { Avatar } from './Avatar'
import { CountryFlag } from './CountrySelect'
import { Icon } from './Icon'
import { MemberPresence, usePresenceClock } from './MemberPresence'
import { communityChanged, useCommunity } from './Community'

const permissions = [[1, 'Читать каналы'], [2, 'Публиковать сообщения'], [4, 'Участвовать в голосе'], [8, 'Запускать трансляции'], [16, 'Управлять сообщениями']] as const
const problem = (caught: unknown) => caught instanceof Error ? caught.message : 'Не удалось сохранить роль'

export function MemberCard({ profile, role, online, loading, error, anchor, onClose, onOpenProfile, onMessage }: {
  profile: Profile | null; role: ServerRole; online: boolean; loading: boolean; error: string
  anchor: { x: number; y: number }; onClose: () => void; onOpenProfile: () => void; onMessage: () => void
}) {
  const community = useCommunity(), root = useRef<HTMLElement>(null), closeButton = useRef<HTMLButtonElement>(null)
  const api = community?.api, token = community?.token, serverId = community?.serverId
  const [picker, setPicker] = useState(false), [creating, setCreating] = useState(false), [search, setSearch] = useState('')
  const [roles, setRoles] = useState<CustomRole[]>(community?.roles ?? []), [pending, setPending] = useState(false), [roleError, setRoleError] = useState('')
  const [name, setName] = useState(''), [color, setColor] = useState('#a993ff'), [rights, setRights] = useState(15)
  const [position, setPosition] = useState({ left: 16, top: 16 })
  const now = usePresenceClock(true), country = countryByCode(profile?.country_code)
  const canManage = !!community?.owner && !!community.serverId && role !== 'owner'
  const handlers = useRef({ onClose, picker, creating }); handlers.current = { onClose, picker, creating }
  const roleGeneration = useRef(0)
  useEffect(() => { if (!picker) setRoles(community?.roles ?? []) }, [community?.roles, picker])
  useLayoutEffect(() => {
    const place = () => {
      const width = Math.min(336, window.innerWidth - 24), height = root.current?.offsetHeight ?? 420
      const left = anchor.x > window.innerWidth / 2 ? anchor.x - width - 16 : anchor.x + 16
      setPosition({ left: Math.max(12, Math.min(left, window.innerWidth - width - 12)), top: Math.max(12, Math.min(anchor.y - 64, window.innerHeight - height - 12)) })
    }
    place(); window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [anchor, picker, creating, profile, loading, roles.length, roleError])
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    closeButton.current?.focus({ preventScroll: true })
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) handlers.current.onClose() }
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      if (handlers.current.creating) setCreating(false)
      else if (handlers.current.picker) setPicker(false)
      else handlers.current.onClose()
    }
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', key)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', key); previous?.focus({ preventScroll: true }) }
  }, [])
  useEffect(() => {
    if (!picker || !api || !token || !serverId || !canManage) return
    const controller = new AbortController()
    const generation = ++roleGeneration.current
    void api.community.request<CustomRole[]>(token, `/servers/${serverId}/roles`, 'GET', undefined, controller.signal).then((values) => { if (!controller.signal.aborted && generation === roleGeneration.current) setRoles(values) }).catch((caught) => { if (!controller.signal.aborted && generation === roleGeneration.current) setRoleError(problem(caught)) })
    return () => controller.abort()
  }, [picker, api, token, serverId, canManage])
  const assigned = roles.filter((r) => profile && r.user_ids.includes(profile.user_id))
  const assign = async (roleId: number, enabled: boolean) => {
    if (!community || !profile || !canManage) return
    // Merge with the server's current assignments, rather than the cached card.
    const available = await community.api.community.request<CustomRole[]>(community.token, `/servers/${community.serverId}/roles`)
    const ids = available.filter((r) => r.user_ids.includes(profile.user_id)).map((r) => r.id).filter((id) => id !== roleId)
    if (enabled) ids.push(roleId)
    await community.api.community.request(community.token, `/servers/${community.serverId}/members/${profile.user_id}/roles`, 'PUT', { role_ids: ids })
    setRoles(available.map((r) => ({ ...r, user_ids: r.user_ids.filter((id) => id !== profile.user_id).concat(ids.includes(r.id) ? [profile.user_id] : []) })))
    communityChanged()
  }
  const toggle = async (roleId: number, enabled: boolean) => {
    if (pending) return
    ++roleGeneration.current
    setPending(true); setRoleError('')
    try { await assign(roleId, enabled) } catch (caught) { setRoleError(problem(caught)) } finally { setPending(false) }
  }
  const create = async () => {
    if (!community || pending || !name.trim()) return
    ++roleGeneration.current
    setPending(true); setRoleError('')
    try {
      const value = await community.api.community.request<CustomRole>(community.token, `/servers/${community.serverId}/roles`, 'POST', { name: name.trim(), color, permissions: rights })
      const available = [...roles, value]
      setRoles(available); setCreating(false); setName(''); communityChanged()
      // Keep a successfully created role in the picker even if assigning it fails.
      await assign(value.id, true)
    } catch (caught) { setRoleError(problem(caught)) } finally { setPending(false) }
  }
  return <section ref={root} className="member-card" role="dialog" aria-modal="false" aria-label="Карточка участника" style={position}>
    <div className="member-card__cover"><span/><button ref={closeButton} className="member-card__close icon-button" aria-label="Закрыть карточку" onClick={onClose}><Icon name="close" size={17}/></button></div>
    {loading ? <div className="member-card__loading" role="status"><span className="spinner"/>Загружаем профиль…</div> : error ? <p role="alert" className="form-error">{error}</p> : profile && <>
      <button className="member-card__avatar" aria-label={`Открыть профиль ${profile.username}`} title="Открыть полный профиль" onClick={onOpenProfile}><Avatar userId={profile.user_id} name={profile.username} size="large" online={online}/><span><Icon name="maximize" size={14}/></span></button>
      <div className="member-card__body"><header><h2>{profile.username}</h2><span className="member-card__username">@{profile.username}{country && <span title={country.name}><CountryFlag code={country.code}/></span>}</span><MemberPresence online={online} lastSeenAt={profile.last_seen_at} now={now}/></header>
        {profile.about && <p className="member-card__about">{profile.about}</p>}
        <section className="member-card__roles" aria-label="Роли участника"><h3>РОЛИ</h3><div className="member-card__role-list"><span className={`role-badge role-badge--${role}`}>{roleMeta[role].label}</span>{assigned.map((r) => <span className="member-card__role" key={r.id}><i style={{ background: r.color }}/>{r.name}{canManage && <button disabled={pending} aria-label={`Снять роль ${r.name}`} onClick={() => void toggle(r.id, false)}><Icon name="close" size={12}/></button>}</span>)}{canManage && <button className={`member-card__add-role ${picker ? 'is-active' : ''}`} aria-label="Добавить роль" aria-expanded={picker} title="Добавить роль" onClick={() => { setPicker((v) => !v); setCreating(false) }}><Icon name="add" size={17}/></button>}</div></section>
        {picker && canManage && <div className="member-role-picker"><label className="personal-search"><Icon name="search" size={15}/><input type="search" aria-label="Найти роль" placeholder="Найти роль" value={search} onChange={(e) => setSearch(e.target.value)}/></label><div className="member-role-picker__list">{roles.filter((r) => r.name.toLocaleLowerCase().includes(search.toLocaleLowerCase())).map((r) => <label key={r.id}><i style={{ background: r.color }}/><span>{r.name}</span><input type="checkbox" aria-label={`Назначить роль ${r.name}`} checked={r.user_ids.includes(profile.user_id)} disabled={pending} onChange={(e) => void toggle(r.id, e.target.checked)}/></label>)}{!roles.length && <p>Создайте первую роль для сообщества.</p>}</div><button className="member-role-picker__create" disabled={pending} onClick={() => setCreating((v) => !v)}><Icon name="add" size={16}/>Создать новую роль</button>
          {creating && <form className="member-role-create" onSubmit={(e) => { e.preventDefault(); void create() }}><label>Название роли<input required maxLength={64} value={name} onChange={(e) => setName(e.target.value)} placeholder="Например, Друзья"/></label><label className="member-role-create__color">Цвет роли<input type="color" value={color} onChange={(e) => setColor(e.target.value)}/></label><fieldset><legend>Разрешения</legend>{permissions.map(([bit, label]) => <label key={bit}><input type="checkbox" checked={(rights & bit) !== 0} onChange={(e) => setRights((v) => e.target.checked ? v | bit : v & ~bit)}/>{label}</label>)}</fieldset><button className="button button--primary button--small" disabled={pending || !name.trim()}>{pending ? 'Сохраняем…' : 'Создать и назначить'}</button></form>}
        </div>}
        {roleError && <p className="form-error" role="alert">{roleError}</p>}
        {profile.user_id !== community?.userId && <button className="button button--primary member-card__message" onClick={onMessage}><Icon name="message" size={17}/>Написать сообщение</button>}
        <button className="member-card__full-profile" onClick={onOpenProfile}>Полный профиль<Icon name="chevron" size={14}/></button>
      </div>
    </>}
  </section>
}
