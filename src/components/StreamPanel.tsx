import { useEffect } from 'react'
import type { ActiveStream } from '../domain/types'
import type { StreamPreferences } from '../services/streamSettings'
import type { StreamQualityStats } from '../services/stream'
import { useMediaPlayback } from '../hooks/useMediaPlayback'
import { Icon } from './Icon'
import { StreamQualitySummary } from './StreamQualitySummary'

interface StreamPanelProps {
  stream: ActiveStream | null
  currentUserId: number
  voiceActive: boolean
  status: 'idle' | 'requesting' | 'signaling' | 'connected'
  error: string
  media: MediaStream | null
  preferences: StreamPreferences
  quality?: StreamQualityStats | null
  onPreferencesChange: (value: StreamPreferences) => void
  onOpenSettings: () => void
  onWatch: () => void
  onLeave: () => void
  onExpand: () => void
}

export function StreamPanel({ stream, currentUserId, voiceActive, status, error, media, preferences, quality, onPreferencesChange, onOpenSettings, onWatch, onLeave, onExpand }: StreamPanelProps) {
  const pendingPublisher = !stream && !!media
  const isPublisher = pendingPublisher || stream?.publisher_user_id === currentUserId
  const { videoRef, state: playbackState, attach, enableAudio } = useMediaPlayback({
    role: isPublisher ? 'publisher' : 'viewer',
    muted: !!isPublisher || preferences.playbackVolume === 0,
    context: { player: 'channel' },
  })

  useEffect(() => {
    attach(media)
    return () => attach(null)
  }, [media, attach])

  useEffect(() => {
    const video = videoRef.current
    if (video) video.volume = isPublisher ? 0 : preferences.playbackVolume / 100
  }, [isPublisher, preferences.playbackVolume, videoRef])

  if (!stream && !pendingPublisher) {
    if (!error) return null
    return <section className="stream-panel stream-panel--compact">
      <div className="voice-error" role="alert">{error}</div>
      {voiceActive && <button className="button button--ghost" type="button" onClick={onOpenSettings}><Icon name="monitor"/>Настроить трансляцию</button>}
    </section>
  }

  const updateVolume = (value: number) => {
    onPreferencesChange({ ...preferences, playbackVolume: Math.max(0, Math.min(100, value)) })
  }
  const liveLabel = isPublisher ? 'Ваш предпросмотр' : playbackState === 'playing' ? 'В эфире' : 'Подключение…'

  return <section className="stream-panel">
    <header>
      <div><span className="eyebrow">ТРАНСЛЯЦИЯ ЭКРАНА</span><h3>{stream ? `В эфире · ${stream.viewer_count} зр.` : 'Подключение трансляции…'}</h3></div>
      <div className="stream-badges"><span className="stream-mode">{stream?.codec?.toUpperCase() ?? preferences.codec.toUpperCase()}</span><span className="stream-mode">{stream?.mode === 'p2p' ? 'P2P' : 'ЧЕРЕЗ СЕРВЕР'}</span>{media && <button className="stream-expand-button" type="button" onClick={onExpand} title="Открыть трансляцию на весь экран"><Icon name="maximize" size={16}/><span>На весь экран</span></button>}</div>
    </header>

    {media && <div className="stream-video">
      <video ref={videoRef} autoPlay playsInline muted={!!isPublisher || preferences.playbackVolume === 0} controls={false}/>
      <span>{liveLabel}</span>
      {!isPublisher && playbackState === 'audio_blocked' && (
        <div className="stream-audio-blocked-overlay">
          <span>Трансляция идёт без звука</span>
          <button className="button button--primary" type="button" onClick={enableAudio}><Icon name="volume"/>Включить звук</button>
        </div>
      )}
    </div>}
    <StreamQualitySummary stats={quality}/>
    {error && <div className="voice-error" role="alert">{error}</div>}

    {stream && !isPublisher && <label className={`stream-volume ${stream.has_audio ? '' : 'is-disabled'}`}>
      <Icon name="volume"/>
      <span>Громкость трансляции</span>
      <input type="range" min="0" max="100" step="1" value={preferences.playbackVolume} disabled={!stream.has_audio} onChange={(event) => updateVolume(Number(event.target.value))}/>
      <output>{stream.has_audio ? `${preferences.playbackVolume}%` : 'Без звука'}</output>
    </label>}

    {isPublisher ? <button className="button button--danger" onClick={onLeave}>Завершить трансляцию</button> : media || status !== 'idle' ? <button className="button button--ghost" onClick={onLeave}>Перестать смотреть</button> : <button className="button button--primary" disabled={!voiceActive} onClick={onWatch}><Icon name="monitor"/>Смотреть трансляцию</button>}
  </section>
}
