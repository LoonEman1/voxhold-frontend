import { Profiler } from 'react'
import { createRoot } from 'react-dom/client'
import { ChatPanel } from '../../src/components/ChatPanel'
import { ChannelHistoryStore } from '../../src/services/channelHistory'
import type { VoxholdApi } from '../../src/services/api'
import type { Message, ServerMember } from '../../src/domain/types'
import '../../src/styles/global.css'
import '../../src/styles/workspace.css'

const message = (id: number): Message => ({ id, channel_id: 1, content: `Сообщение ${id}: <@2> ${'текст сообщения '.repeat(12)}`, author: { user_id: 1, username: 'Owner' }, revision: 1, created_at: 1_700_000_000 + id * 360, edited_at: null })
const messages = Array.from({ length: 1000 }, (_, i) => message(i + 1))
const members: ServerMember[] = Array.from({ length: 1000 }, (_, i) => ({ user_id: i + 1, username: `User${i + 1}`, role: i === 0 ? 'owner' : 'member', created_at: 0, joined_at: 0, about: '', country_code: null, last_seen_at: null }))
const reads = Object.fromEntries(members.map((m) => [m.user_id, { server_id: 1, channel_id: 1, user_id: m.user_id, last_read_message_id: 1000, updated_at: 0 }]))
const done = async () => undefined
const timings: number[] = []
Object.assign(window, {
  optimizationTimings: timings,
  historyBenchmark: async () => {
    const api = { messages: { sync: async () => ({ messages, deleted_ids: [], cursor: 1000, reset: true, has_more: false }) } } as unknown as VoxholdApi
    const store = new ChannelHistoryStore(api, 'synthetic', 1)
    await store.sync(1, 1)
    let notifications = 0
    const unsubscribe = store.subscribe(1, 1, () => { notifications++ })
    const start = performance.now()
    for (let id = 1001; id <= 2000; id++) store.receive(message(id))
    // Include any bounded batching delay in the end-to-end measurement.
    await new Promise((resolve) => setTimeout(resolve, 25))
    const elapsed = performance.now() - start
    const state = store.snapshot(1)
    const result = { elapsed_ms: elapsed, notifications, messages: state.messages.length, last_id: state.messages.at(-1)?.id }
    unsubscribe(); store.close()
    return result
  },
})
createRoot(document.getElementById('root')!).render(<main style={{ height: '100vh', display: 'flex', flexDirection: 'column', maxWidth: 900 }}><Profiler id="chat" onRender={(_id, phase, duration) => { if (phase !== 'mount') timings.push(duration) }}>
  <ChatPanel channel={{ id: 1, server_id: 1, name: 'optimization', kind: 'text', position: 0, created_by: 1, created_at: 0 }} messages={messages} loading={false} loadingOlder={false} hasMore={false} loadingNewer={false} hasNewer={false} currentUserId={1} currentRole="owner" canManage members={members} pinnedMessageIds={new Set()} channelReads={reads} focusedMessageId={null} onLoadOlder={done} onLoadNewer={done} onReturnToLatest={done} onReadThrough={() => undefined} onSend={done} onEdit={done} onDelete={done} onTogglePin={done} onOpenProfile={() => undefined}/>
</Profiler></main>)
