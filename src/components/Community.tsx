import { PersonalEmpty } from './PersonalEmpty'
import { CommunityFeatureHost } from './CommunityFeatureHost'
import { EventsView, AuditView, DesktopNotificationSettings } from './LazyCommunityFeatures'
import { Suspense, lazy, createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { VoxholdApi } from '../services/api'
import { communityPages } from '../services/communityPages'
import type { Message, MessageNotification, ServerMember, ServerRole } from '../domain/types'
import type { Conversation, InboxItem, Privacy, CustomRole } from '../domain/community'
import { Avatar } from './Avatar'
import { Icon, type IconName } from './Icon'
import { ContextMenu, type ContextMenuState } from './ContextMenu'
import { createPortal } from 'react-dom'
import '../styles/community.css'
import '../styles/personal-space.css'

const ConversationCreator = lazy(() => import('./ConversationCreator').then((module) => ({ default: module.ConversationCreator })))
const DirectChat = lazy(() => import('./DirectChat').then((module) => ({ default: module.DirectChat })))

type View = 'inbox' | 'messages' | 'privacy' | 'favorites' | 'events' | 'audit' | null
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
  creating: boolean; initialMemberIds: number[]; startChat: (memberIds?: number[]) => void; items: InboxItem[]; moreInbox: boolean; loadInbox: () => Promise<void>
  busy: boolean; error: string; loading: boolean; privacy: Privacy; privacyError: string
  action: (fn: () => Promise<unknown>, reload?: boolean) => Promise<boolean>
  createChat: (ids: number[], name: string) => Promise<boolean>; leaveChat: () => void
  savePrivacy: (mode: Privacy['mode']) => void; unblock: (id: number) => void
}
const CommunityContext = createContext<ContextValue | null>(null)
export const useCommunity = () => useContext(CommunityContext)
export function communityChanged() { window.dispatchEvent(new Event('voxhold:community')); window.dispatchEvent(new Event('voxhold:roles')) }
export function openCommunityChannels() { window.dispatchEvent(new Event('voxhold:open-channels')) }
const problem = (error: unknown) => error instanceof Error ? error.message : 'Не удалось выполнить запрос'
export const conversationName = (chat: Conversation, userId: number) => chat.name || chat.members.filter((m) => m.user_id !== userId).map((m) => m.username).join(', ') || 'Беседа'
const badge = (count: number) => count > 99 ? '99+' : count

