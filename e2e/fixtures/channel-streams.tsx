import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { VoicePanel } from '../../src/components/VoicePanel'
import { PersistentStreamPlayer } from '../../src/components/PersistentStreamPlayer'
import { StreamSettingsDialog } from '../../src/components/StreamSettingsDialog'
import { DEFAULT_STREAM_PREFERENCES } from '../../src/services/streamSettings'
import type { ActiveStream, Channel, ServerMember } from '../../src/domain/types'
import '../../src/styles/global.css'

const channel = { id: 1, server_id: 1, kind: 'voice', name: 'Вечерний разговор' } as Channel
const members = [{ user_id: 1, username: 'Александр', role: 'owner' }, { user_id: 2, username: 'Лера', role: 'member' }, { user_id: 3, username: 'Миша', role: 'member' }] as ServerMember[]
const initial: ActiveStream[] = [2, 3].map((id) => ({ server_id: 1, channel_id: 1, publisher_user_id: id, publisher_connection_id: `publisher-${id}`, mode: 'server', codec: 'vp8', has_audio: true, viewer_count: id, started_at_ms: Date.now() - id * 60000 }))
function Fixture() {
  const [streams, setStreams] = useState(initial), [selected, setSelected] = useState<string | null>(null), [expanded, setExpanded] = useState(false), [settings, setSettings] = useState(false)
  const [preferences, setPreferences] = useState({ ...DEFAULT_STREAM_PREFERENCES }), [media, setMedia] = useState<MediaStream | null>(null)
  const current = streams.find((item) => item.publisher_connection_id === selected) ?? null
  const publisher = current?.publisher_user_id === 1
  useEffect(() => {
    const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 360
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#35442a'; ctx.fillRect(0, 0, 640, 360); ctx.fillStyle = '#e7ff5b'; ctx.font = '28px sans-serif'; ctx.fillText('Совместный вечер в Voxhold', 110, 180)
    const captured = canvas.captureStream(1); setMedia(captured)
    return () => captured.getTracks().forEach((track) => track.stop())
  }, [])
  const share = () => { const value = { ...initial[0]!, publisher_user_id: 1, publisher_connection_id: 'own' }; setStreams((values) => [...values, value]); setSelected('own') }
  return <main style={{ height: '100dvh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
    <VoicePanel channel={channel} activeChannel={channel} participants={[]} members={members} currentUserId={1} connectionStatus="connected" realtimeOnline selfMute={false} selfDeaf={false} error="" onJoin={async () => {}} onLeave={() => {}} onToggleMute={() => {}} onToggleDeaf={() => {}} onOpenProfile={() => {}} stream={current} streamList={streams} streamRole={selected ? publisher ? 'publisher' : 'viewer' : null} multipleStreams streamStatus={selected ? 'connected' : 'idle'} streamError="" streamMedia={selected && !expanded ? media : null} streamPreferences={preferences} onStreamPreferencesChange={setPreferences} onOpenStreamSettings={() => { if (publisher) setSettings(true); else share() }} onWatchStream={(id) => setSelected(id ?? initial[0]!.publisher_connection_id)} onLeaveStream={() => setSelected(null)} onExpandStream={() => setExpanded(true)}/>
    {expanded && selected && media && <PersistentStreamPlayer mode="expanded" stream={current} role={publisher ? 'publisher' : 'viewer'} status="connected" media={media} channelName={channel.name} preferences={preferences} onPreferencesChange={setPreferences} onExpand={() => {}} onCollapse={() => setExpanded(false)} onLeave={() => { setExpanded(false); setSelected(null) }} onOpenSettings={() => setSettings(true)}/>}
    {settings && <StreamSettingsDialog open live liveHasAudio busy={false} preferences={preferences} onChange={setPreferences} onApply={async (next) => setPreferences(next)} onStart={() => {}} onClose={() => setSettings(false)}/>}
    <button type="button" onClick={() => setStreams((values) => values.filter((item) => item.publisher_connection_id !== 'publisher-2'))}>Fixture: stop first publisher</button>
    <output aria-label="Применённое качество">{preferences.resolution} · {preferences.frameRate} FPS · {preferences.videoBitrateKbps / 1000} Мбит/с</output>
  </main>
}
createRoot(document.getElementById('root')!).render(<Fixture/>)
