import { MessageAttachments, useAttachmentUpload } from './MessageAttachments'
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { VoxholdApi } from '../services/api'
import type { Message, ServerMember } from '../domain/types'
import type { Conversation, DirectMessage, InboxItem, Privacy, CustomRole } from '../domain/community'
import { Modal } from './Modal'
import { RoleManager, StorageManager } from './CommunitySettings'
import '../styles/community.css'

type View = 'inbox' | 'messages' | 'roles' | 'storage' | null
interface ContextValue {
  api: VoxholdApi; token: string; userId: number; serverId: number | null; owner: boolean; members: ServerMember[]
  roles: CustomRole[]; onMessage: (message: Message) => void; openDirect: (userId: number) => void
  setView: (view: View) => void; inboxCount: number; directCount: number; refresh: () => void
}
const CommunityContext = createContext<ContextValue | null>(null)
export const useCommunity = () => useContext(CommunityContext)
export function communityChanged() { window.dispatchEvent(new Event('voxhold:community')) }
const problem = (error: unknown) => error instanceof Error ? error.message : 'Не удалось выполнить запрос'

export function CommunityProvider({ api, token, userId, serverId, owner, members, onMessage, onNavigate, children }: Omit<ContextValue, 'openDirect' | 'setView' | 'inboxCount' | 'directCount' | 'refresh' | 'roles'> & { onNavigate: (item: InboxItem) => void; children: ReactNode }) {
  const [view, setView] = useState<View>(null), [items, setItems] = useState<InboxItem[]>([]), [moreInbox, setMoreInbox] = useState(false)
  const [roles, setRoles] = useState<CustomRole[]>([])
  const [conversations, setConversations] = useState<Conversation[]>([]), [selected, setSelected] = useState<number | null>(null)
  const [revision, setRevision] = useState(0), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const [privacy, setPrivacy] = useState<Privacy>({ mode: 'shared', blocked_user_ids: [] })
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const refresh = useCallback(() => { if (refreshTimer.current === null) refreshTimer.current = setTimeout(() => { refreshTimer.current = null; setRevision((v) => v + 1) }, 500) }, [])
  useEffect(() => () => { if (refreshTimer.current !== null) clearTimeout(refreshTimer.current) }, [])
  const openGeneration = useRef(0)
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
      setError(failure?.status === 'rejected' ? problem(failure.reason) : '')
    })
    return () => controller.abort()
  }, [api, token, revision])
  useEffect(() => {
    if (!token) return
    const controller = new AbortController()
    void api.community.request<Privacy>(token, '/me/message-privacy', 'GET', undefined, controller.signal).then((value) => { if (!controller.signal.aborted && value.mode) setPrivacy(value) }).catch(() => undefined)
    if (serverId) void api.community.request<CustomRole[]>(token, `/servers/${serverId}/roles`, 'GET', undefined, controller.signal).then((value) => { if (!controller.signal.aborted) setRoles(Array.isArray(value) ? value : []) }).catch(() => undefined)
    return () => controller.abort()
  }, [api, token, serverId, view])
  const openDirect = async (id: number) => {
    const generation = ++openGeneration.current
    setBusy(true); setError('')
    try { const chat = await api.community.request<{ id: number }>(token, '/me/conversations', 'POST', { user_ids: [id] }); if (generation !== openGeneration.current) return; setSelected(chat.id); setView('messages'); refresh() } catch (caught) { if (generation === openGeneration.current) { setError(problem(caught)); setView('messages') } } finally { if (generation === openGeneration.current) setBusy(false) }
  }
  const openDirectRef = useRef(openDirect); openDirectRef.current = openDirect
  useEffect(() => { const open = (event: Event) => { const id = (event as CustomEvent<number>).detail; if (Number.isSafeInteger(id) && id > 0) void openDirectRef.current(id) }; window.addEventListener('voxhold:open-direct', open); return () => window.removeEventListener('voxhold:open-direct', open) }, [])
  const action = async (fn: () => Promise<unknown>, reload = true) => { if (busy) return; setBusy(true); setError(''); try { await fn(); if (reload) refresh() } catch (caught) { setError(problem(caught)) } finally { setBusy(false) } }
  const close = () => { ++openGeneration.current; setView(null); setError('') }
  return <CommunityContext.Provider value={{ api, token, userId, serverId, owner, members, roles, onMessage, openDirect: (id) => void openDirect(id), setView, inboxCount: items.length, directCount: conversations.reduce((n, v) => n + v.unread_count, 0), refresh }}>
    {children}
    <Modal open={view === 'inbox'} title="Входящие" eyebrow="ТРЕБУЕТ ВНИМАНИЯ" onClose={close} size="medium"><div className="community-modal-body">
      {error && <p role="alert" className="form-error">{error}<button onClick={refresh}>Повторить</button></p>}
      <div className="inbox-list">{items.map((item) => <button className="inbox-item" key={item.message_id} onClick={() => { onNavigate(item); close(); void action(() => api.community.request(token, `/me/inbox/${item.message_id}`, 'PUT')) }}><small>{item.server_name} / {item.channel_name} · {item.reason === 'thread' ? 'Обсуждение' : item.reason === 'reply' ? 'Ответ вам' : 'Уведомление'}</small><b>{item.author}</b><span>{item.content || 'Вложение'}</span></button>)}{!items.length && !error && <p className="community-empty">Всё прочитано. Новые упоминания, ответы и обсуждения появятся здесь.</p>}{moreInbox && <button className="button button--secondary" onClick={() => void action(async () => { const page = await api.community.request<{ items: InboxItem[]; has_more: boolean }>(token, `/me/inbox?before=${items.at(-1)?.message_id}`); setItems((v) => [...v, ...page.items]); setMoreInbox(page.has_more) }, false)}>Ещё уведомления</button>}</div></div>
    </Modal>
    <Modal open={view === 'messages'} title="Личные сообщения" onClose={close} size="medium"><div className="community-modal-body">
      {view === 'messages' && <><details className="community-privacy"><summary>Кто может писать мне</summary><label>Личные сообщения<select aria-label="Кто может писать мне" value={privacy.mode} disabled={busy} onChange={(e) => void action(async () => { const value = await api.community.request<Privacy>(token, '/me/message-privacy', 'PUT', { mode: e.target.value }); setPrivacy(value) })}><option value="shared">Участники общего сообщества</option><option value="everyone">Все пользователи инстанса</option><option value="none">Никто</option></select></label>{privacy.blocked_user_ids.map((id) => <button key={id} disabled={busy} onClick={() => void action(() => api.community.request(token, `/me/blocks/${id}`, 'DELETE'))}>Разблокировать {members.find((m) => m.user_id === id)?.username ?? `#${id}`}</button>)}</details>
      <ConversationCreator members={members.filter((m) => m.user_id !== userId)} busy={busy} onCreate={(ids, name) => action(async () => { const chat = await api.community.request<{ id: number }>(token, '/me/conversations', 'POST', { user_ids: ids, name }); setSelected(chat.id) })}/>
      <div className="conversation-list">{conversations.map((chat) => <button key={chat.id} className={selected === chat.id ? 'is-active' : ''} onClick={() => setSelected(chat.id)}>{chat.name || chat.members.filter((m) => m.user_id !== userId).map((m) => m.username).join(', ') || 'Пустая беседа'}{chat.unread_count > 0 && <small>{chat.unread_count > 99 ? '99+' : chat.unread_count}</small>}</button>)}</div>
      {selected && <DirectChat key={`${token}:${selected}`} api={api} token={token} id={selected} currentUserId={userId} revision={revision} onRefresh={refresh} onLeave={() => { setSelected(null); refresh() }}/>}</>}
      {error && <p className="form-error" role="alert">{error}<button onClick={refresh}>Повторить</button></p>}</div>
    </Modal>
    <Modal open={view === 'roles'} title="Роли и права" onClose={close} size="medium">{view === 'roles' && serverId && owner && <RoleManager api={api} token={token} serverId={serverId} members={members}/>}</Modal>
    <Modal open={view === 'storage'} title="Хранилище сервера" onClose={close} size="medium">{view === 'storage' && owner && <StorageManager api={api} token={token}/>}</Modal>
  </CommunityContext.Provider>
}