export function CommunityProvider({ api, token, userId, serverId, owner, members, onMessage, onNavigate, onOpenProfile, onViewChange, children }: ProviderProps) {
  const [view, updateView] = useState<View>(null), [items, setItems] = useState<InboxItem[]>([]), [moreInbox, setMoreInbox] = useState(false)
  const [roles, setRoles] = useState<CustomRole[]>([]), [roleRevision,setRoleRevision]=useState(0)
  useEffect(()=>{const changed=()=>setRoleRevision((v)=>v+1);window.addEventListener('voxhold:roles',changed);return()=>window.removeEventListener('voxhold:roles',changed)},[])
  const [conversations, setConversations] = useState<Conversation[]>([]), [selected, setSelected] = useState<number | null>(null), [creating, setCreating] = useState(false)
  const [initialMemberIds, setInitialMemberIds] = useState<number[]>([])
  const [revision, setRevision] = useState(0), [error, setError] = useState(''), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true)
  const [listRevision, setListRevision] = useState(0)
  const lastLoaded = useRef(0), liveInbox = useRef(new Map<number, { sequence: number; item: InboxItem }>()), notificationSequence = useRef(0)
  const [loadError, setLoadError] = useState('')
  const [privacy, setPrivacy] = useState<Privacy>({ mode: 'shared', blocked_user_ids: [] })
  const [privacyError, setPrivacyError] = useState('')
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null), openGeneration = useRef(0)
  const refresh = useCallback(() => { if (refreshTimer.current === null) refreshTimer.current = setTimeout(() => { refreshTimer.current = null; setRevision((v) => v + 1); setListRevision((v) => v + 1) }, 500) }, [])
  useEffect(() => () => { if (refreshTimer.current !== null) clearTimeout(refreshTimer.current) }, [])
  const setView = (next: View) => { ++openGeneration.current; setBusy(false); updateView(next); setError(''); setCreating(false); onViewChange?.(next !== null) }
  const closeView = useRef(() => setView(null)); closeView.current = () => setView(null)
  useEffect(() => { const open = () => closeView.current(); window.addEventListener('voxhold:open-channels', open); return () => window.removeEventListener('voxhold:open-channels', open) }, [])
  const selectChat = (chat: Conversation) => { setSelected(chat.id); setView(chat.saved ? 'favorites' : 'messages') }
  useEffect(() => {
    const changed = (event: Event) => {
      const detail = (event as CustomEvent<{ type: string; data?: { conversation_id?: number; author?: { user_id: number } } }>).detail
      if (!detail) { refresh(); return }
      if (detail.type.startsWith('conversation.call') || detail.type === 'conversation.notification') return
      if (detail.type === 'conversation.changed') { refresh(); return }
      if (detail.type === 'conversation.message' && detail.data?.conversation_id) {
        const cid = detail.data.conversation_id, mine = detail.data.author?.user_id === userId
        setConversations((values) => {
          const chat = values.find((v) => v.id === cid)
          if (!chat) { refresh(); return values }
          return [{ ...chat, unread_count: chat.unread_count + (mine ? 0 : 1) }, ...values.filter((v) => v.id !== cid)]
        })
      }
      if (detail.type === 'conversation.read') setConversations((values) => values.map((v) => v.id === detail.data?.conversation_id ? { ...v, unread_count: 0 } : v))
      setRevision((v) => v + 1)
    }
    const stale = () => { if (document.visibilityState === 'visible' && Date.now() - lastLoaded.current > 60_000) refresh() }
    const notification = (event: Event) => {
      const value = (event as CustomEvent<MessageNotification>).detail
      if (!value?.message || value.message.author.user_id === userId) return
      const item: InboxItem = { message_id: value.message.id, server_id: value.server_id, channel_id: value.channel_id, server_name: value.server_name, channel_name: value.channel_name, content: value.message.content, author: value.message.author.username, created_at: value.message.created_at, reason: 'mention' }
      liveInbox.current.set(item.message_id, { sequence: ++notificationSequence.current, item })
      if (liveInbox.current.size > 100) liveInbox.current.delete(liveInbox.current.keys().next().value!)
      setItems((values) => [item, ...values.filter((v) => v.message_id !== item.message_id)].sort((a, b) => b.message_id - a.message_id))
    }
    window.addEventListener('voxhold:community', changed); window.addEventListener('voxhold:ready', refresh); window.addEventListener('voxhold:notification', notification)
    window.addEventListener('focus', stale); document.addEventListener('visibilitychange', stale)
    return () => { window.removeEventListener('voxhold:community', changed); window.removeEventListener('voxhold:ready', refresh); window.removeEventListener('voxhold:notification', notification); window.removeEventListener('focus', stale); document.removeEventListener('visibilitychange', stale) }
  }, [refresh, userId])
  useEffect(() => {
    if (!token) return
    const controller = new AbortController()
    const startedSequence = notificationSequence.current
    void Promise.allSettled([
      api.community.request<{ items: InboxItem[]; has_more: boolean }>(token, '/me/inbox', 'GET', undefined, controller.signal),
      communityPages<Conversation>(api, token, '/me/conversations', 'conversations', controller.signal),
    ]).then(([inbox, chats]) => { if (controller.signal.aborted) return
      if (inbox.status === 'fulfilled') {
        const values = new Map((Array.isArray(inbox.value.items) ? inbox.value.items : []).map((item) => [item.message_id, item]))
        liveInbox.current.forEach(({ sequence, item }) => { if (sequence > startedSequence) values.set(item.message_id, item) })
        setItems([...values.values()].sort((a, b) => b.message_id - a.message_id)); setMoreInbox(!!inbox.value.has_more)
      }
      if (chats.status === 'fulfilled') setConversations(Array.isArray(chats.value) ? chats.value : [])
      const failure = [inbox, chats].find((v) => v.status === 'rejected')
      if (!failure) lastLoaded.current = Date.now()
      setLoadError(failure?.status === 'rejected' ? problem(failure.reason) : ''); setLoading(false)
    })
    return () => controller.abort()
  }, [api, token, listRevision])
  useEffect(() => {
    if (!token) return
    const controller = new AbortController()
    void api.community.request<Privacy>(token, '/me/message-privacy', 'GET', undefined, controller.signal).then((value) => { if (!controller.signal.aborted && value.mode) { setPrivacy(value); setPrivacyError('') } }).catch((error) => { if (!controller.signal.aborted) setPrivacyError(problem(error)) })
    if (serverId) void api.community.request<CustomRole[]>(token, `/servers/${serverId}/roles`, 'GET', undefined, controller.signal).then((value) => { if (!controller.signal.aborted) setRoles(Array.isArray(value) ? value : []) }).catch(() => undefined)
    return () => controller.abort()
  }, [api, token, serverId, roleRevision])
  const openDirect = async (id: number) => {
    setView('messages'); const generation = ++openGeneration.current
    setBusy(true)
    try {
      const chat = await api.community.request<Conversation>(token, '/me/conversations', 'POST', { user_ids: [id] })
      if (generation !== openGeneration.current) return
      setConversations((values) => [chat, ...values.filter((value) => value.id !== chat.id)]); setSelected(chat.id); refresh()
    } catch (caught) { if (generation === openGeneration.current) setError(problem(caught)) }
    finally { if (generation === openGeneration.current) setBusy(false) }
  }
  const openDirectRef = useRef(openDirect); openDirectRef.current = openDirect
  useEffect(() => { const open = (event: Event) => { const id = (event as CustomEvent<number>).detail; if (Number.isSafeInteger(id) && id > 0) void openDirectRef.current(id) }; window.addEventListener('voxhold:open-direct', open); return () => window.removeEventListener('voxhold:open-direct', open) }, [])
  const action = async (fn: () => Promise<unknown>, reload = true) => { if (busy) return false; setBusy(true); setError(''); try { await fn(); if (reload) refresh(); return true } catch (caught) { setError(problem(caught)); return false } finally { setBusy(false) } }
  const privacyAction = (fn: () => Promise<void>) => {
    setPrivacyError('')
    void action(async () => { try { await fn() } catch (error) { setPrivacyError(problem(error)); throw error } })
  }
  const createChat = (ids: number[], name: string) => {
    const generation = ++openGeneration.current
    return action(async () => {
    const chat = await api.community.request<Conversation>(token, '/me/conversations', 'POST', { user_ids: ids, name })
    if (generation !== openGeneration.current) return
    // Include the new conversation immediately, before the background list refresh.
    const value = { ...chat, name: chat.name ?? name, direct: chat.direct ?? ids.length === 1, members: chat.members ?? [{ user_id: userId, username: '' }, ...members.filter((m) => ids.includes(m.user_id))], unread_count: 0 }
    setConversations((values) => [value, ...values.filter((v) => v.id !== chat.id)]); setSelected(chat.id); setCreating(false); updateView('messages')
    })
  }
  useEffect(() => {
    if (view !== 'favorites' || !token) return
    const controller = new AbortController()
    void api.community.request<Conversation>(token, '/me/favorites', 'GET', undefined, controller.signal).then((chat) => { if (!controller.signal.aborted) { setConversations((v) => [chat, ...v.filter((c) => c.id !== chat.id)]); setSelected(chat.id) } }).catch((e) => { if (!controller.signal.aborted) setError(problem(e)) })
    return () => controller.abort()
  }, [api, token, view])
  const openConversation = useRef((id:number)=>{void id})
  openConversation.current=(id)=>{
    const chat=conversations.find((v)=>v.id===id);if(chat){selectChat(chat);return}
    const current=++openGeneration.current;setBusy(true)
    void api.community.request<Conversation>(token,`/conversations/${id}`).then((chat)=>{if(current!==openGeneration.current)return;setBusy(false);setConversations((values)=>[chat,...values.filter((v)=>v.id!==chat.id)]);selectChat(chat)}).catch((e)=>{if(current===openGeneration.current){setBusy(false);setError(problem(e))}})
  }
  useEffect(()=>{const open=(e:Event)=>openConversation.current((e as CustomEvent<number>).detail);window.addEventListener('voxhold:open-conversation',open);return()=>window.removeEventListener('voxhold:open-conversation',open)},[])

  return <CommunityContext.Provider value={{ api, token, userId, serverId, owner, members, roles, onMessage, onNavigate, onOpenProfile, view, setView, openDirect: (id) => void openDirect(id), inboxCount: items.length, directCount: conversations.reduce((n, v) => n + v.unread_count, 0), refresh, revision, conversations, selected, selectChat, creating, initialMemberIds, startChat: (memberIds = []) => { setView('messages'); setSelected(null); setInitialMemberIds(memberIds); setCreating(true) }, items, moreInbox, loading, busy, error: error || loadError, privacy, action, createChat, leaveChat: () => { setConversations((v) => v.filter((c) => c.id !== selected)); setSelected(null); refresh() },
    loadInbox: async () => { await action(async () => { const page = await api.community.request<{ items: InboxItem[]; has_more: boolean }>(token, `/me/inbox?before=${items.at(-1)?.message_id}`); setItems((v) => [...v, ...page.items]); setMoreInbox(page.has_more) }, false) },
    privacyError,
    savePrivacy: (mode) => { privacyAction(async () => { const value = await api.community.request<Privacy>(token, '/me/message-privacy', 'PUT', { mode }); setPrivacy(value) }) },
    unblock: (id) => { privacyAction(async () => { await api.community.request(token, `/me/blocks/${id}`, 'DELETE'); setPrivacy((v) => ({ ...v, blocked_user_ids: v.blocked_user_ids.filter((n) => n !== id) })) }) },
  }}>{children}<CommunityFeatureHost api={api} token={token} userId={userId} conversations={conversations} activeConversation={!creating && conversations.some((c)=>c.id===selected && (view==='favorites'?c.saved:view==='messages'?!c.saved:false))?selected:null}/></CommunityContext.Provider>
}

