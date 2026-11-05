import '../styles/conversation-call.css'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { VoxholdApi } from '../services/api'
import type { CallState, CallSignal } from '../domain/community'
import type { ConversationCall } from '../services/conversationCall'
import { loadVoicePreferences, normalizeVoicePreferences, VOICE_PREFERENCES_EVENT, type VoicePreferences } from '../services/voiceSettings'
import { AudioPlaybackMixer } from '../services/audioPlaybackMixer'
import { E2EE_CAMERA_NOTICE, E2EE_VOICE_NOTICE } from '../services/e2ee/notices'
import { Icon } from './Icon'
import { Avatar } from './Avatar'
import { useFloatingWindow } from '../hooks/useFloatingWindow'
import { CameraTile } from './CameraTile'
import { CameraSettingsDialog } from './CameraSettingsDialog'
import { loadCameraQuality } from '../services/camera'

function RemoteMedia({ stream, name, deaf, preferences, mixer, encrypted = false }: { stream: MediaStream; name: string; deaf: boolean; preferences: VoicePreferences; mixer: AudioPlaybackMixer; encrypted?: boolean }) {
  const audio = useRef<HTMLAudioElement>(null), video = useRef<HTMLVideoElement>(null), [blocked, setBlocked] = useState(false)
  const hasVideo = stream.getVideoTracks().some((t) => t.readyState === 'live')
  useEffect(() => { const element = audio.current; if (!element) return; element.srcObject = stream; void element.play().then(() => setBlocked(false)).catch(() => setBlocked(true)); return () => { mixer.remove(element); element.pause(); element.srcObject = null } }, [stream, mixer])
  useEffect(() => { const element = audio.current; if (!element) return; mixer.setVolume(element, stream, preferences.outputVolume / 100); if ('setSinkId' in element) void element.setSinkId(preferences.outputDeviceId).catch(() => undefined) }, [stream, mixer, preferences.outputVolume, preferences.outputDeviceId])
  useEffect(() => { const element = video.current; if (!element) return; element.srcObject = stream; void element.play().catch(() => undefined); return () => { element.srcObject = null } }, [stream, hasVideo])
  return <div><audio ref={audio} autoPlay muted={deaf}/>{hasVideo && <><span>{name} · Демонстрация экрана{encrypted ? ' (видео не шифруется сквозным шифрованием)' : ''}</span><video ref={video} autoPlay playsInline muted controls/></>}{blocked && <button onClick={() => { mixer.resume(); void audio.current?.play().then(() => setBlocked(false)).catch(() => setBlocked(true)) }}>Включить звук {name}</button>}</div>
}
function LocalScreenPreview({ stream }: { stream: MediaStream }) {
  const video = useRef<HTMLVideoElement>(null)
  useEffect(() => { const element = video.current; if (!element) return; element.srcObject = stream; void element.play().catch(() => undefined); return () => { element.srcObject = null } }, [stream])
  return <div className="direct-call-dock__screen"><span>Ваш экран</span><video ref={video} autoPlay playsInline muted aria-label="Предпросмотр вашего экрана"/></div>
}
export function ConversationCallDock({ api, token, userId }: { api: VoxholdApi; token: string; userId: number }) {
  const [voicePreferences, setVoicePreferences] = useState(loadVoicePreferences)
  const [playbackBlocked, setPlaybackBlocked] = useState(false)
  const [playback] = useState(() => new AudioPlaybackMixer(() => setPlaybackBlocked(true)))
  useEffect(() => {
    const changed = (event: Event) => setVoicePreferences(normalizeVoicePreferences((event as CustomEvent<VoicePreferences>).detail))
    window.addEventListener(VOICE_PREFERENCES_EVENT, changed)
    return () => { window.removeEventListener(VOICE_PREFERENCES_EVENT, changed); playback.close() }
  }, [playback])
  const bodyId = useId()
  const [localCamera, setLocalCamera] = useState<MediaStream | null>(null)
  const [cameras, setCameras] = useState<Record<number, MediaStream>>({})
  const [cameraSettings, setCameraSettings] = useState(false)
  const [cameraQuality, setCameraQuality] = useState(loadCameraQuality)
  const [collapsed, setCollapsed] = useState(false)
  const [localScreen, setLocalScreen] = useState<MediaStream | null>(null)
  const call = useRef<ConversationCall | null>(null), [state, setState] = useState<CallState | null>(null), [media, setMedia] = useState<Record<number, MediaStream>>({}), [error, setError] = useState(''), [pending, setPending] = useState(false), [muted, setMuted] = useState(false), [deaf, setDeaf] = useState(false), [sharing, setSharing] = useState(false), [changedKeys, setChangedKeys] = useState<number[]>([]), [encryptedCall, setEncryptedCall] = useState(false)
  const floating = useFloatingWindow({ storageKey: 'voxhold.window.direct-call.v1', width: 440, height: 360, enabled: !!state || !!error, collapsed })
  const startGeneration = useRef(0), opening = useRef(false)
  const tokenRef = useRef(token)
  useEffect(() => { tokenRef.current = token }, [token])
  const leave = useCallback(() => { setPlaybackBlocked(false); startGeneration.current++; opening.current = false; call.current?.close(); call.current = null; setState(null); setMedia({}); setPending(false); setSharing(false); setLocalScreen(null); setMuted(false); setDeaf(false); setChangedKeys([]); setEncryptedCall(false); setLocalCamera(null); setCameras({}); setCameraSettings(false) }, [])
  useEffect(() => {
    let alive = true
    const start = async (event: Event) => {
      const cid = (event as CustomEvent<number>).detail; if (!Number.isSafeInteger(cid) || cid <= 0) return; if(call.current || opening.current){setError('Сначала завершите текущий звонок');return}
      opening.current = true
      const generation = ++startGeneration.current
      window.dispatchEvent(new Event('voxhold:direct-call-starting'))
      setError(''); setPending(true); setCollapsed(false); setState({ conversation_id: cid, revision:0, members: [] })
      let runtime: typeof import('../services/conversationCall')
      try { runtime = await import('../services/conversationCall') }
      catch (caught) { if (alive && startGeneration.current === generation) { leave(); setError(caught instanceof Error ? caught.message : 'Не удалось загрузить звонок') }; return }
      if (!alive || startGeneration.current !== generation) return
      const instance = new runtime.ConversationCall(api, () => tokenRef.current, cid, userId, { camera: (stream) => { if (alive) setLocalCamera(stream) }, remoteCamera: (id, stream) => { if (alive) setCameras((current) => { const next = { ...current }; if (stream) next[id] = new MediaStream(stream.getTracks()); else delete next[id]; return next }) }, state: (v, encrypted) => { if (alive) { setState(v); setEncryptedCall(encrypted) } }, media: (id, stream) => { if (alive) setMedia((v) => ({ ...v, [id]: new MediaStream(stream.getTracks()) })) }, removed: (id) => { if (alive) setMedia((v) => Object.fromEntries(Object.entries(v).filter(([key]) => Number(key) !== id))) }, error: (value) => { if (alive) setError(value) }, screen: (v, stream) => { if (alive) { setSharing(v); setLocalScreen(v ? stream ?? null : null) } }, ended: () => { if (alive) leave() }, keyChanged: (id) => { if (alive) setChangedKeys((v) => v.includes(id) ? v : [...v, id]) } })
      call.current = instance; opening.current = false
      try { await instance.start(); if (alive && call.current === instance) setPending(false) }
      catch (e) { if (alive && call.current === instance) { leave(); setError(e instanceof Error ? e.message : 'Не удалось начать звонок') } }
    }
    const event = (e: Event) => { const v = (e as CustomEvent<{ type: string; data: unknown }>).detail; if (v?.type === 'conversation.call') call.current?.update(v.data as CallState); if (v?.type === 'conversation.call-signal') call.current?.signal(v.data as CallSignal) }
    const close = () => leave()
    window.addEventListener('voxhold:start-conversation-call', start); window.addEventListener('voxhold:feature-event', event); window.addEventListener('voxhold:channel-call-starting', close); window.addEventListener('pagehide', close)
    return () => { alive = false; leave(); window.removeEventListener('voxhold:start-conversation-call', start); window.removeEventListener('voxhold:feature-event', event); window.removeEventListener('voxhold:channel-call-starting', close); window.removeEventListener('pagehide', close) }
  }, [api, userId, leave])
  if (!state && !error) return null
  const encrypted = encryptedCall && !!state && state.members.length > 1
  return <aside ref={floating.ref} style={{ ...floating.style, height: state ? floating.style.height : undefined }} className={`direct-call-dock floating-window ${collapsed ? 'is-collapsed' : ''}`} aria-label="Звонок в беседе">
    <header className="direct-call-dock__header"><button type="button" className="floating-window__move" aria-label="Переместить окно звонка" aria-describedby={`${bodyId}-move-help`} title="Переместить окно · стрелки или перетаскивание" onPointerDown={floating.beginMove} onKeyDown={floating.moveKey}><Icon name="grip" size={17}/></button><span className={`direct-call-dock__symbol ${pending ? 'is-pending' : ''}`}>{pending ? <span className="spinner"/> : <Icon name="phone" size={19}/>}</span><div><b>{pending ? 'Подключаемся…' : state ? 'Звонок в беседе' : 'Ошибка звонка'}</b>{state && <small>{pending ? 'Устанавливаем соединение' : `Участников: ${state.members.length}`}</small>}</div>{state && <button type="button" className="icon-button" aria-label={collapsed ? 'Развернуть звонок' : 'Свернуть звонок'} title={collapsed ? 'Развернуть звонок' : 'Свернуть звонок'} aria-expanded={!collapsed} aria-controls={bodyId} onClick={() => setCollapsed((value) => !value)}><Icon name={collapsed ? 'maximize' : 'minimize'} size={17}/></button>}</header>
    {state && <>
      <div id={bodyId} className="direct-call-dock__body" hidden={collapsed}>
        <div className="direct-call-dock__members">{state.members.map((member) => { const camera = member.user_id === userId ? localCamera : cameras[member.user_id]; return camera ? <CameraTile key={member.user_id} media={camera} name={member.username} isMe={member.user_id === userId}/> : <span key={member.user_id}><Avatar name={member.username} userId={member.user_id} size="small"/><span>{member.username}{member.user_id === userId && <small>Вы</small>}</span></span> })}{state.members.length === 1 && <span className="direct-call-dock__waiting">Ждём участников…</span>}</div>
        {encrypted && <p className="direct-call-dock__e2ee" title={E2EE_VOICE_NOTICE}><Icon name="lock" size={14}/>{E2EE_VOICE_NOTICE}</p>}
        {localScreen && <LocalScreenPreview stream={localScreen}/>}
        {Object.entries(media).map(([id, stream]) => <RemoteMedia key={id} mixer={playback} preferences={voicePreferences} stream={stream} name={state.members.find((member) => member.user_id === Number(id))?.username ?? 'Участник'} deaf={deaf} encrypted={encrypted}/>)}
      </div>
      {(localCamera || Object.keys(cameras).length > 0) && encrypted && <p className="direct-call-dock__e2ee">{E2EE_CAMERA_NOTICE}</p>}
      {cameraSettings && <CameraSettingsDialog onCancel={() => { if (!localCamera) call.current?.stopCamera() }} quality={cameraQuality} active={!!localCamera} onClose={() => setCameraSettings(false)} onApply={async (quality) => {
        const current = call.current
        if (!current) throw new Error('Звонок завершён')
        if (localCamera) await current.setCameraQuality(quality); else await current.startCamera(quality)
        setCameraQuality(quality)
      }}/>}
      {localCamera && <button className="button button--ghost camera-quality-button" onClick={() => setCameraSettings(true)}>Качество камеры</button>}
      {changedKeys.map((id) => <p key={id} className="voice-e2ee-warning" role="alert">Ключ устройства {state.members.find((member) => member.user_id === id)?.username ?? 'участника'} изменился. Сверьте код безопасности в профиле</p>)}
      <div className="direct-call-dock__controls" role="group" aria-label="Управление личным звонком">
        <button type="button" disabled={pending} className={muted ? 'is-muted' : ''} aria-label={muted ? 'Включить микрофон' : 'Выключить микрофон'} title={muted ? 'Включить микрофон' : 'Выключить микрофон'} aria-pressed={muted} onClick={() => { call.current?.mute(!muted); setMuted(!muted) }}><Icon name={muted ? 'micOff' : 'mic'} size={20}/></button>
        <button type="button" className={deaf ? 'is-muted' : ''} aria-label={deaf ? 'Включить звук' : 'Выключить звук'} title={deaf ? 'Включить звук' : 'Выключить звук'} aria-pressed={deaf} onClick={() => setDeaf(!deaf)}><Icon name={deaf ? 'headphonesOff' : 'headphones'} size={20}/></button>
        <button type="button" disabled={pending} className={localCamera ? 'is-sharing' : ''} aria-label={localCamera ? 'Выключить камеру' : 'Включить камеру'} title={localCamera ? 'Выключить камеру' : 'Включить камеру'} aria-pressed={!!localCamera} onClick={() => { if (localCamera) call.current?.stopCamera(); else setCameraSettings(true) }}><Icon name="camera" size={20}/></button>
        <button type="button" disabled={pending} className={sharing ? 'is-sharing' : ''} aria-label={sharing ? 'Остановить показ' : 'Показать экран'} title={sharing ? 'Остановить показ' : 'Показать экран'} aria-pressed={sharing} onClick={() => { void call.current?.shareScreen().catch((caught: unknown) => setError(caught instanceof Error ? caught.message : 'Не удалось показать экран')) }}><Icon name="monitor" size={20}/></button>
        <button type="button" className="direct-call-dock__leave" aria-label="Завершить" title="Завершить звонок" onClick={leave}><Icon name="phoneOff" size={20}/></button>
      </div>
    </>}
    {playbackBlocked && state && <button className="button button--ghost" onClick={() => { playback.resume(); setPlaybackBlocked(false) }}>Включить звук звонка</button>}{error && <p className="call-error" role="alert">{error}<button type="button" onClick={() => setError('')}>Закрыть</button></p>}
    <span className="sr-only" id={`${bodyId}-move-help`}>Перемещайте окно стрелками, с Shift — быстрее. Home сбрасывает положение и размер.</span>
    {state && !collapsed && <button type="button" className="floating-window__resize" aria-label="Изменить размер окна звонка" title="Изменить размер · стрелки или перетаскивание" onPointerDown={floating.beginResize} onKeyDown={floating.resizeKey}><Icon name="more" size={17}/></button>}
  </aside>
}
