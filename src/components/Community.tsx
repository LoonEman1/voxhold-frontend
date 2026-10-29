import { MessageAttachments, useAttachmentUpload } from './MessageAttachments'
import { Fragment, createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { VoxholdApi } from '../services/api'
import type { Message, ServerMember, ServerRole } from '../domain/types'
import type { Conversation, DirectMessage, InboxItem, Privacy, CustomRole } from '../domain/community'
import { Avatar } from './Avatar'
import { MessageAvatar, MessageHeader } from './MessageIdentity'
import { formatDate, formatTime } from '../lib/format'
import { Icon, type IconName } from './Icon'
import '../styles/community.css'
import '../styles/personal-space.css'

type View = 'inbox' | 'messages' | 'groups' | 'privacy' | null
interface ProviderProps {
  api: VoxholdApi; token: string; userId: number; serverId: number | null; owner: boolean; members: ServerMember[]
  onMessage: (message: Message) => void; onNavigate: (item: InboxItem) => void; children: ReactNode
  onOpenProfile?: (userId: number, username: string, role: ServerRole) => void
  onViewChange?: (active: boolean) => void
}
interface ContextValue extends Omit<ProviderProps, 'children' | 'onViewChange'> {
  roles: CustomRole[]; openDirect: (userId: number) => void; setView: (view: View) => void; view: View
  inboxCount: number; directCount: number; refresh: () => void; revision: number
  conversations: Conversation[]; selected: number | null; selectChat: (chat: Conversation) => void
  creating: boolean; startChat: () => void; items: InboxItem[]; moreInbox: boolean; loadInbox: () => Promise<void>
  busy: boolean; error: string; loading: boolean; privacy: Privacy
  action: (fn: () => Promise<unknown>, reload?: boolean) => Promise<boolean>
  createChat: (ids: number[], name: string) => Promise<boolean>; leaveChat: () => void
  savePrivacy: (mode: Privacy['mode']) => void; unblock: (id: number) => void
}
const CommunityContext = createContext<ContextValue | null>(null)
export const useCommunity = () => useContext(CommunityContext)
export function communityChanged() { window.dispatchEvent(new Event('voxhold:community')) }
export function openCommunityChannels() { window.dispatchEvent(new Event('voxhold:open-channels')) }
const problem = (error: unknown) => error instanceof Error ? error.message : 'Не удалось выполнить запрос'
export const conversationName = (chat: Conversation, userId: number) => chat.name || chat.members.filter((m) => m.user_id !== userId).map((m) => m.username).join(', ') || 'Беседа'
const badge = (count: number) => count > 99 ? '99+' : count

export function CommunityProvider({ api, token, userId, serverId, owner, members, onMessage, onNavigate, onOpenProfile, onViewChange, children }: ProviderProps) {
  const [view, updateView] = useState<View>(null), [items, setItems] = useState<InboxItem[]>([]), [moreInbox, setMoreInbox] = useState(false)
  const [roles, setRoles] = useState<CustomRole[]>([])
  const [conversations, setConversations] = useState<Conversation[]>([]), [selected, setSelected] = useState<number | null>(null), [creating, setCreating] = useState(false)
  const [revision, setRevision] = useState(0), [error, setError] = useState(''), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [privacy, setPrivacy] = useState<Privacy>({ mode: 'shared', blocked_user_ids: [] })
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null), openGeneration = useRef(0)
  const refresh = useCallback(() => { if (refreshTimer.current === null) refreshTimer.current = setTimeout(() => { refreshTimer.current = null; setRevision((v) => v + 1) }, 500) }, [])
  useEffect(() => () => { if (refreshTimer.current !== null) clearTimeout(refreshTimer.current) }, [])
  const setView = (next: View) => { ++openGeneration.current; setBusy(false); updateView(next); setError(''); setCreating(false); onViewChange?.(next !== null) }
  const closeView = useRef(() => setView(null)); closeView.current = () => setView(null)
  useEffect(() => { const open = () => closeView.current(); window.addEventListener('voxhold:open-channels', open); return () => window.removeEventListener('voxhold:open-channels', open) }, [])
  const selectChat = (chat: Conversation) => { setSelected(chat.id); setView(chat.direct ? 'messages' : 'groups') }
  useEffect(() => { const changed = () => refresh(); const timer = window.setInterval(() => { if (document.visibilityState === 'visible') refresh() }, 15_000); window.addEventListener('voxhold:community', changed); window.addEventListener('focus', changed); return () => { clearInterval(timer); window.removeEventListener('voxhold:community', changed); window.removeEventListener('focus', changed) } }, [refresh])
  useEffect(() => {
    if (!token) return
    const controller = new AbortController()
    void Promise.allSettled([
      api.community.request<{ items: InboxItem[]; has_more: boolean }>(token, '/me/inbox', 'GET', undefined, controller.signal),
      api.community.request<Conversation[]>(token, '/me/conversations', 'GET', undefined, controller.signal),
    ]).then(([inbox, chats]) => { if (controller.signal.aborted) return
      if (inbox.status === 'fulfilled') { setItems(Array.isArray(inbox.value.items) ? inbox.value.items : []); setMoreInbox(!!inbox.value.has_more) }
      if (chats.status === 'fulfilled') setConversations(Array.isArray(chats.value) ? chats.value : [])
      const failure = [inbox, chats].find((v) => v.status === 'rejected')
      setLoadError(failure?.status === 'rejected' ? problem(failure.reason) : ''); setLoading(false)
    })
    return () => controller.abort()
  }, [api, token, revision])
  useEffect(() => {
    if (!token) return
    const controller = new AbortController()
    void api.community.request<Privacy>(token, '/me/message-privacy', 'GET', undefined, controller.signal).then((value) => { if (!controller.signal.aborted && value.mode) setPrivacy(value) }).catch(() => undefined)
    if (serverId) void api.community.request<CustomRole[]>(token, `/servers/${serverId}/roles`, 'GET', undefined, controller.signal).then((value) => { if (!controller.signal.aborted) setRoles(Array.isArray(value) ? value : []) }).catch(() => undefined)
    return () => controller.abort()
  }, [api, token, serverId, view, revision])
  const openDirect = async (id: number) => {
    setView('messages'); const generation = ++openGeneration.current
    setBusy(true)
    try {
      const chat = await api.community.request<Conversation>(token, '/me/conversations', 'POST', { user_ids: [id] })
      if (generation !== openGeneration.current) return
      setSelected(chat.id); refresh()
    } catch (caught) { if (generation === openGeneration.current) setError(problem(caught)) }
    finally { if (generation === openGeneration.current) setBusy(false) }
  }
  const openDirectRef = useRef(openDirect); openDirectRef.current = openDirect
  useEffect(() => { const open = (event: Event) => { const id = (event as CustomEvent<number>).detail; if (Number.isSafeInteger(id) && id > 0) void openDirectRef.current(id) }; window.addEventListener('voxhold:open-direct', open); return () => window.removeEventListener('voxhold:open-direct', open) }, [])
  const action = async (fn: () => Promise<unknown>, reload = true) => { if (busy) return false; setBusy(true); setError(''); try { await fn(); if (reload) refresh(); return true } catch (caught) { setError(problem(caught)); return false } finally { setBusy(false) } }
  const createChat = (ids: number[], name: string) => {
    const generation = ++openGeneration.current
    return action(async () => {
    const chat = await api.community.request<Conversation>(token, '/me/conversations', 'POST', { user_ids: ids, name })
    if (generation !== openGeneration.current) return
    // Include the new conversation immediately, before the background list refresh.
    const value = { ...chat, name: chat.name ?? name, direct: chat.direct ?? ids.length === 1, members: chat.members ?? [{ user_id: userId, username: '' }, ...members.filter((m) => ids.includes(m.user_id))], unread_count: 0 }
    setConversations((values) => [value, ...values.filter((v) => v.id !== chat.id)]); setSelected(chat.id); setCreating(false); updateView(value.direct ? 'messages' : 'groups')
    })
  }
  return <CommunityContext.Provider value={{ api, token, userId, serverId, owner, members, roles, onMessage, onNavigate, onOpenProfile, view, setView, openDirect: (id) => void openDirect(id), inboxCount: items.length, directCount: conversations.reduce((n, v) => n + v.unread_count, 0), refresh, revision, conversations, selected, selectChat, creating, startChat: () => { setSelected(null); setCreating(true) }, items, moreInbox, loading, busy, error: error || loadError, privacy, action, createChat, leaveChat: () => { setConversations((v) => v.filter((c) => c.id !== selected)); setSelected(null); refresh() },
    loadInbox: async () => { await action(async () => { const page = await api.community.request<{ items: InboxItem[]; has_more: boolean }>(token, `/me/inbox?before=${items.at(-1)?.message_id}`); setItems((v) => [...v, ...page.items]); setMoreInbox(page.has_more) }, false) },
    savePrivacy: (mode) => { void action(async () => { const value = await api.community.request<Privacy>(token, '/me/message-privacy', 'PUT', { mode }); setPrivacy(value) }) },
    unblock: (id) => { void action(async () => { await api.community.request(token, `/me/blocks/${id}`, 'DELETE'); setPrivacy((v) => ({ ...v, blocked_user_ids: v.blocked_user_ids.filter((n) => n !== id) })) }) },
  }}>{children}</CommunityContext.Provider>
}

