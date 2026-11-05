import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ChatPanel } from '../../src/components/ChatPanel'
import { DirectChat } from '../../src/components/DirectChat'
import { CommunityProvider } from '../../src/components/Community'
import { createApi } from '../../src/services/api'
import { createFetchTransport } from '../../src/platform/transport'
import type { Message } from '../../src/domain/types'
import '../../src/styles/global.css'
import '../../src/styles/personal-space.css'

const api = createApi(createFetchTransport()), noop = async () => undefined
function Fixture() {
  const [messages, setMessages] = useState<Message[]>([{ id: 1, channel_id: 1, content: 'Планы на вечер? Можно обсудить здесь или создать опрос.', author: { user_id: 2, username: 'Александр' }, created_at: 1700000000, edited_at: null }])
  const direct = new URLSearchParams(location.search).has('direct')
  return <CommunityProvider api={api} token="fixture" userId={1} serverId={1} owner={false} members={[]} onMessage={() => undefined} onNavigate={() => undefined}>
    <main className={direct ? 'personal-content' : undefined} style={{ height: '100dvh', display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      <header className="content-header"><div className="content-header__title"><h1>{direct ? 'Личные сообщения' : 'общий-чат'}</h1></div></header>
      {direct ? <DirectChat api={api} token="fixture" id={7} currentUserId={1} revision={0} onRefresh={() => undefined} onLeave={() => undefined}/> : <ChatPanel channel={{ id: 1, server_id: 1, name: 'общий-чат', kind: 'text', position: 0, created_by: 2, created_at: 0, permissions: 19, can_publish: true }} messages={messages} loading={false} loadingOlder={false} hasMore={false} loadingNewer={false} hasNewer={false} currentUserId={1} currentRole="member" canManage={false} members={[]} pinnedMessageIds={new Set()} focusedMessageId={null} channelReads={{}} onLoadOlder={noop} onLoadNewer={noop} onReturnToLatest={noop} onReadThrough={() => undefined} onSend={async (content, _reply, attachmentIds) => { const sent = await api.community.request<Message>('fixture', '/servers/1/channels/1/messages', 'POST', { content, attachment_ids: attachmentIds }); setMessages((values) => [...values, sent]) }} onEdit={noop} onDelete={noop} onTogglePin={noop} onOpenProfile={() => undefined}/>}
    </main>
  </CommunityProvider>
}
createRoot(document.getElementById('root')!).render(<Fixture/>)
