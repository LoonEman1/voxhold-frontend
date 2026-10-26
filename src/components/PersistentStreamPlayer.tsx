import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { ActiveStream } from '../domain/types'
import type { StreamPreferences } from '../services/streamSettings'
import type { StreamQualityStats } from '../services/stream'
import { useLiveDuration } from '../hooks/useLiveDuration'
import { useMediaPlayback } from '../hooks/useMediaPlayback'
import { pictureInPictureAvailable, togglePictureInPicture } from '../lib/pictureInPicture'
import { Icon } from './Icon'
import { StreamQualitySummary } from './StreamQualitySummary'

interface PersistentStreamPlayerProps {
  callControls?: ReactNode
  mode: 'mini' | 'expanded'
  stream: ActiveStream | null
  role: 'publisher' | 'viewer'
  status: 'idle' | 'requesting' | 'signaling' | 'connected'
  media: MediaStream
  channelName: string
  preferences: StreamPreferences
  quality?: StreamQualityStats | null
  onPreferencesChange: (value: StreamPreferences) => void
  onExpand: () => void
  onCollapse: () => void
  onLeave: () => void
  /** Expanded only: enter the fullscreen cinema mode right after mounting. */
  startInCinema?: boolean
}

/** Cinema controls fade out after this long without input. */
export const CINEMA_IDLE_MS = 2_500