export function CommunityNavigation() {
  const context = useCommunity(), [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null), handle = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); handle.current?.focus() } }
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape) }
  }, [open])
  useEffect(() => {
    // A broad activation strip without an invisible overlay over channel clicks.
    const nearEdge = (event: PointerEvent) => { if (event.pointerType !== 'touch' && event.clientX >= 0 && event.clientX <= 56) setOpen(true) }
    window.addEventListener('pointermove', nearEdge, { passive: true })
    return () => window.removeEventListener('pointermove', nearEdge)
  }, [])
  if (!context) return null
  const navigate = (view: View) => { context.setView(view); setOpen(false) }
  const total = context.inboxCount + context.directCount
  const nav = (view: View, icon: IconName, label: string, count = 0) => <button type="button" className={`personal-rail__item ${context.view === view ? 'is-active' : ''}`} title={label} aria-label={label} aria-pressed={context.view === view} onClick={() => navigate(view)}><Icon name={icon} size={22}/>{count > 0 && <b className="personal-badge">{badge(count)}</b>}<span className="personal-rail__tooltip">{label}</span></button>

  return <div ref={root} className={`personal-rail-edge ${open ? 'is-open' : ''}`} onPointerEnter={(event) => { if (event.pointerType !== 'touch') setOpen(true) }} onPointerLeave={() => { if (!root.current?.contains(document.activeElement)) setOpen(false) }} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false) }}>
    <button ref={handle} type="button" className="personal-rail-handle" aria-label="Личная панель" title="Личная панель" aria-expanded={open} aria-controls="personal-rail" onClick={() => setOpen(true)}><Icon name="chevron" size={15}/>{total > 0 && <i/>}</button>
    <nav id="personal-rail" className="personal-rail" aria-label="Личное пространство" aria-hidden={!open} inert={!open}>
      <button className={`personal-rail__home ${context.view === null ? 'is-active' : ''}`} title="К каналам" aria-label="К каналам" onClick={() => navigate(null)}>V</button>
      <div className="personal-rail__divider"/>
      {nav('inbox', 'inbox', 'Входящие', context.inboxCount)}
      {nav('messages', 'message', 'Личные сообщения', context.conversations.filter((c) => c.direct).reduce((n, c) => n + c.unread_count, 0))}
      {nav('groups', 'people', 'Беседы', context.conversations.filter((c) => !c.direct).reduce((n, c) => n + c.unread_count, 0))}
      <div className="personal-rail__divider"/>
      <div className="personal-rail__recents">{context.conversations.filter((c) => c.direct).slice(0, 12).map((chat) => { const person = chat.members.find((m) => m.user_id !== context.userId), name = conversationName(chat, context.userId); return <button key={chat.id} className={`personal-rail__item ${context.view === 'messages' && context.selected === chat.id ? 'is-active' : ''}`} title={name} aria-label={`Диалог: ${name}`} onClick={() => { context.selectChat(chat); setOpen(false) }}><Avatar name={name} userId={person?.user_id}/>{chat.unread_count > 0 && <b className="personal-badge">{badge(chat.unread_count)}</b>}<span className="personal-rail__tooltip">{name}</span></button> })}</div>
      <div className="personal-rail__bottom">{nav('privacy', 'settings', 'Личные настройки')}</div>
    </nav>
  </div>
}

