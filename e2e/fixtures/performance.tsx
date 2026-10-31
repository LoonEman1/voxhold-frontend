import { CommunityProvider } from '../../src/components/Community'
import { createApi } from '../../src/services/api'
import { createFetchTransport } from '../../src/platform/transport'
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ChatPanel } from '../../src/components/ChatPanel'
import type { Message } from '../../src/domain/types'
import '../../src/styles/global.css'
import '../../src/styles/workspace.css'

const images = new URLSearchParams(location.search).has('images')
const api = createApi(createFetchTransport())
const message = (id: number): Message => ({ id, channel_id: 1, content: `Сообщение ${id}: ${'проверка текста '.repeat(id % 7 + 1)}`, author: { user_id: id % 3 + 1, username: `User ${id % 3 + 1}` }, created_at: 1_700_000_000 + id * 360, edited_at: null, attachments: images ? [{ id: String(id), filename: `image-${id}.png`, mime_type: 'image/png', size_bytes: 10, width: 800, height: 400, deleted: false }] : [] })
const done = async () => undefined
function Fixture() {
  const [messages, setMessages] = useState(() => Array.from({ length: 5_000 }, (_, index) => message(index + 1001)))
  const [focus, setFocus] = useState<number | null>(null)
  const content = <main style={{ height: '100vh', display: 'flex', flexDirection: 'column', maxWidth: 900 }}>
    <nav><button id="prepend" onClick={() => setMessages((current) => [...Array.from({ length: 50 }, (_, index) => message(current[0]!.id - 50 + index)), ...current])}>Older</button><button id="append" onClick={() => setMessages((current) => [...current, message(current.at(-1)!.id + 1)])}>Append</button><button id="focus" onClick={() => setFocus(2500)}>Jump</button></nav>
    <ChatPanel channel={{ id: 1, server_id: 1, name: 'performance', kind: 'text', position: 0, created_by: 1, created_at: 0 }} messages={messages}
      loading={false} loadingOlder={false} hasMore={false} loadingNewer={false} hasNewer={false}
      currentUserId={99} canManage={false} members={[]} pinnedMessageIds={new Set()} channelReads={{}} focusedMessageId={focus}
      onLoadOlder={done} onLoadNewer={done} onReturnToLatest={done} onReadThrough={() => undefined}
      onSend={done} onEdit={done} onDelete={done} onTogglePin={done} onOpenProfile={() => undefined}/>
  </main>
  return images ? <CommunityProvider api={api} token="fixture" userId={99} serverId={1} owner={false} members={[]} onMessage={() => undefined} onNavigate={() => undefined}>{content}</CommunityProvider> : content
}
createRoot(document.getElementById('root')!).render(<Fixture/>)
