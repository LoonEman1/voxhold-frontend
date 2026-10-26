import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { VoicePanel } from '../../src/components/VoicePanel'
import { CallControls } from '../../src/components/CallControls'
import { ChatPanel } from '../../src/components/ChatPanel'
import { RecordingsDialog } from '../../src/components/RecordingsDialog'
import { useCallRecordings } from '../../src/hooks/useCallRecordings'
import type { ChannelRecording, ServerMember } from '../../src/domain/types'
import type { VoxholdApi } from '../../src/services/api'
import type { BrowserVoiceSession } from '../../src/services/voice'
import { DEFAULT_STREAM_PREFERENCES } from '../../src/services/streamSettings'
import '../../src/styles/global.css'
import '../../src/styles/workspace.css'

const done = async () => {}
const channel = { id: 1, server_id: 1, name: 'Общий голосовой', kind: 'voice' as const, position: 0, created_by: 1, created_at: 0 }
const members = ['Александр', 'Мария', 'Дмитрий', 'София', 'Артём'].map((username, index) => ({ user_id: index + 1, username, role: index ? 'member' : 'owner' })) as ServerMember[]
function Fixture() {
  const [voice, setVoice] = useState<{ serverId: number; channelId: number } | null>({ serverId: 1, channelId: 1 })
  const [media, setMedia] = useState<MediaStream | null>(null)
  const [mute, setMute] = useState(false), [deaf, setDeaf] = useState(false), [chat, setChat] = useState(false), [list, setList] = useState(false)
  const [notifications, setNotifications] = useState<string[]>([]), [ready, setReady] = useState(0)
  const notifyRef = useRef((message: string) => setNotifications((current) => [...current, message]))
  const voiceMedia = useRef<BrowserVoiceSession | null>(null)
  const remoteRecords = useRef(new Map<string, ChannelRecording>())
  const previews = useRef(new Map<string, Blob>())
  const offsets = useRef(new Map<string, number>())
  const api = useRef({ recordings: {
    list: async () => ({ recordings: Array.from(remoteRecords.current.values()) }),
    preview: async (_token: string, id: string) => previews.current.get(id)!,
    uploadPreview: async (_token: string, id: string, image: Blob) => {
      previews.current.set(id,image)
      const record = { ...remoteRecords.current.get(id)!, preview_version: 'preview-v1', updated_at: Date.now()+1 }
      remoteRecords.current.set(id,record); return record
    },
    start: async (_token: string, _server: number, _channel: number, mime: string) => {
      const record = { id: crypto.randomUUID().replaceAll('-', ''), server_id: 1, channel_id: 1, owner_user_id: 1, owner_username: 'Александр', status: 'recording', mime_type: mime, size_bytes: 0, duration_ms: 0, created_at: Math.floor(Date.now() / 1000), updated_at: Date.now(), expires_at: Math.floor(Date.now() / 1000) + 86400 } as ChannelRecording
      remoteRecords.current.set(record.id, record); return record
    },
    heartbeat: done,
    stop: async (_token: string, id: string, bytes: number, duration: number, local = false) => {
      const record = { ...remoteRecords.current.get(id)!, status: local ? 'local_only' : 'uploading', size_bytes: bytes, duration_ms: duration, updated_at: Date.now() } as ChannelRecording
      remoteRecords.current.set(id, record); return record
    },
    offset: async (_token: string, id: string) => ({ offset: offsets.current.get(id) ?? 0 }),
    append: async (_token: string, id: string, offset: number, chunk: Blob, signal?: AbortSignal) => {
      await new Promise((resolve) => setTimeout(resolve, 120))
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      offsets.current.set(id, offset + chunk.size); return { offset: offset + chunk.size }
    },
    complete: async (_token: string, id: string) => {
      const record = { ...remoteRecords.current.get(id)!, status: 'ready', updated_at: Date.now() } as ChannelRecording
      remoteRecords.current.set(id, record); setReady((value) => value + 1); return record
    },
  } } as unknown as VoxholdApi).current
  const recording = useCallRecordings({ api, token: 'fixture', scope: 'calls-fixture', serverId: 1, voice, voiceMedia, stream: media, notify: notifyRef.current })
  useEffect(() => {
    const canvas = document.createElement('canvas'); canvas.width = 1280; canvas.height = 720
    const context = canvas.getContext('2d')!
    const timer = window.setInterval(() => {
      context.fillStyle = '#111927'; context.fillRect(0, 0, 1280, 720)
      context.fillStyle = '#e7ff5b'; context.font = 'bold 44px sans-serif'; context.fillText('Voxhold', 64, 94)
      context.fillStyle = '#a9b8ca'; context.font = '26px sans-serif'; context.fillText('Обсуждаем проект с командой', 64, 148)
      for (let i = 0; i < 11; i++) { context.fillStyle = i % 3 ? '#35455c' : '#657f62'; context.fillRect(64, 215 + i * 34, 470 + Math.sin(i * 2) * 250, 10) }
    }, 1000 / 24)
    const stream = canvas.captureStream(24)
    const audio = new AudioContext(); const destination = audio.createMediaStreamDestination(); const oscillator = audio.createOscillator(); oscillator.connect(destination); oscillator.start()
    voiceMedia.current = { recordingAudioTracks: () => destination.stream.getAudioTracks(), subscribeRecordingAudio: () => () => {} } as unknown as BrowserVoiceSession
    setMedia(stream)
    return () => { clearInterval(timer); stream.getTracks().forEach((track) => track.stop()); oscillator.stop(); void audio.close() }
  }, [])
  const controls = <CallControls selfMute={mute} selfDeaf={deaf} recording={!!recording.activeId} recordBusy={recording.busy} canRecord={!!voice} canShare={false} chatOpen={chat} onMute={() => setMute((value) => !value)} onDeaf={() => setDeaf((value) => !value)} onRecord={() => { if (recording.activeId) void recording.stop(); else void recording.start() }} onRecordings={() => setList(true)} onChat={() => setChat((value) => !value)} onShare={() => {}} onLeave={() => setVoice(null)}/>
  return <main style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
    <header style={{ display: 'flex', justifyContent: 'space-between', padding: '16px 24px', borderBottom: '1px solid #ffffff14' }}><b>🔊 {channel.name}</b><span>Серверных копий: <output id="ready">{ready}</output></span><button onClick={() => setList(true)}>Записи</button></header>
    <VoicePanel channel={channel} activeChannel={voice ? channel : null} participants={members.map((member) => ({ connection_id: String(member.user_id), user_id: member.user_id, server_id: 1, channel_id: 1, self_mute: false, self_deaf: false, joined_at: 0 }))} members={members} currentUserId={1} speakingUserIds={[2]} connectionStatus={voice ? 'connected' : 'idle'} realtimeOnline selfMute={mute} selfDeaf={deaf} error="" onJoin={async () => setVoice({ serverId: 1, channelId: 1 })} onLeave={() => setVoice(null)} onToggleMute={() => setMute(!mute)} onToggleDeaf={() => setDeaf(!deaf)} onOpenProfile={() => {}} stream={{ channel_id: 1, publisher_user_id: 1, viewer_count: 4, mode: 'server', codec: 'h264', has_audio: false, server_id: 1, publisher_connection_id: '1', started_at_ms: Date.now() }} streamStatus="connected" streamError="" streamMedia={media} streamPreferences={DEFAULT_STREAM_PREFERENCES} onStreamPreferencesChange={() => {}} onOpenStreamSettings={() => {}} onWatchStream={() => {}} onLeaveStream={() => {}} onExpandStream={() => {}} controls={controls} recordingLabel={recording.activeId ? 'Александр' : undefined} chat={chat ? <aside className="voice-channel-chat"><header><b>Чат канала</b></header><ChatPanel channel={channel} messages={[{ id: 1, channel_id: 1, author: { user_id: 2, username: 'Мария' }, content: 'Всё слышно. Давайте запишем встречу.', created_at: Date.now() / 1000, edited_at: null }]} loading={false} loadingOlder={false} hasMore={false} currentUserId={1} canManage members={members} pinnedMessageIds={new Set()} channelReads={{}} onLoadOlder={done} onLoadNewer={done} onReturnToLatest={done} onReadThrough={() => {}} loadingNewer={false} hasNewer={false} focusedMessageId={null} onSend={done} onEdit={done} onDelete={done} onTogglePin={done} onOpenProfile={() => {}}/></aside> : null}/>
    <RecordingsDialog open={list} onClose={() => setList(false)} records={recording.records} locals={recording.locals} serverId={1} progress={recording.progress} voiceActive={!!voice} onDownload={recording.download} onRemoveLocal={recording.removeLocal} onRetry={recording.retry} loadPreview={recording.loadPreview}/>
    <output id="notifications" style={{ position: 'fixed', left: 10, bottom: 2, fontSize: 10 }}>{notifications.join(' · ')}</output>
  </main>
}
createRoot(document.getElementById('root')!).render(<Fixture/>)