export function CommunitySidebar({ children }: { children: ReactNode }) {
  const c = useCommunity(), [search, setSearch] = useState('')
  if (!c?.view) return <>{children}</>
  const groups = c.view === 'groups', chats = c.conversations.filter((chat) => chat.direct !== groups && conversationName(chat, c.userId).toLocaleLowerCase().includes(search.toLocaleLowerCase()))
  return <div className="personal-sidebar">
    <header className="personal-sidebar__header"><div><span className="eyebrow">ВАШЕ ПРОСТРАНСТВО</span><h2>Личное</h2></div><button className="icon-button" title="К каналам" aria-label="Вернуться к каналам" onClick={() => c.setView(null)}><Icon name="hash"/></button></header>
    <nav className="personal-sidebar__nav" aria-label="Разделы личного пространства">{([['inbox', 'inbox', 'Входящие'], ['messages', 'message', 'Диалоги'], ['groups', 'people', 'Беседы'], ['privacy', 'settings', 'Личные настройки']] as const).map(([view, icon, label]) => <button key={view} className={c.view === view ? 'is-active' : ''} aria-current={c.view === view ? 'page' : undefined} onClick={() => c.setView(view)}><Icon name={icon} size={18}/><span>{label}</span>{view === 'inbox' && c.inboxCount > 0 && <b className="personal-count">{badge(c.inboxCount)}</b>}</button>)}</nav>
    {(c.view === 'messages' || groups) && <>
      <div className="personal-sidebar__section"><span>{groups ? 'БЕСЕДЫ' : 'ЛИЧНЫЕ ДИАЛОГИ'}</span><button className="icon-button" aria-label={groups ? 'Новая беседа' : 'Новый диалог'} title={groups ? 'Новая беседа' : 'Новый диалог'} onClick={c.startChat}><Icon name="add" size={17}/></button></div>
      <label className="personal-search"><Icon name="search" size={15}/><input type="search" aria-label="Найти диалог" placeholder="Найти разговор" value={search} onChange={(e) => setSearch(e.target.value)}/></label>
      <div className="personal-conversations">{chats.map((chat) => { const name = conversationName(chat, c.userId), person = chat.members.find((m) => m.user_id !== c.userId); return <button key={chat.id} className={`personal-conversation ${c.selected === chat.id && !c.creating ? 'is-active' : ''}`} aria-pressed={c.selected === chat.id && !c.creating} onClick={() => c.selectChat(chat)}>{chat.direct ? <Avatar userId={person?.user_id} name={name}/> : <span className="personal-group-avatar"><Icon name="people" size={21}/></span>}<span><b>{name}</b><small>{chat.direct ? 'Личный диалог' : `${chat.members.length} участников`}</small></span>{chat.unread_count > 0 && <b className="personal-count">{badge(chat.unread_count)}</b>}</button> })}{!chats.length && <p className="personal-sidebar__empty">{c.loading ? 'Загружаем разговоры…' : search ? 'Ничего не найдено' : groups ? 'Здесь появятся ваши беседы' : 'Здесь появятся ваши диалоги'}</p>}</div>
    </>}
    <button className="personal-sidebar__return" onClick={() => c.setView(null)}><Icon name="hash" size={16}/>Вернуться в сообщество<Icon name="chevron" size={14}/></button>
  </div>
}

