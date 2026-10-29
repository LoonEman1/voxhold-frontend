import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { CommunityContent, CommunityNavigation, CommunityProvider, CommunitySidebar } from '../../src/components/Community'
import { MemberCard } from '../../src/components/MemberCard'
import { Avatar } from '../../src/components/Avatar'
import { Icon } from '../../src/components/Icon'
import { createApi } from '../../src/services/api'
import type { Conversation, CustomRole, DirectMessage, Privacy } from '../../src/domain/community'
import type { Profile, ServerMember } from '../../src/domain/types'
import '../../src/styles/global.css'

const members = [{ user_id: 1, username: 'Александр', role: 'owner' }, { user_id: 2, username: 'Лера', role: 'member' }, { user_id: 3, username: 'Миша', role: 'member' }] as ServerMember[]
let roles: CustomRole[] = [{ id: 1, name: 'Друзья', color: '#63d8e6', permissions: 15, user_ids: [2] }, { id: 2, name: 'Редакция', color: '#a993ff', permissions: 15, user_ids: [] }]
const conversations: Conversation[] = [{ id: 7, name: '', direct: true, unread_count: 2, members: members.slice(0, 2) }, { id: 8, name: 'Планы на выходные', direct: false, unread_count: 1, members }]
const now = Math.floor(Date.now() / 1000)
const messages: DirectMessage[] = [{ id: 1, conversation_id: 7, author: members[1]!, content: 'Привет! Как насчёт собраться в субботу?', client_message_id: 'one', created_at: now - 420 }, { id: 2, conversation_id: 7, author: members[0]!, content: 'Я за! Давай ближе к вечеру, часов в семь.', client_message_id: 'two', created_at: now - 300 }, { id: 3, conversation_id: 7, author: members[1]!, content: 'Отлично, договорились. Позовём ещё Мишу?', client_message_id: 'three', created_at: now - 100 }]
let privacy: Privacy = { mode: 'shared', blocked_user_ids: [] }
const api = createApi({ request: async <T,>({ path, method, body }: { path: string; method?: string; body?: unknown }) => {
  let data: unknown = { ok: true }
  if (path.endsWith('/me/inbox')) data = { items: [{ message_id: 11, channel_id: 1, server_id: 1, server_name: 'FirstInstance', channel_name: 'общий', author: 'Миша', content: 'Александр, посмотри новый план на выходные', created_at: now, reason: 'mention' }], has_more: false }
  else if (path.endsWith('/message-privacy')) { if (method === 'PUT') privacy = { ...privacy, ...body as Privacy }; data = privacy }
  else if (path.endsWith('/me/conversations')) {
    if (method === 'POST') { const input = body as { user_ids: number[]; name: string }; const existing = input.user_ids.length === 1 && conversations.find((v) => v.direct && v.members.some((m) => m.user_id === input.user_ids[0])); if (existing) data = existing; else { const value = { id: conversations.length + 10, name: input.name ?? '', direct: input.user_ids.length === 1, unread_count: 0, members: members.filter((m) => m.user_id === 1 || input.user_ids.includes(m.user_id)) }; conversations.push(value); data = value } }
    else data = conversations
  } else if (/\/conversations\/\d+\/messages$/.test(path)) {
    const id = Number(path.split('/').at(-2))
    if (method === 'POST') { const value = { ...body as { content: string; client_message_id: string }, id: messages.length + 1, conversation_id: id, author: members[0]!, created_at: now }; messages.push(value); data = value }
    else data = { messages: messages.filter((m) => m.conversation_id === id), has_more: false }
  } else if (path.endsWith('/members/2/roles') && method === 'PUT') { const ids = (body as { role_ids: number[] }).role_ids; roles = roles.map((r) => ({ ...r, user_ids: ids.includes(r.id) ? [2] : [] })) }
  else if (path.endsWith('/roles')) { if (method === 'POST') { const value = { ...body as CustomRole, id: roles.length + 1, user_ids: [] }; roles.push(value); data = value } else data = roles }
  return { status: 200, data: structuredClone(data) as T }
} })
const profile: Profile = { user_id: 2, username: 'Лера', about: 'Хорошие разговоры, горы и настолки по выходным.', country_code: 'RU', created_at: now - 86400, last_seen_at: now }
function Fixture() {
  const [card, setCard] = useState(false), [full, setFull] = useState(false), [mobile, setMobile] = useState(false), [anchor, setAnchor] = useState({ x: 0, y: 0 })
  return <CommunityProvider api={api} token="fixture" userId={1} serverId={1} owner members={members} onMessage={() => {}} onNavigate={() => {}} onViewChange={() => setMobile(false)}><main className="workspace workspace--members-open">
    <CommunityNavigation/>
    <aside className={`channel-sidebar ${mobile ? 'is-mobile-open' : ''}`}><CommunitySidebar><header className="server-header"><div><span className="eyebrow">ПРОСТРАНСТВО</span><h2>FirstInstance</h2></div><Icon name="settings"/></header><div className="channel-scroll"><div className="channel-group"><span className="eyebrow">ТЕКСТОВЫЕ КАНАЛЫ</span><div className="channel-row is-active"><button className="channel-row__main"><Icon name="hash"/>общий</button></div></div></div></CommunitySidebar><div className="user-dock"><Avatar userId={1} name="Александр" online/><b style={{ fontSize: 12 }}>Александр</b><Icon name="settings"/></div></aside>
    <CommunityContent onMenu={() => setMobile((v) => !v)}><section className="content-shell"><header className="content-header"><div className="content-header__title"><Icon name="hash"/><h1>общий</h1></div></header><div className="personal-empty"><h2>Добро пожаловать в FirstInstance</h2><div>Общайтесь в каналах или загляните в личное пространство слева.</div></div></section><aside className="members-sidebar is-open"><header>УЧАСТНИКИ · 3</header><div className="member-group"><button className="member-row" onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); setAnchor({ x: rect.left, y: rect.top + 24 }); setCard(true) }}><Avatar userId={2} name="Лера" online/><span><b>Лера</b><small>Участник</small></span></button></div></aside></CommunityContent>
    {mobile && <button className="mobile-scrim" aria-label="Закрыть меню" onClick={() => setMobile(false)}/>}
    {card && <MemberCard profile={profile} role="member" online loading={false} error="" anchor={anchor} onClose={() => setCard(false)} onOpenProfile={() => { setCard(false); setFull(true) }} onMessage={() => { setCard(false); window.dispatchEvent(new CustomEvent('voxhold:open-direct', { detail: 2 })) }}/>} {full && <div role="dialog" aria-label="Полный профиль">Полный профиль Леры</div>}
  </main></CommunityProvider>
}
createRoot(document.getElementById('root')!).render(<Fixture/>)