export function PersistentStreamPlayer({ mode, stream, role, status, media, channelName, preferences, quality, onPreferencesChange, onExpand, onCollapse, onLeave, startInCinema = false, callControls }: PersistentStreamPlayerProps) {
  const playerRef = useRef<HTMLElement>(null)
  const [uiHidden, setUIHidden] = useState(false)
  const [idle, setIdle] = useState(false)
  const controlsHoveredRef = useRef(false)
  const isPublisher = role === 'publisher'
  const duration = useLiveDuration(stream?.started_at_ms)
  const canPictureInPicture = !isPublisher && pictureInPictureAvailable()
  const wantMuted = isPublisher || preferences.playbackVolume === 0
  const { videoRef, state: playbackState, muted, attach, enableAudio } = useMediaPlayback({
    role,
    muted: wantMuted,
    context: { channel_id: stream?.channel_id ?? null },
  })

  useEffect(() => {
    attach(media)
    return () => attach(null)
  }, [media, attach])

  // Volume follows preferences without fighting the playback hook.
  useEffect(() => {
    const video = videoRef.current
    if (video) video.volume = isPublisher ? 0 : preferences.playbackVolume / 100
  }, [isPublisher, preferences.playbackVolume, videoRef])

  const enterCinemaMode = useCallback(async () => {
    setUIHidden(true)
    const player = playerRef.current
    if (!player?.requestFullscreen || document.fullscreenElement) return
    try {
      await player.requestFullscreen()
    } catch {
      // CSS fullscreen remains available when the browser denies the native API.
    }
  }, [])

  const restoreUI = useCallback(async () => {
    setUIHidden(false)
    if (document.fullscreenElement !== playerRef.current || !document.exitFullscreen) return
    try {
      await document.exitFullscreen()
    } catch {
      // The browser may already be leaving fullscreen after Escape.
    }
  }, [])

  // "Полный экран" in the room panel mounts the player and goes fullscreen in
  // the same click, while the browser still honours the user gesture.
  const startInCinemaRef = useRef(startInCinema)
  useEffect(() => {
    if (mode === 'expanded' && startInCinemaRef.current) void enterCinemaMode()
  }, [mode, enterCinemaMode])

  useEffect(() => {
    if (mode !== 'expanded') return
    const handleKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const typing = !!target && (target.isContentEditable || target.tagName === 'TEXTAREA'
        || (target.tagName === 'INPUT' && (target as HTMLInputElement).type !== 'range'))
      if (event.code === 'KeyF' && !typing && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault()
        if (uiHidden) void restoreUI()
        else void enterCinemaMode()
        return
      }
      if (event.key !== 'Escape') return
      if (uiHidden) setUIHidden(false)
      else onCollapse()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [mode, onCollapse, uiHidden, enterCinemaMode, restoreUI])

  useEffect(() => {
    if (mode === 'mini') setUIHidden(false)
  }, [mode])

  useEffect(() => {
    if (mode !== 'expanded') return
    const syncFullscreenState = () => {
      if (uiHidden && document.fullscreenElement !== playerRef.current) setUIHidden(false)
    }
    document.addEventListener('fullscreenchange', syncFullscreenState)
    return () => document.removeEventListener('fullscreenchange', syncFullscreenState)
  }, [mode, uiHidden])

  // Cinema mode shows nothing but the picture: the controls come back on any
  // input and fade out again after a short pause. The cursor stays visible.
  useEffect(() => {
    const player = playerRef.current
    if (!uiHidden || !player) {
      setIdle(false)
      return
    }
    let timer = 0
    const wake = () => {
      setIdle(false)
      window.clearTimeout(timer)
      timer = window.setTimeout(function hideWhenUntouched() {
        if (controlsHoveredRef.current) timer = window.setTimeout(hideWhenUntouched, CINEMA_IDLE_MS)
        else setIdle(true)
      }, CINEMA_IDLE_MS)
    }
    wake()
    const events = ['pointermove', 'pointerdown', 'wheel', 'touchstart', 'keydown'] as const
    events.forEach((name) => player.addEventListener(name, wake, { passive: true }))
    return () => {
      window.clearTimeout(timer)
      events.forEach((name) => player.removeEventListener(name, wake))
    }
  }, [uiHidden])

  const updateVolume = (value: number) => {
    onPreferencesChange({ ...preferences, playbackVolume: Math.max(0, Math.min(100, value)) })
  }
  const liveLabel = isPublisher
    ? 'Ваш предпросмотр'
    : playbackState === 'playing'
      ? 'Прямой эфир'
      : status === 'connected' ? 'Ожидание первого кадра…' : 'Подключение…'
  const leaveLabel = isPublisher ? 'Завершить трансляцию' : 'Перестать смотреть'
  const audioBlockedOverlay = !isPublisher && playbackState === 'audio_blocked'
  const rangeLabel = quality?.dynamicRange === 'hdr10' ? 'HDR10' : quality?.dynamicRange === 'hlg' ? 'HLG' : quality?.dynamicRange === 'sdr' ? 'SDR' : ''

  if (mode === 'mini') {
    return <aside className="stream-mini-player" aria-label={`Трансляция в канале ${channelName}`}>
      <button className="stream-mini-player__preview" type="button" onClick={onExpand} title="Открыть трансляцию на весь экран">
        <video ref={videoRef} autoPlay playsInline muted={muted}/>
        {audioBlockedOverlay
          ? <span className="stream-mini-player__live"><i/>Без звука</span>
          : <span className="stream-mini-player__live"><i/>{liveLabel}</span>}
        <span className="stream-mini-player__channel"><Icon name="volume" size={13}/>{channelName}</span>
      </button>
      <div className="stream-mini-player__actions">
        {canPictureInPicture && <button type="button" onClick={() => void togglePictureInPicture(videoRef.current)} title="Картинка в картинке" aria-label="Смотреть поверх других окон"><Icon name="pip" size={17}/></button>}
        <button type="button" onClick={onExpand} title="На весь экран" aria-label="Открыть трансляцию на весь экран"><Icon name="maximize" size={17}/></button>
        <button className="is-danger" type="button" onClick={onLeave} title={leaveLabel} aria-label={leaveLabel}><Icon name="logout" size={17}/></button>
      </div>
    </aside>
  }

  return <section ref={playerRef} className={`stream-expanded-player ${uiHidden ? 'is-ui-hidden' : ''} ${uiHidden && idle ? 'is-idle' : ''}`} role="dialog" aria-modal="true" aria-label={`Трансляция в канале ${channelName}`}>
    <header>
      <div><span className="eyebrow">ТРАНСЛЯЦИЯ ЭКРАНА{duration && ` · ${duration}`}</span><h2>{channelName}</h2></div>
      <div className="stream-expanded-player__meta">
        {stream && <><span className="stream-mode">{stream.codec.toUpperCase()}</span>{rangeLabel && <span className="stream-mode">{rangeLabel}</span>}<span className="stream-mode">{stream.mode === 'p2p' ? 'P2P' : 'ЧЕРЕЗ СЕРВЕР'}</span></>}
        {canPictureInPicture && <button type="button" onClick={() => void togglePictureInPicture(videoRef.current)} title="Смотреть поверх других окон"><Icon name="pip"/><span>Картинка в картинке</span></button>}
        <button type="button" onClick={() => void enterCinemaMode()} title="Открыть настоящий полноэкранный режим без интерфейса"><Icon name="maximize"/><span>Полный экран</span></button>
        <button type="button" onClick={onCollapse} title="Свернуть трансляцию"><Icon name="minimize"/><span>Свернуть</span></button>
      </div>
    </header>
    <div className="stream-expanded-player__video" onDoubleClick={() => { if (uiHidden) void restoreUI(); else void enterCinemaMode() }}>
      <video ref={videoRef} autoPlay playsInline muted={muted}/>
      {audioBlockedOverlay && (
        <div className="stream-audio-blocked-overlay">
          <span>Трансляция идёт без звука: браузер заблокировал автовоспроизведение</span>
          <button className="button button--primary" type="button" onClick={enableAudio}><Icon name="volume"/>Включить звук</button>
        </div>
      )}
      {!audioBlockedOverlay && playbackState === 'stalled' && (
        <div className="stream-audio-blocked-overlay"><span>Восстанавливаем соединение…</span></div>
      )}
      {!audioBlockedOverlay && playbackState !== 'stalled' && <span><i/>{liveLabel}</span>}
      {uiHidden && <div
        className="stream-cinema-controls"
        onDoubleClick={(event) => event.stopPropagation()}
        onPointerEnter={() => { controlsHoveredRef.current = true }}
        onPointerLeave={() => { controlsHoveredRef.current = false }}
      >
        {!isPublisher && stream?.has_audio ? <label className="stream-cinema-controls__volume">
          <Icon name={preferences.playbackVolume === 0 ? 'volumeOff' : 'volume'} size={17}/>
          <input type="range" min="0" max="100" step="1" value={preferences.playbackVolume} aria-label="Громкость трансляции" onChange={(event) => updateVolume(Number(event.target.value))}/>
        </label> : <span/>}
        <button type="button" onClick={() => void restoreUI()} title="Выйти из полноэкранного режима (Esc или F)"><Icon name="minimize" size={16}/><span>Выйти из полного экрана</span></button>
        {callControls}
      </div>}
    </div>
    <footer>
      {callControls}
      <StreamQualitySummary stats={quality}/>
      {!isPublisher && <label className={`stream-volume ${stream?.has_audio ? '' : 'is-disabled'}`}>
        <Icon name="volume"/>
        <span>Громкость трансляции</span>
        <input type="range" min="0" max="100" step="1" value={preferences.playbackVolume} disabled={!stream?.has_audio} onChange={(event) => updateVolume(Number(event.target.value))}/>
        <output>{stream?.has_audio ? `${preferences.playbackVolume}%` : 'Без звука'}</output>
      </label>}
      <div>
        <button className="button button--ghost" type="button" onClick={onCollapse}><Icon name="minimize"/>Свернуть</button>
        <button className="button button--danger" type="button" onClick={onLeave}>{leaveLabel}</button>
      </div>
    </footer>
  </section>
}