export function CommunityContent({ children, onMenu }: { children: ReactNode; onMenu?: () => void }) {
  const c = useCommunity(), heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => { if (c?.view) heading.current?.focus({ preventScroll: true }) }, [c?.view, c?.selected])
  if (!c) return <>{children}</>
  const chat = c.conversations.find((v) => v.id === c.selected), groups = c.view === 'groups', chatting = c.view === 'messages' || groups
  const title = c.view === 'inbox' ? 'Входящие' : c.view === 'privacy' ? 'Личные настройки' : c.creating ? groups ? 'Новая беседа' : 'Новый диалог' : chat && chat.direct !== groups ? conversationName(chat, c.userId) : groups ? 'Беседы' : 'Личные сообщения'
  return <>
    <div className="community-channel-content" hidden={c.view !== null} inert={c.view !== null}>{children}</div>
    {c.view && <section className="personal-content" aria-label="Личное пространство">
      <header className="personal-content__header"><button className="icon-button mobile-menu" aria-label="Список разговоров" onClick={onMenu}><Icon name="menu"/></button><span className="personal-content__icon"><Icon name={c.view === 'inbox' ? 'inbox' : c.view === 'privacy' ? 'settings' : groups ? 'people' : 'message'} size={22}/></span><div><h1 ref={heading} tabIndex={-1}>{title}</h1><p>{c.view === 'inbox' ? 'Упоминания, ответы и ваши обсуждения' : c.view === 'privacy' ? 'Общение и конфиденциальность' : chat && chat.direct !== groups && !c.creating ? chat.direct ? 'Личный диалог' : `${chat.members.length} участников` : 'Оставайтесь на связи со своими'}</p></div><button className="icon-button personal-content__close" aria-label="Вернуться к каналам" title="Вернуться к каналам" onClick={() => c.setView(null)}><Icon name="close"/></button></header>
      {c.error && <div role="alert" className="personal-error">{c.error}<button className="button button--small button--secondary" disabled={c.busy} onClick={c.refresh}>Повторить</button></div>}
      {c.view === 'inbox' && <div className="personal-scroll"><div className="personal-page"><div className="personal-page__heading"><h2>Требует внимания</h2><span>{c.inboxCount ? `${c.inboxCount}${c.moreInbox ? '+' : ''} уведомлений` : 'Вы в курсе всего'}</span></div><div className="inbox-list">{c.items.map((item) => <button className="inbox-item" key={item.message_id} onClick={() => { c.onNavigate(item); c.setView(null); void c.action(() => c.api.community.request(c.token, `/me/inbox/${item.message_id}`, 'PUT')) }}><span className="inbox-item__icon"><Icon name={item.reason === 'thread' ? 'chat' : 'reply'} size={19}/></span><span className="inbox-item__body"><small>{item.channel_name} · {item.reason === 'thread' ? 'Обсуждение' : item.reason === 'reply' ? 'Ответ вам' : 'Упоминание'}</small><b>{item.author}</b><span>{item.content || 'Вложение'}</span></span><Icon name="chevron" size={16}/></button>)}</div>{!c.items.length && !c.error && <PersonalEmpty icon="check" title={c.loading ? 'Загружаем входящие…' : 'Всё прочитано'}>Новые упоминания, ответы и обсуждения появятся здесь.</PersonalEmpty>}{c.moreInbox && <button className="button button--secondary" disabled={c.busy} onClick={() => void c.loadInbox()}>Ещё уведомления</button>}</div></div>}
      {c.view === 'privacy' && <PrivacySettings/>}
      {chatting && (c.creating ? <div className="personal-scroll"><ConversationCreator key={c.view} members={c.members.filter((m) => m.user_id !== c.userId)} busy={c.busy} group={groups} onCreate={c.createChat}/></div> : c.selected && (!chat || chat.direct !== groups) ? <DirectChat key={`${c.token}:${c.selected}`} api={c.api} token={c.token} id={c.selected} currentUserId={c.userId} revision={c.revision} onRefresh={c.refresh} onLeave={c.leaveChat}/> : <PersonalEmpty icon={groups ? 'people' : 'message'} title={groups ? 'Разговор для своей компании' : 'Ваши личные разговоры'}>Выберите {groups ? 'беседу' : 'диалог'} слева или начните новый.<button className="button button--primary" onClick={c.startChat}><Icon name="add" size={18}/>{groups ? 'Создать беседу' : 'Начать диалог'}</button></PersonalEmpty>)}
    </section>}
  </>
}

