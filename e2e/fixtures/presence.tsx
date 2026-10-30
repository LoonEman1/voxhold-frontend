import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ChatPanel } from '../../src/components/ChatPanel'
import type { Channel, Message, ServerMember } from '../../src/domain/types'
import '../../src/styles/global.css'
import '../../src/styles/workspace.css'

const channel: Channel = { id: 1, server_id: 1, name: 'presence', kind: 'text', position: 0, created_by: 1, created_at: 1 }
const messages: Message[] = Array.from({ length: 100 }, (_, i) => ({ id: i + 1, channel_id: 1, content: `Hello <@2> ${i}`, author: { user_id: 2, username: 'Bob' }, created_at: 1 + i, edited_at: null }))
const initialMembers = Array.from({ length: 200 }, (_, i) => ({ user_id: i + 1, username: i === 1 ? 'Bob' : `User${i}`, role: 'member', last_seen_at: 1 })) as ServerMember[]
const pins = new Set<number>(), reads = {}, done = async () => undefined, noop = () => undefined
function Fixture() {
  const [members, setMembers] = useState(initialMembers)
  Object.assign(window, { presenceFixture: {
    update: (seen: number) => setMembers((values) => values.map((member) => ({ ...member, last_seen_at: seen }))),
    rename: () => setMembers((values) => values.map((member) => member.user_id === 2 ? { ...member, username: 'Robert' } : member)),
  } })
  return <main style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}><ChatPanel
    channel={channel} messages={messages} members={members} loading={false} loadingOlder={false} hasMore={false} loadingNewer={false} hasNewer={false}
    currentUserId={99} canManage={false} pinnedMessageIds={pins} channelReads={reads} focusedMessageId={null}
    onLoadOlder={done} onLoadNewer={done} onReturnToLatest={done} onReadThrough={noop} onSend={done} onEdit={done} onDelete={done} onTogglePin={done} onOpenProfile={noop}/></main>
}
createRoot(document.getElementById('root')!).render(<Fixture/>)