export function CommunityNavigation({ account, onOpenSettings }: { account?: ReactNode; onOpenSettings?: () => void } = {}) {
  const context = useCommunity()
  const [menu, setMenu] = useState<ContextMenuState | null>(null)
  if (!context) return null
  const nav = (view: View, icon: IconName, label: string, count = 0, desktopOnly = false) => <button type="button" data-section={view} className={`personal-rail__item ${desktopOnly ? 'personal-rail__desktop' : ''} ${context.view === view ? 'is-active' : ''}`} title={label} aria-label={label} aria-pressed={context.view === view} onClick={() => context.setView(view)}><Icon name={icon} size={22}/>{count > 0 && <b className="personal-badge" aria-label={`${count} непрочитанных`}>{badge(count)}</b>}<span className="personal-rail__tooltip">{label}</span><span className="personal-rail__label" aria-hidden="true">{view === 'privacy' ? 'Настройки' : label}</span></button>

  return <nav id="personal-rail" className="personal-rail" aria-label="Личное пространство">
      <button type="button" className={`personal-rail__home ${context.view === null ? 'is-active' : ''}`} title="К каналам" aria-label="К каналам" aria-pressed={context.view === null} onClick={() => context.setView(null)}>V<span className="personal-rail__label" aria-hidden="true">Каналы</span></button>
      <div className="personal-rail__divider"/>
      {nav('inbox', 'inbox', 'Входящие', context.inboxCount)}
      {nav('messages', 'message', 'Сообщения', context.directCount)}
      {nav('favorites', 'bookmark', 'Избранное')}
      {context.serverId && nav('events', 'calendar', 'События сервера', 0, true)}
      {context.serverId && (context.owner || context.members.some((m) => m.user_id === context.userId && m.role === 'admin')) && nav('audit', 'audit', 'Журнал администрации', 0, true)}
      <div className="personal-rail__divider"/>
      <div className="personal-rail__recents">{context.conversations.filter((c) => !c.saved).slice(0, 12).map((chat) => { const person = chat.members.find((m) => m.user_id !== context.userId), name = conversationName(chat, context.userId), active = context.view === 'messages' && context.selected === chat.id; return <button key={chat.id} type="button" className={`personal-rail__item ${active ? 'is-active' : ''}`} title={name} aria-label={`${chat.direct ? 'Диалог' : 'Беседа'}: ${name}`} aria-pressed={active} onClick={() => context.selectChat(chat)}>{chat.direct ? <Avatar name={name} userId={person?.user_id}/> : <Icon name="people" size={22}/>}{chat.unread_count > 0 && <b className="personal-badge">{badge(chat.unread_count)}</b>}</button> })}</div>
      <button type="button" className="personal-rail__item personal-rail__desktop" aria-label="Новый разговор" title="Новый разговор" onClick={() => context.startChat()}><Icon name="add" size={22}/><span className="personal-rail__tooltip">Новый разговор</span></button>
      <button type="button" className={`personal-rail__item personal-rail__more ${['events', 'audit', 'privacy'].includes(context.view ?? '') ? 'is-active' : ''}`} aria-label="Ещё разделы" aria-haspopup="menu" aria-expanded={!!menu} onClick={(event) => {
        const bounds = event.currentTarget.getBoundingClientRect()
        const sections: Array<readonly [Exclude<View, null>, IconName, string]> = [
          ...(context.serverId ? [['events', 'calendar', 'События сервера'] as const] : []),
          ...(context.serverId && (context.owner || context.members.some((m) => m.user_id === context.userId && m.role === 'admin')) ? [['audit', 'audit', 'Журнал администрации'] as const] : []),
          ['privacy', 'settings', onOpenSettings ? 'Настройки' : 'Личные настройки'],
        ]
        setMenu({ x: bounds.left, y: bounds.top, items: sections.map(([view, icon, label]) => ({ key: view, kind: 'action', icon, label, onSelect: () => { if (view === 'privacy' && onOpenSettings) onOpenSettings(); else context.setView(view) } })) })
      }}><Icon name="more" size={22}/><span className="personal-rail__label" aria-hidden="true">Ещё</span></button>
      <div className="personal-rail__bottom">{onOpenSettings ? <button type="button" className="personal-rail__item personal-rail__desktop" onClick={onOpenSettings} aria-label="Настройки" title="Настройки"><Icon name="settings" size={22}/><span className="personal-rail__tooltip">Настройки</span><span className="personal-rail__label" aria-hidden="true">Настройки</span></button> : nav('privacy', 'settings', 'Личные настройки', 0, true)}{account}</div>
      {menu && createPortal(<ContextMenu menu={menu} onClose={() => setMenu(null)}/>, document.body)}
    </nav>
}