function PersonalEmpty({ icon, title, children }: { icon: IconName; title: string; children: ReactNode }) {
  return <div className="personal-empty"><span><Icon name={icon} size={32}/></span><h2>{title}</h2><div>{children}</div></div>
}
function PrivacySettings() {
  const c = useCommunity()!
  const choices = [['shared', 'Участники сообщества', 'Вам могут писать участники вашего сообщества.'], ['everyone', 'Все пользователи сервера', 'В том числе те, кто ещё не вступил в сообщество.'], ['none', 'Никто', 'Входящие сообщения отключены, включая существующие беседы.']] as const
  return <div className="personal-scroll"><div className="personal-page"><div className="personal-page__heading"><h2>Кто может писать мне</h2><p>Выберите, от кого вы хотите получать личные сообщения.</p></div><fieldset className="personal-privacy"><legend className="sr-only">Кто может писать мне</legend>{choices.map(([mode, title, description]) => <label key={mode} className={c.privacy.mode === mode ? 'is-selected' : ''}><input type="radio" name="message-privacy" value={mode} checked={c.privacy.mode === mode} disabled={c.busy} onChange={() => c.savePrivacy(mode)}/><span><b>{title}</b><small>{description}</small></span><span className="personal-radio"><Icon name="check" size={14}/></span></label>)}</fieldset><section className="personal-blocked"><h2>Заблокированные пользователи</h2><p>Эти пользователи не смогут писать вам независимо от выбранной настройки.</p>{!c.privacy.blocked_user_ids.length && <div className="personal-blocked__empty"><Icon name="lock" size={18}/>Вы никого не заблокировали</div>}{c.privacy.blocked_user_ids.map((id) => { const name = c.members.find((m) => m.user_id === id)?.username ?? `Пользователь #${id}`; return <div className="personal-blocked__row" key={id}><Avatar userId={id} name={name}/><b>{name}</b><button className="button button--secondary button--small" disabled={c.busy} onClick={() => c.unblock(id)}>Разблокировать</button></div> })}</section></div></div>
}
function ConversationCreator({ members, busy, group, onCreate }: { members: ServerMember[]; busy: boolean; group: boolean; onCreate: (ids: number[], name: string) => Promise<boolean> }) {
  const [ids, setIds] = useState<number[]>([]), [name, setName] = useState(''), [search, setSearch] = useState('')
  return <form className="personal-create personal-page" onSubmit={(e) => { e.preventDefault(); void onCreate(ids, name.trim()) }}><div className="personal-page__heading"><h2>{group ? 'Соберите своих' : 'С кем начнём разговор?'}</h2><p>{group ? 'Выберите от 2 до 15 участников для общей беседы.' : 'Выберите участника сообщества. Прошлые сообщения сохранятся, если вы уже общались.'}</p></div>{group && <label className="personal-field">Название беседы<input value={name} maxLength={64} placeholder="Например, Планы на выходные" onChange={(e) => setName(e.target.value)}/></label>}<label className="personal-search"><Icon name="search" size={17}/><input type="search" aria-label="Найти участника" placeholder="Поиск по имени" value={search} onChange={(e) => setSearch(e.target.value)}/></label><fieldset className="personal-member-picker"><legend className="sr-only">Участники</legend>{members.filter((m) => m.username.toLocaleLowerCase().includes(search.toLocaleLowerCase())).map((m) => <label key={m.user_id} className={ids.includes(m.user_id) ? 'is-selected' : ''}><Avatar userId={m.user_id} name={m.username}/><span>{m.username}</span><input type={group ? 'checkbox' : 'radio'} name="conversation-members" aria-label={m.username} checked={ids.includes(m.user_id)} disabled={busy || (group && !ids.includes(m.user_id) && ids.length >= 15)} onChange={(e) => setIds((v) => group ? e.target.checked ? [...v, m.user_id] : v.filter((id) => id !== m.user_id) : [m.user_id])}/></label>)}</fieldset>{!members.length && <p className="community-empty">В сообществе пока нет других участников.</p>}<div className="personal-create__actions"><span>{ids.length ? `Выбрано: ${ids.length}` : 'Выберите участника'}</span><button className="button button--primary" disabled={busy || ids.length < (group ? 2 : 1)}><Icon name={group ? 'people' : 'message'} size={18}/>{busy ? 'Открываем…' : group ? 'Создать беседу' : 'Открыть диалог'}</button></div></form>
}

