import { createRoot } from 'react-dom/client'
import { ChatPanel } from '../../src/components/ChatPanel'
import { DirectChat } from '../../src/components/DirectChat'
import { CommunityProvider } from '../../src/components/Community'
import { createApi } from '../../src/services/api'
import { createFetchTransport } from '../../src/platform/transport'
import type { Message } from '../../src/domain/types'
import '../../src/styles/global.css'

const messages: Message[] = Array.from({ length: 80 }, (_, index) => ({
  id: index + 1, channel_id: 1, content: `Сообщение ${index + 1}: https://publisher.example/story/${index} https://other.example/story/${index}`,
  author: { user_id: 2, username: 'Автор' }, created_at: 1700000000 + index * 60, edited_at: null,
}))
const transport = createFetchTransport()
const api = createApi({ request: async (request) => request.path.includes('/conversations/1/messages')
  ? { status: 200, data: { messages: messages.map((message) => ({ ...message, conversation_id: 1, client_message_id: String(message.id) })), has_more: false } as never }
  : transport.request(request) })
const noop = async () => undefined
const history = new URLSearchParams(location.search).has('history')
createRoot(document.getElementById('root')!).render(
  <CommunityProvider api={api} token="fixture" userId={1} serverId={1} owner members={[]} onMessage={() => undefined} onNavigate={() => undefined}>
    <main className="personal-content" style={{ height: '100dvh', display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      {new URLSearchParams(location.search).has('direct')
        ? <DirectChat api={api} token="fixture" id={1} currentUserId={1} revision={0} onRefresh={() => undefined} onLeave={() => undefined}/>
        : <ChatPanel channel={{ id: 1, server_id: 1, name: 'links', kind: 'text', position: 0, created_by: 1, created_at: 0 }} messages={messages} loading={false} loadingOlder={false} hasMore={false} loadingNewer={false} hasNewer={false} currentUserId={1} canManage members={[]} pinnedMessageIds={new Set()} focusedMessageId={null} initialViewport={history ? { messageId: 40, offset: -20, following: false } : undefined} channelReads={{}} onLoadOlder={noop} onLoadNewer={noop} onReturnToLatest={noop} onReadThrough={() => undefined} onSend={noop} onEdit={noop} onDelete={noop} onTogglePin={noop} onOpenProfile={() => undefined}/>}
    </main>
  </CommunityProvider>,
)
