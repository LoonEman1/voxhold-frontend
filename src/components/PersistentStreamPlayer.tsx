import { useEffect, useRef, useState } from 'react'
import type { ActiveStream } from '../domain/types'
import type { StreamPreferences } from '../services/streamSettings'
import type { StreamQualityStats } from '../services/stream'
import { useMediaPlayback } from '../hooks/useMediaPlayback'
import { Icon } from './Icon'
import { StreamQualitySummary } from './StreamQualitySummary'

interface PersistentStreamPlayerProps {
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
}

export function PersistentStreamPlayer({ mode, stream, role, status, media, channelName, preferences, quality, onPreferencesChange, onExpand, onCollapse, onLeave }: PersistentStreamPlayerProps) {
  const playerRef = useRef<HTMLElement>(null)
  const [uiHidden, setUIHidden] = useState(false)
  const isPublisher = role === 'publisher'
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

  useEffect(() => {
    if (mode !== 'expanded') return
    const collapseOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (uiHidden) setUIHidden(false)
      else onCollapse()
    }
    window.addEventListener('keydown', collapseOnEscape)
    return () => window.removeEventListener('keydown', collapseOnEscape)
  }, [mode, onCollapse, uiHidden])

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

  const enterCinemaMode = async () => {
    setUIHidden(true)
    const player = playerRef.current
    if (!player?.requestFullscreen || document.fullscreenElement) return
    try {
      await player.requestFullscreen()
    } catch {
      // CSS fullscreen remains available when the browser denies the native API.
    }
  }

  const restoreUI = async () => {
    setUIHidden(false)
    if (document.fullscreenElement !== playerRef.current || !document.exitFullscreen) return
    try {
      await document.exitFullscreen()
    } catch {
      // The browser may already be leaving fullscreen after Escape.
    }
  }

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
        <button type="button" onClick={onExpand} title="На весь экран" aria-label="Открыть трансляцию на весь экран"><Icon name="maximize" size={17}/></button>
        <button className="is-danger" type="button" onClick={onLeave} title={leaveLabel} aria-label={leaveLabel}><Icon name="logout" size={17}/></button>
      </div>
    </aside>
  }

  return <section ref={playerRef} className={`stream-expanded-player ${uiHidden ? 'is-ui-hidden' : ''}`} role="dialog" aria-modal="true" aria-label={`Трансляция в канале ${channelName}`}>
    <header>
      <div><span className="eyebrow">ТРАНСЛЯЦИЯ ЭКРАНА</span><h2>{channelName}</h2></div>
      <div className="stream-expanded-player__meta">
        {stream && <><span className="stream-mode">{stream.codec.toUpperCase()}</span><span className="stream-mode">{stream.mode === 'p2p' ? 'P2P' : 'ЧЕРЕЗ СЕРВЕР'}</span></>}
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
      {uiHidden && <button className="stream-expanded-player__restore-ui" type="button" onClick={() => void restoreUI()} onDoubleClick={(event) => event.stopPropagation()} title="Показать интерфейс"><Icon name="minimize"/><span>Показать интерфейс</span></button>}
    </div>
    <footer>
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