function DirectChat({ api, token, id, currentUserId, revision, onRefresh, onLeave }: { api: VoxholdApi; token: string; id: number; currentUserId: number; revision: number; onRefresh: () => void; onLeave: () => void }) {
  const community = useCommunity()
  const [loadError, setLoadError] = useState('')
  const initialized = useRef(false), olderBusy = useRef(false), draftInput = useRef<HTMLTextAreaElement>(null)
  const [messages, setMessages] = useState<DirectMessage[]>([]), [draft, setDraft] = useState(''), [error, setError] = useState(''), [pending, setPending] = useState(false), [more, setMore] = useState(false), [loading, setLoading] = useState(true)
  const retry = useRef<{ content: string; key: string } | null>(null), generation = useRef(0), visible = useRef<HTMLDivElement>(null)
  const upload = useAttachmentUpload({ id, server_id: 0, name: 'Беседа', kind: 'text', position: 0, created_by: 0, created_at: 0 }, true, undefined, id)
  const readCursor = useRef(0), followingBottom = useRef(true), preserveDistance = useRef<number | null>(null), readLatest = useRef<() => void>(() => undefined)
  useLayoutEffect(() => { const list = visible.current; if (!list) return; if (preserveDistance.current !== null) { list.scrollTop = list.scrollHeight - preserveDistance.current; preserveDistance.current = null } else if (followingBottom.current) list.scrollTop = list.scrollHeight }, [messages])
  useEffect(() => {
    const controller = new AbortController(); const current = ++generation.current
    void api.community.request<{ messages: DirectMessage[]; has_more: boolean }>(token, `/conversations/${id}/messages`, 'GET', undefined, controller.signal).then((page) => { if (controller.signal.aborted || current !== generation.current) return; setMessages((values) => [...new Map([...values, ...page.messages].map((m) => [m.id, m])).values()].sort((a, b) => a.id - b.id)); if (!initialized.current) { setMore(page.has_more); initialized.current = true }; setLoading(false); setLoadError('') }).catch((caught) => { if (!controller.signal.aborted) { setLoading(false); setLoadError(problem(caught)) } })
    return () => controller.abort()
  }, [api, token, id, revision])
  useEffect(() => {
    const latest = messages.at(-1)?.id
    if (!latest || latest <= readCursor.current) return
    const mark = () => { if (document.visibilityState === 'visible' && document.hasFocus() && followingBottom.current && latest > readCursor.current) { readCursor.current = latest; void api.community.request(token, `/conversations/${id}/read`, 'PUT', { message_id: latest }).catch(() => { readCursor.current = 0 }) } }
    readLatest.current = mark; mark(); window.addEventListener('focus', mark); document.addEventListener('visibilitychange', mark); return () => { window.removeEventListener('focus', mark); document.removeEventListener('visibilitychange', mark) }
  }, [api, token, id, messages])
  const send = async () => {
    const content = draft.trim(); if ((!content && !upload.hasItems) || pending) return
    setPending(true); setError('')
    try {
      const attachmentIds = await upload.prepare()
      const fingerprint = JSON.stringify([content, attachmentIds])
      const key = retry.current?.content === fingerprint ? retry.current.key : crypto.randomUUID()
      retry.current = { content: fingerprint, key }
      const sent = await api.community.request<DirectMessage>(token, `/conversations/${id}/messages`, 'POST', { content, client_message_id: key, ...(attachmentIds.length ? { attachment_ids: attachmentIds } : {}) })
      setMessages((values) => [...values.filter((m) => m.id !== sent.id), sent].sort((a, b) => a.id - b.id))
      setDraft((v) => v.trim() === content ? '' : v); retry.current = null; upload.commit(attachmentIds); onRefresh()
      requestAnimationFrame(() => visible.current?.scrollTo({ top: visible.current.scrollHeight }))
    } catch (caught) { setError(problem(caught)) } finally { upload.release(); setPending(false) }
  }
  useLayoutEffect(() => { const input = draftInput.current; if (input) { input.style.height = 'auto'; input.style.height = `${Math.min(140, Math.max(37, input.scrollHeight))}px` } }, [draft])
  const loadOlder = async () => {
    if (olderBusy.current || !messages.length) return
    olderBusy.current = true
    const list = visible.current
    if (list) preserveDistance.current = list.scrollHeight - list.scrollTop
    try {
      const page = await api.community.request<{ messages: DirectMessage[]; has_more: boolean }>(token, `/conversations/${id}/messages?before=${messages[0]!.id}`)
      setMessages((v) => [...new Map([...page.messages, ...v].map((m) => [m.id, m])).values()].sort((a, b) => a.id - b.id)); setMore(page.has_more)
    } catch (caught) { preserveDistance.current = null; setError(problem(caught)) }
    finally { olderBusy.current = false }
  }
  return <section className="direct-chat" onPaste={upload.onPaste} onDrop={upload.onDrop} onDragOver={upload.onDragOver}>
    <div className="direct-chat__messages messages" ref={visible} onScroll={() => { const list = visible.current; followingBottom.current = !!list && list.scrollHeight - list.scrollTop - list.clientHeight < 60; readLatest.current() }} aria-live="polite">
      {!messages.length && !error && !loadError && <PersonalEmpty icon="message" title={loading ? 'Загружаем сообщения…' : 'Начните разговор'}>Сообщения видны только участникам этого разговора.</PersonalEmpty>}
      {more && <button className="button button--ghost" onClick={() => void loadOlder()}>Раньше</button>}
      {messages.map((m, index) => {
        const previous = messages[index - 1], sameDay = !!previous && new Date(previous.created_at * 1000).toDateString() === new Date(m.created_at * 1000).toDateString()
        const grouped = sameDay && previous.author.user_id === m.author.user_id && m.created_at - previous.created_at < 300
        const mine = m.author.user_id === currentUserId
        const openProfile = community?.onOpenProfile ? () => community.onOpenProfile?.(m.author.user_id, m.author.username, community.members.find((member) => member.user_id === m.author.user_id)?.role ?? 'member') : undefined
        return <Fragment key={m.id}>
          {!sameDay && <div className="date-divider"><span>{formatDate(m.created_at)}</span></div>}
          <article data-message-id={m.id} className={`message ${mine ? 'message--mine' : ''} ${grouped ? 'message--grouped' : ''}`}>
            {!grouped && <MessageAvatar userId={m.author.user_id} name={m.author.username} onOpen={openProfile}/>}
            <div className="message__body">
              {!grouped && <MessageHeader name={m.author.username} createdAt={m.created_at} mine={mine} onOpen={openProfile}/>}
              <p>{m.content}</p><MessageAttachments attachments={m.attachments}/>
            </div>
            {grouped && <time className="message__hover-time" dateTime={new Date(m.created_at * 1000).toISOString()}>{formatTime(m.created_at)}</time>}
            {!mine && <div className="message__actions"><button aria-label={`Заблокировать ${m.author.username}`} title={`Заблокировать ${m.author.username}`} onClick={() => void api.community.request(token, `/me/blocks/${m.author.user_id}`, 'PUT').then(onRefresh).catch((caught) => setError(problem(caught)))}><Icon name="lock" size={14}/></button></div>}
          </article>
        </Fragment>
      })}
    </div>
    {upload.control}
    <form className="composer direct-chat__composer" onSubmit={(e) => { e.preventDefault(); void send() }}>
      <label className="sr-only" htmlFor={`direct-draft-${id}`}>Сообщение в беседу</label>
      <textarea ref={draftInput} id={`direct-draft-${id}`} rows={1} value={draft} maxLength={5120} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send() } }} placeholder="Напишите сообщение…"/>
      <button className="composer__send" aria-label={pending ? 'Отправляем…' : retry.current ? 'Повторить отправку' : 'Отправить'} title="Отправить" disabled={pending || (!draft.trim() && !upload.hasItems)}><Icon name="send" size={18}/></button>
    </form>
    {(error || loadError) && <p className="form-error" role="alert">{error || loadError}</p>}
    <button className="button button--ghost" onClick={() => void api.community.request(token, `/conversations/${id}/members/me`, 'DELETE').then(onLeave).catch((caught) => setError(problem(caught)))}>Покинуть беседу</button>
  </section>
}

export function CustomRoleBadges({ userId }: { userId: number }) {
 const community = useCommunity()
 return <>{community?.roles.filter((r) => r.user_ids.includes(userId)).map((role) => <span key={role.id} className="custom-role-badge" style={{ borderColor: role.color }}><i style={{ background: role.color }}/>{role.name}</span>)}</>
}
