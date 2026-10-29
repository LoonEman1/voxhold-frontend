import { useCallback, useEffect, useRef, useState } from 'react'
import type { VoxholdApi } from '../services/api'
import type { CallState, CallSignal } from '../domain/community'
import { ConversationCall } from '../services/conversationCall'
import { loadVoicePreferences } from '../services/voiceSettings'

function RemoteMedia({ stream, name, deaf }: { stream: MediaStream; name: string; deaf: boolean }) {
  const audio = useRef<HTMLAudioElement>(null), video = useRef<HTMLVideoElement>(null), [blocked, setBlocked] = useState(false)
  const hasVideo = stream.getVideoTracks().some((t) => t.readyState === 'live')
  useEffect(() => { const element = audio.current; if (!element) return; element.srcObject = stream; const prefs = loadVoicePreferences(); element.volume = prefs.outputVolume / 100; if (prefs.outputDeviceId && 'setSinkId' in element) void element.setSinkId(prefs.outputDeviceId).catch(() => undefined); void element.play().then(() => setBlocked(false)).catch(() => setBlocked(true)); return () => { element.pause(); element.srcObject = null } }, [stream])
  useEffect(() => { const element = video.current; if (!element) return; element.srcObject = stream; void element.play().catch(() => undefined); return () => { element.srcObject = null } }, [stream, hasVideo])
  return <div><audio ref={audio} autoPlay muted={deaf}/>{hasVideo && <><span>{name} · Демонстрация экрана</span><video ref={video} autoPlay playsInline muted controls/></>}{blocked && <button onClick={() => { void audio.current?.play().then(() => setBlocked(false)) }}>Включить звук {name}</button>}</div>
}
export function ConversationCallDock({ api, token, userId }: { api: VoxholdApi; token: string; userId: number }) {
  const call = useRef<ConversationCall | null>(null), [state, setState] = useState<CallState | null>(null), [media, setMedia] = useState<Record<number, MediaStream>>({}), [error, setError] = useState(''), [pending, setPending] = useState(false), [muted, setMuted] = useState(false), [deaf, setDeaf] = useState(false), [sharing, setSharing] = useState(false)
  const leave = useCallback(() => { call.current?.close(); call.current = null; setState(null); setMedia({}); setPending(false); setSharing(false); setMuted(false); setDeaf(false) }, [])
  useEffect(() => {
    let alive = true
    const start = async (event: Event) => {
      const cid = (event as CustomEvent<number>).detail; if (!Number.isSafeInteger(cid)) return; if(call.current){setError('Сначала завершите текущий звонок');return}
      window.dispatchEvent(new Event('voxhold:direct-call-starting'))
      setError(''); setPending(true); setState({ conversation_id: cid, revision:0, members: [] })
      const instance = new ConversationCall(api, token, cid, userId, { state: (v) => { if (alive) setState(v) }, media: (id, stream) => { if (alive) setMedia((v) => ({ ...v, [id]: new MediaStream(stream.getTracks()) })) }, removed: (id) => { if (alive) setMedia((v) => Object.fromEntries(Object.entries(v).filter(([key]) => Number(key) !== id))) }, error: (value) => { if (alive) setError(value) }, screen: (v) => { if (alive) setSharing(v) }, ended: () => { if (alive) leave() } })
      call.current = instance
      try { await instance.start(); if (alive && call.current === instance) setPending(false) }
      catch (e) { if (alive && call.current === instance) { leave(); setError(e instanceof Error ? e.message : 'Не удалось начать звонок') } }
    }
    const event = (e: Event) => { const v = (e as CustomEvent<{ type: string; data: unknown }>).detail; if (v?.type === 'conversation.call') call.current?.update(v.data as CallState); if (v?.type === 'conversation.call-signal') call.current?.signal(v.data as CallSignal) }
    const close = () => leave()
    window.addEventListener('voxhold:start-conversation-call', start); window.addEventListener('voxhold:feature-event', event); window.addEventListener('voxhold:channel-call-starting', close); window.addEventListener('pagehide', close)
    return () => { alive = false; call.current?.close(); call.current = null; window.removeEventListener('voxhold:start-conversation-call', start); window.removeEventListener('voxhold:feature-event', event); window.removeEventListener('voxhold:channel-call-starting', close); window.removeEventListener('pagehide', close) }
  }, [api, token, userId, leave])
  if (!state && !error) return null
  return <aside className="direct-call-dock" aria-label="Звонок в беседе"><b>{pending ? 'Подключаемся…' : state ? 'Звонок в беседе' : 'Ошибка звонка'}</b>{state && <><div className="direct-call-dock__members">{state.members.map((m) => <span key={m.user_id}>{m.username}{m.user_id === userId ? ' (вы)' : ''}</span>)}{state.members.length === 1 && <span>Ждём участников…</span>}</div>{Object.entries(media).map(([id, stream]) => <RemoteMedia key={id} stream={stream} name={state.members.find((m) => m.user_id === Number(id))?.username ?? 'Участник'} deaf={deaf}/>)}<div className="feature-actions"><button disabled={pending} aria-pressed={muted} onClick={() => { call.current?.mute(!muted); setMuted(!muted) }}>{muted ? 'Включить микрофон' : 'Выключить микрофон'}</button><button aria-pressed={deaf} onClick={() => setDeaf(!deaf)}>{deaf ? 'Включить звук' : 'Выключить звук'}</button><button disabled={pending} aria-pressed={sharing} onClick={() => { void call.current?.shareScreen().catch((e: unknown) => setError(e instanceof Error ? e.message : 'Не удалось показать экран')) }}>{sharing ? 'Остановить показ' : 'Показать экран'}</button><button className="button--danger" onClick={leave}>Завершить</button></div></>}{error && <p className="call-error" role="alert">{error}<button onClick={() => setError('')}>Закрыть</button></p>}</aside>
}