export function CommunityNavigation() {
  const context = useCommunity(); if (!context) return null
  return <nav className="community-navigation" aria-label="Личное пространство"><button onClick={() => context.setView('inbox')}>Входящие{context.inboxCount > 0 && <b>{context.inboxCount >= 50 ? '50+' : context.inboxCount}</b>}</button><button onClick={() => context.setView('messages')}>Личные сообщения{context.directCount > 0 && <b>{context.directCount > 99 ? '99+' : context.directCount}</b>}</button>{context.owner && <><button onClick={() => context.setView('roles')}>Роли и права</button><button onClick={() => context.setView('storage')}>Хранилище</button></>}</nav>
}
function ConversationCreator({ members, busy, onCreate }: { members: ServerMember[]; busy: boolean; onCreate: (ids: number[], name: string) => Promise<void> }) {
  const [ids, setIds] = useState<number[]>([]), [name, setName] = useState('')
  const details = useRef<HTMLDetailsElement>(null)
  return <details className="conversation-create" ref={details}><summary>Новая беседа</summary><form onSubmit={(e) => { e.preventDefault(); void onCreate(ids, name).then(() => { if (details.current) details.current.open = false }) }}><label>Название беседы<input value={name} maxLength={64} onChange={(e) => setName(e.target.value)}/></label><div className="community-member-picker">{members.map((m) => <label key={m.user_id}><input type="checkbox" checked={ids.includes(m.user_id)} disabled={!ids.includes(m.user_id) && ids.length >= 15} onChange={(e) => setIds((v) => e.target.checked ? [...v, m.user_id] : v.filter((id) => id !== m.user_id))}/>{m.username}</label>)}</div><button className="button button--primary" disabled={busy || !ids.length}>Создать беседу</button></form></details>
}
function DirectChat({ api, token, id, currentUserId, revision, onRefresh, onLeave }: { api: VoxholdApi; token: string; id: number; currentUserId: number; revision: number; onRefresh: () => void; onLeave: () => void }) {
  const [messages, setMessages] = useState<DirectMessage[]>([]), [draft, setDraft] = useState(''), [error, setError] = useState(''), [pending, setPending] = useState(false), [more, setMore] = useState(false)
  const retry = useRef<{ content: string; key: string } | null>(null), generation = useRef(0), visible = useRef<HTMLDivElement>(null)
  const upload = useAttachmentUpload({ id, server_id: 0, name: 'Беседа', kind: 'text', position: 0, created_by: 0, created_at: 0 }, true, undefined, id)
  const readCursor = useRef(0), followingBottom = useRef(true), preserveDistance = useRef<number | null>(null), readLatest = useRef<() => void>(() => undefined)
  useLayoutEffect(() => { const list = visible.current; if (!list) return; if (preserveDistance.current !== null) { list.scrollTop = list.scrollHeight - preserveDistance.current; preserveDistance.current = null } else if (followingBottom.current) list.scrollTop = list.scrollHeight }, [messages])
  useEffect(() => {
    const controller = new AbortController(); const current = ++generation.current
    void api.community.request<{ messages: DirectMessage[]; has_more: boolean }>(token, `/conversations/${id}/messages`, 'GET', undefined, controller.signal).then((page) => { if (controller.signal.aborted || current !== generation.current) return; setMessages((values) => [...new Map([...values, ...page.messages].map((m) => [m.id, m])).values()].sort((a, b) => a.id - b.id)); setMore(page.has_more); setError('') }).catch((caught) => { if (!controller.signal.aborted) setError(problem(caught)) })
    return () => controller.abort()
  }, [api, token, id, revision])
  useEffect(() => {
    const latest = messages.at(-1)?.id
    if (!latest || latest <= readCursor.current) return
    const mark = () => { if (document.visibilityState === 'visible' && document.hasFocus() && followingBottom.current && latest > readCursor.current) { readCursor.current = latest; void api.community.request(token, `/conversations/${id}/read`, 'PUT', { message_id: latest }).catch(() => { readCursor.current = 0 }) } }
    readLatest.current = mark; mark(); window.addEventListener('focus', mark); document.addEventListener('visibilitychange', mark); return () => { window.removeEventListener('focus', mark); document.removeEventListener('visibilitychange', mark) }
  }, [api, token, id, messages])
  const send = async () => {
    const content = draft.trim(); if (!content || pending) return
    const key = retry.current?.content === content ? retry.current.key : crypto.randomUUID(); retry.current = { content, key }; setPending(true); setError('')
    try { const sent = await api.community.request<DirectMessage>(token, `/conversations/${id}/messages`, 'POST', { content, client_message_id: key }); setMessages((values) => [...values.filter((m) => m.id !== sent.id), sent].sort((a, b) => a.id - b.id)); setDraft((v) => v.trim() === content ? '' : v); retry.current = null; onRefresh(); requestAnimationFrame(() => visible.current?.scrollTo({ top: visible.current.scrollHeight })) } catch (caught) { setError(problem(caught)) } finally { setPending(false) }
  }
  return <section className="direct-chat" onPaste={upload.onPaste} onDrop={upload.onDrop} onDragOver={upload.onDragOver}><div className="direct-chat__messages" ref={visible} onScroll={() => { const list = visible.current; followingBottom.current = !!list && list.scrollHeight - list.scrollTop - list.clientHeight < 60; readLatest.current() }} aria-live="polite">{more && <button onClick={() => { const list = visible.current; if (list) preserveDistance.current = list.scrollHeight - list.scrollTop; void api.community.request<{ messages: DirectMessage[]; has_more: boolean }>(token, `/conversations/${id}/messages?before=${messages[0]?.id}`).then((page) => { setMessages((v) => [...new Map([...page.messages, ...v].map((m) => [m.id, m])).values()].sort((a, b) => a.id - b.id)); setMore(page.has_more) }).catch((caught) => setError(problem(caught))) }}>Раньше</button>}{messages.map((m) => <article className={m.author.user_id === currentUserId ? 'is-mine' : ''} key={m.id}><b>{m.author.username}</b><p>{m.content}</p><MessageAttachments attachments={m.attachments}/><small>{new Date(m.created_at * 1000).toLocaleString('ru-RU')}</small>{m.author.user_id !== currentUserId && <button onClick={() => void api.community.request(token, `/me/blocks/${m.author.user_id}`, 'PUT').then(onRefresh).catch((caught) => setError(problem(caught)))}>Заблокировать</button>}</article>)}</div>{upload.control}<form onSubmit={(e) => { e.preventDefault(); void send() }}><label className="sr-only" htmlFor={`direct-draft-${id}`}>Сообщение в беседу</label><textarea id={`direct-draft-${id}`} value={draft} maxLength={5120} onChange={(e) => setDraft(e.target.value)} placeholder="Напишите сообщение…"/><button className="button button--primary" disabled={pending || !draft.trim()}>{pending ? 'Отправляем…' : retry.current ? 'Повторить отправку' : 'Отправить'}</button></form>{error && <p className="form-error" role="alert">{error}</p>}<button className="button button--ghost" onClick={() => void api.community.request(token, `/conversations/${id}/members/me`, 'DELETE').then(onLeave).catch((caught) => setError(problem(caught)))}>Покинуть беседу</button></section>
}

export function CustomRoleBadges({ userId }: { userId: number }) {
 const community = useCommunity()
 return <>{community?.roles.filter((r) => r.user_ids.includes(userId)).map((role) => <span key={role.id} className="custom-role-badge" style={{ borderColor: role.color }}><i style={{ background: role.color }}/>{role.name}</span>)}</>
}