export function CommunitySidebar({ children }: { children: ReactNode }) {
  const c = useCommunity(), [search, setSearch] = useState('')
  if (!c?.view) return <>{children}</>
  if (c.view !== 'messages') return null
  const chats = c.conversations.filter((chat) => !chat.saved && conversationName(chat, c.userId).toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
  return <div className="personal-sidebar">
    <header className="personal-sidebar__header"><div><span className="eyebrow">ЛИЧНОЕ ОБЩЕНИЕ</span><h2>Сообщения</h2></div><button className="icon-button" title="К каналам" aria-label="Вернуться к каналам" onClick={() => c.setView(null)}><Icon name="hash"/></button></header>
    <div className="personal-sidebar__section"><span>РАЗГОВОРЫ</span><button className="icon-button" aria-label="Новый разговор" title="Новый разговор" onClick={() => c.startChat()}><Icon name="add" size={17}/></button></div>
    <label className="personal-search"><Icon name="search" size={15}/><input type="search" aria-label="Найти разговор" placeholder="Имя или название беседы" value={search} onChange={(event) => setSearch(event.target.value)}/></label>
    <div className="personal-conversations">{chats.map((chat) => {
      const name = conversationName(chat, c.userId), person = chat.members.find((member) => member.user_id !== c.userId)
      const active = c.view === 'messages' && c.selected === chat.id && !c.creating
      return <button key={chat.id} className={`personal-conversation ${active ? 'is-active' : ''}`} aria-pressed={active} onClick={() => c.selectChat(chat)}>
        {chat.direct ? <Avatar userId={person?.user_id} name={name}/> : <span className="personal-group-avatar"><Icon name="people" size={21}/></span>}
        <span><b>{name}</b><small>{chat.direct ? 'Личный диалог' : `${chat.members.length} участников`}</small></span>{chat.unread_count > 0 && <b className="personal-count">{badge(chat.unread_count)}</b>}
      </button>
    })}{!chats.length && <p className="personal-conversations__empty">{search.trim() ? 'Разговоры не найдены' : 'Начните разговор через + или профиль участника.'}</p>}</div>
    <button className="personal-sidebar__return" onClick={() => c.setView(null)}><Icon name="hash" size={16}/>Вернуться в сообщество<Icon name="chevron" size={14}/></button>
  </div>
}

export function CommunityContent({ children, onMenu }: { children: ReactNode; onMenu?: () => void }) {
  const c = useCommunity(), heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => { if (c?.view) heading.current?.focus({ preventScroll: true }) }, [c?.view, c?.selected])
  if (!c) return <>{children}</>
  const chat = c.conversations.find((value) => value.id === c.selected)
  const chatting = c.view === 'messages' || c.view === 'favorites'
  const title = c.view === 'favorites' ? 'Избранное' : c.view === 'events' ? 'События сервера' : c.view === 'audit' ? 'Журнал администрации' : c.view === 'inbox' ? 'Входящие' : c.view === 'privacy' ? 'Личные настройки' : c.creating ? 'Новый разговор' : chat && !chat.saved ? conversationName(chat, c.userId) : 'Сообщения'
  const subtitle = c.view === 'favorites' ? 'Сохранённые сообщения, файлы и ссылки' : c.view === 'events' ? 'Встречи и планы сообщества' : c.view === 'audit' ? 'Кто и что изменил в сообществе' : c.view === 'inbox' ? 'Упоминания, ответы и ваши обсуждения' : c.view === 'privacy' ? 'Общение и конфиденциальность' : chat && !c.creating ? chat.direct ? 'Личный диалог' : `${chat.members.length} участников` : 'Личные диалоги и беседы в одном списке'
  const people = c.creating ? [...new Map([...c.conversations.flatMap((value) => value.members), ...c.members].filter((member) => member.user_id !== c.userId).map((member) => [member.user_id, member])).values()] : []
  return <>
    <div className="community-channel-content" hidden={c.view !== null} inert={c.view !== null}>{children}</div>
    {c.view && <section className="personal-content" data-view={c.view} aria-label="Личное пространство">
      <header className="personal-content__header">{c.view === 'messages' && <button className="icon-button mobile-menu" aria-label="Список разговоров" onClick={onMenu}><Icon name="menu"/></button>}<span className="personal-content__icon"><Icon name={c.view === 'favorites' ? 'bookmark' : c.view === 'events' ? 'calendar' : c.view === 'audit' ? 'audit' : c.view === 'inbox' ? 'inbox' : c.view === 'privacy' ? 'settings' : 'message'} size={22}/></span><div><h1 ref={heading} tabIndex={-1}>{title}</h1><p>{subtitle}</p></div><button className="icon-button personal-content__close" aria-label="Вернуться к каналам" title="Вернуться к каналам" onClick={() => c.setView(null)}><Icon name="close"/></button></header>
      {c.error && <div role="alert" className="personal-error">{c.error}<button className="button button--small button--secondary" disabled={c.busy} onClick={c.refresh}>Повторить</button></div>}
      {c.view === 'inbox' && <div className="personal-scroll"><div className="personal-page"><div className="personal-page__heading"><h2>Требует внимания</h2><span>{c.inboxCount ? `${c.inboxCount}${c.moreInbox ? '+' : ''} уведомлений` : 'Вы в курсе всего'}</span></div><div className="inbox-list">{c.items.map((item) => <button className="inbox-item" key={item.message_id} onClick={() => { c.onNavigate(item); c.setView(null); void c.action(() => c.api.community.request(c.token, `/me/inbox/${item.message_id}`, 'PUT')) }}><span className="inbox-item__icon"><Icon name={item.reason === 'thread' ? 'chat' : 'reply'} size={19}/></span><span className="inbox-item__body"><small>{item.channel_name} · {item.reason === 'thread' ? 'Обсуждение' : item.reason === 'reply' ? 'Ответ вам' : 'Упоминание'}</small><b>{item.author}</b><span>{item.content || 'Вложение'}</span></span><Icon name="chevron" size={16}/></button>)}</div>{!c.items.length && !c.error && <PersonalEmpty icon="check" title={c.loading ? 'Загружаем входящие…' : 'Всё прочитано'}>Новые упоминания, ответы и обсуждения появятся здесь.</PersonalEmpty>}{c.moreInbox && <button className="button button--secondary" disabled={c.busy} onClick={() => void c.loadInbox()}>Ещё уведомления</button>}</div></div>}
      {c.view === 'privacy' && <PrivacySettings/>}
      {c.view === 'events' && <EventsView api={c.api} token={c.token} serverId={c.serverId} userId={c.userId} admin={c.owner || c.members.some((member) => member.user_id === c.userId && member.role === 'admin')} revision={c.revision}/>}
      {c.view === 'audit' && <AuditView key={c.serverId} api={c.api} token={c.token} serverId={c.serverId} members={c.members}/>}
      {chatting && (c.creating ? <Suspense fallback={<p role="status">Загружаем участников…</p>}><ConversationCreator key={c.initialMemberIds.join(':')} members={people} initialIds={c.initialMemberIds} busy={c.busy} onCreate={c.createChat}/></Suspense> : c.selected && (c.view === 'favorites' || !chat || !chat.saved) ? <Suspense fallback={<p role="status">Загружаем беседу…</p>}><DirectChat key={`${c.userId}:${c.selected}`} api={c.api} token={c.token} id={c.selected} saved={c.view === 'favorites'} currentUserId={c.userId} revision={c.revision} onRefresh={c.refresh} onLeave={c.leaveChat} onCreateGroup={chat?.direct && !chat.saved ? () => c.startChat(chat.members.filter((member) => member.user_id !== c.userId).map((member) => member.user_id)) : undefined}/></Suspense> : <PersonalEmpty icon="message" title="Ваши разговоры">Выберите диалог или беседу слева.</PersonalEmpty>)}
    </section>}
  </>
}

