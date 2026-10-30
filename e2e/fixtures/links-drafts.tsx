import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ChatPanel } from '../../src/components/ChatPanel'
import { CommunityProvider } from '../../src/components/Community'
import { createApi } from '../../src/services/api'
import { createFetchTransport } from '../../src/platform/transport'
import type { Message } from '../../src/domain/types'
import '../../src/styles/global.css'

const api = createApi(createFetchTransport())
const noop = async () => undefined
function Fixture() {
  const [channel, setChannel] = useState(1), [pins, setPins] = useState(new Set<number>())
  const [messages, setMessages] = useState<Message[]>([
    { id: 1, channel_id: 1, content: 'Видео: https://www.youtube.com/watch?v=dQw4w9WgXcQ', author: { user_id: 2, username: 'Александр' }, created_at: 1700000000, edited_at: null },
    { id: 2, channel_id: 1, content: 'Статья: https://publisher.example/articles/review', author: { user_id: 2, username: 'Александр' }, created_at: 1700000060, edited_at: null },
    { id: 3, channel_id: 1, content: 'Обсуждение: https://dtf.ru/articles/example', author: { user_id: 2, username: 'Александр' }, created_at: 1700000120, edited_at: null },
  ])
  return <CommunityProvider api={api} token="fixture" userId={1} serverId={1} owner={false} members={[]} onMessage={() => undefined} onNavigate={() => undefined}>
    <main style={{ height: '100dvh', display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      <nav style={{ padding: 8, display: 'flex', gap: 12 }}><button onClick={() => setChannel(1)}>Канал A</button><button onClick={() => setChannel(2)}>Канал B</button></nav>
      <ChatPanel channel={{ id: channel, server_id: 1, name: channel === 1 ? 'general' : 'other', kind: 'text', position: 0, created_by: 2, created_at: 0, permissions: 19, can_publish: true }} messages={channel === 1 ? messages : []} loading={false} loadingOlder={false} hasMore={false} loadingNewer={false} hasNewer={false} currentUserId={1} currentRole="member" canManage={false} members={[]} pinnedMessageIds={pins} focusedMessageId={null} channelReads={{}} onLoadOlder={noop} onLoadNewer={noop} onReturnToLatest={noop} onReadThrough={() => undefined} onSend={async (content) => setMessages((values) => [...values, { id: values.length+1, channel_id: channel, content, author: { user_id: 1, username: 'Вы' }, created_at: 1700000180, edited_at: null }])} onEdit={noop} onDelete={async (id) => setMessages((values) => values.filter((m) => m.id !== id))} onTogglePin={async (id, active) => setPins((values) => { const next = new Set(values); if (active) next.delete(id); else next.add(id); return next })} onOpenProfile={() => undefined}/>
    </main>
  </CommunityProvider>
}
createRoot(document.getElementById('root')!).render(<Fixture/>)
