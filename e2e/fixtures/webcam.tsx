import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ConversationCall } from '../../src/services/conversationCall'
import { VoicePanel } from '../../src/components/VoicePanel'
import { CameraSettingsDialog } from '../../src/components/CameraSettingsDialog'
import { DEFAULT_STREAM_PREFERENCES } from '../../src/services/streamSettings'
import type { VoxholdApi } from '../../src/services/api'
import type { CallState, CallSignal } from '../../src/domain/community'
import type { ServerMember } from '../../src/domain/types'
import type { CameraQuality } from '../../src/services/camera'
import '../../src/styles/global.css'
import '../../src/styles/workspace.css'

const publisherId = new URLSearchParams(location.search).get('publisher') === '2' ? 2 : 1
const viewerId = publisherId === 1 ? 2 : 1
const calls = new Map<number, ConversationCall>()
const joined = new Set<number>()
const errors: string[] = []
const connections: RTCPeerConnection[] = []
const NativePeerConnection = RTCPeerConnection
globalThis.RTCPeerConnection = class extends NativePeerConnection {
  constructor(configuration?: RTCConfiguration) { super(configuration); connections.push(this) }
}
let revision = 0
let publisher: ConversationCall
let publisherCamera: MediaStream | null = null
const state = (): CallState => ({ conversation_id: 1, revision: ++revision, members: [...joined].map((id) => ({ user_id: id, username: id === 1 ? 'Alice' : 'Bob', session_id: calls.get(id)!.sessionId })) })
function api(userId: number) {
  return { webrtc: { config: async () => ({ ice_servers: [] }) }, community: { request: async (_token: string, path: string, method: string, input: Record<string, unknown>) => {
    if (path.endsWith('/signal')) {
      const signal = { ...input, conversation_id: 1, from_user_id: userId } as unknown as CallSignal
      queueMicrotask(() => calls.get(input.target_user_id as number)?.signal(signal))
      return { ok: true }
    }
    if (method === 'PUT') joined.add(userId); else joined.delete(userId)
    const snapshot = state()
    queueMicrotask(() => { for (const id of joined) calls.get(id)?.update(snapshot) })
    return snapshot
  } } } as unknown as VoxholdApi
}
const channel = { id: 1, server_id: 1, kind: 'voice' as const, name: 'Комната с камерой', position: 0, created_at: 0, created_by: 1 }
const members = [{ user_id: 1, username: 'Alice', role: 'member' }, { user_id: 2, username: 'Bob', role: 'member' }] as ServerMember[]
function Fixture() {
  const [ready, setReady] = useState(false), [camera, setCamera] = useState<MediaStream | null>(null), [screen, setScreen] = useState<MediaStream | null>(null), [settings, setSettings] = useState(false), [quality, setQuality] = useState<CameraQuality>('medium'), [error, setError] = useState('')
  useEffect(() => {
    const report = (message: string) => { errors.push(message); setError(message) }
    const callbacks = { state: () => {}, media: () => {}, removed: () => {}, error: report, screen: () => {}, ended: () => {} }
    publisher = new ConversationCall(api(publisherId), 'fixture', 1, publisherId, { ...callbacks, camera: (stream) => { publisherCamera = stream } })
    const viewer = new ConversationCall(api(viewerId), 'fixture', 1, viewerId, { ...callbacks, remoteCamera: (_id, value) => setCamera(value ? new MediaStream(value.getTracks()) : null), media: (_id, value) => setScreen(value.getVideoTracks().length ? new MediaStream(value.getVideoTracks()) : null) })
    calls.set(publisherId, publisher); calls.set(viewerId, viewer)
    // Avoid persisted key storage changing this transport regression's scope.
    Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: undefined })
    const originalCapture = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices)
    let screenTimer: ReturnType<typeof setInterval> | undefined
    navigator.mediaDevices.getDisplayMedia = async () => {
      const canvas = document.createElement('canvas'); canvas.width = 1280; canvas.height = 720
      const context = canvas.getContext('2d')!
      screenTimer = setInterval(() => { context.fillStyle = '#183c63'; context.fillRect(0, 0, 1280, 720); context.fillStyle = '#fff'; context.font = '60px sans-serif'; context.fillText(`Screen ${Date.now()}`, 40, 150) }, 30)
      return canvas.captureStream(24)
    }
    void publisher.start().then(() => viewer.start()).then(() => setReady(true)).catch((caught: unknown) => report(String(caught)))
    Object.assign(window, { webcamHarness: { publisher, errors, settings: () => publisherCamera?.getVideoTracks()[0]?.getSettings(), diagnostics: async () => Promise.all(connections.map(async (pc) => ({ state: pc.connectionState, signaling: pc.signalingState, local: pc.localDescription?.sdp, remote: pc.remoteDescription?.sdp, tracks: pc.getTransceivers().map((value) => ({ mid: value.mid, send: value.sender.track?.id, receive: value.receiver.track.id, muted: value.receiver.track.muted, direction: value.currentDirection })), stats: [...(await pc.getStats()).values()].filter((value) => ['inbound-rtp', 'outbound-rtp'].includes(value.type)) }))) } })
    return () => { publisher.close(); viewer.close(); calls.clear(); joined.clear(); if (screenTimer) clearInterval(screenTimer); navigator.mediaDevices.getDisplayMedia = originalCapture }
  }, [])
  return <main style={{ height: '100dvh', display: 'flex', flexDirection: 'column' }}><header style={{ padding: 20, display: 'flex', gap: 12 }}>
    <button disabled={!ready} onClick={() => setSettings(true)}>Камера</button><button disabled={!ready} onClick={() => publisher.stopCamera()}>Выключить камеру</button><button disabled={!ready} onClick={() => void publisher.shareScreen()}>Экран</button><button onClick={() => publisher.mute(true)}>Выключить микрофон</button>
  </header><VoicePanel cameras={camera ? { [publisherId === 1 ? 'alice' : 'bob']: camera } : {}} channel={channel} activeChannel={channel} participants={members.map((member) => ({ connection_id: member.user_id === 1 ? 'alice' : 'bob', user_id: member.user_id, server_id: 1, channel_id: 1, self_mute: false, self_deaf: false, self_video: member.user_id === publisherId && !!camera }))} members={members} currentUserId={viewerId} connectionStatus="connected" realtimeOnline selfMute={false} selfDeaf={false} error={error} onJoin={async () => {}} onLeave={() => publisher.close()} onToggleMute={() => {}} onToggleDeaf={() => {}} onOpenProfile={() => {}} stream={screen ? { channel_id: 1, server_id: 1, publisher_user_id: publisherId, publisher_connection_id: publisherId === 1 ? 'alice' : 'bob', codec: 'vp8', mode: 'server', has_audio: false, viewer_count: 1, started_at_ms: Date.now() } : null} streamStatus="connected" streamError="" streamMedia={screen} streamPreferences={DEFAULT_STREAM_PREFERENCES} onStreamPreferencesChange={() => {}} onOpenStreamSettings={() => {}} onWatchStream={() => {}} onLeaveStream={() => {}} onExpandStream={() => {}}/>
  {settings && <CameraSettingsDialog quality={quality} active={!!camera} onClose={() => setSettings(false)} onCancel={() => { if (!camera) publisher.stopCamera() }} onApply={async (value) => { if (camera) await publisher.setCameraQuality(value); else await publisher.startCamera(value); setQuality(value) }}/>}
  </main>
}
createRoot(document.getElementById('root')!).render(<Fixture/> )