export function PrivacySettings({ embedded = false }: { embedded?: boolean } = {}) {
  const c = useCommunity()!
  const choices = [['shared', 'Участники сообщества', 'Вам могут писать участники вашего сообщества.'], ['everyone', 'Все пользователи сервера', 'В том числе те, кто ещё не вступил в сообщество.'], ['none', 'Никто', 'Входящие сообщения отключены, включая существующие беседы.']] as const
  return <div className="personal-scroll"><div className="personal-page">{embedded && c.privacyError && <p className="form-error" role="alert">{c.privacyError}</p>}<div className="personal-page__heading"><h2>Кто может писать мне</h2><p>Выберите, от кого вы хотите получать личные сообщения.</p></div><fieldset className="personal-privacy"><legend className="sr-only">Кто может писать мне</legend>{choices.map(([mode, title, description]) => <label key={mode} className={c.privacy.mode === mode ? 'is-selected' : ''}><input type="radio" name="message-privacy" value={mode} checked={c.privacy.mode === mode} disabled={c.busy} onChange={() => c.savePrivacy(mode)}/><span><b>{title}</b><small>{description}</small></span><span className="personal-radio"><Icon name="check" size={14}/></span></label>)}</fieldset><DesktopNotificationSettings/><section className="personal-blocked"><h2>Заблокированные пользователи</h2><p>Эти пользователи не смогут писать вам независимо от выбранной настройки.</p>{!c.privacy.blocked_user_ids.length && <div className="personal-blocked__empty"><Icon name="lock" size={18}/>Вы никого не заблокировали</div>}{c.privacy.blocked_user_ids.map((id) => { const name = c.members.find((m) => m.user_id === id)?.username ?? `Пользователь #${id}`; return <div className="personal-blocked__row" key={id}><Avatar userId={id} name={name}/><b>{name}</b><button className="button button--secondary button--small" disabled={c.busy} onClick={() => c.unblock(id)}>Разблокировать</button></div> })}</section></div></div>
}
export function CustomRoleBadges({ userId }: { userId: number }) {
 const community = useCommunity()
 return <>{community?.roles.filter((r) => r.user_ids.includes(userId)).map((role) => <span key={role.id} className="custom-role-badge" style={{ borderColor: role.color }}><i style={{ background: role.color }}/>{role.name}</span>)}</>
}
