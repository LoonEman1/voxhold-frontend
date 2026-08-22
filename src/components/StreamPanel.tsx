import { useEffect, useRef } from 'react'
import type { ActiveStream } from '../domain/types'
import type { StreamPreferences } from '../services/streamSettings'
import type { StreamQualityStats } from '../services/stream'
import { Icon } from './Icon'
import { StreamQualitySummary } from './StreamQualitySummary'
import { clientDiagnostics } from '../platform/clientDiagnostics'

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
  const videoRef = useRef<HTMLVideoElement>(null)
  const pendingPublisher = !stream && !!media
  const isPublisher = pendingPublisher || stream?.publisher_user_id === currentUserId

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    video.srcObject = media
    if (media) {
      void video.play().then(() => {
        clientDiagnostics.record('media', 'stream_playback_started', 'info', {
          player: 'channel',
          role: isPublisher ? 'publisher' : 'viewer',
          audio_track_count: media.getAudioTracks?.().length ?? 0,
          video_track_count: media.getVideoTracks?.().length ?? 0,
        })
      }).catch((error: unknown) => {
        clientDiagnostics.record('media', 'stream_playback_blocked', 'warn', {
          player: 'channel',
          role: isPublisher ? 'publisher' : 'viewer',
          error_name: error instanceof Error ? error.name : typeof error,
        })
      })
    }
    return () => {
      if (video.srcObject === media) video.srcObject = null
    }
  }, [isPublisher, media])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    video.volume = isPublisher ? 0 : preferences.playbackVolume / 100
    video.muted = !!isPublisher || preferences.playbackVolume === 0
    if (!video.muted && video.srcObject) {
      void video.play().catch((error: unknown) => {
        clientDiagnostics.record('media', 'stream_unmute_blocked', 'warn', {
          player: 'channel',
          error_name: error instanceof Error ? error.name : typeof error,
        })
      })
    }
  }, [isPublisher, preferences.playbackVolume, media])

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

  return <section className="stream-panel">
    <header>
      <div><span className="eyebrow">ТРАНСЛЯЦИЯ ЭКРАНА</span><h3>{stream ? `В эфире · ${stream.viewer_count} зр.` : 'Подключение трансляции…'}</h3></div>
      <div className="stream-badges"><span className="stream-mode">{stream?.codec?.toUpperCase() ?? preferences.codec.toUpperCase()}</span><span className="stream-mode">{stream?.mode === 'p2p' ? 'P2P' : 'ЧЕРЕЗ СЕРВЕР'}</span>{media && <button className="stream-expand-button" type="button" onClick={onExpand} title="Открыть трансляцию на весь экран"><Icon name="maximize" size={16}/><span>На весь экран</span></button>}</div>
    </header>

    {media && <div className="stream-video"><video ref={videoRef} autoPlay playsInline muted={!!isPublisher || preferences.playbackVolume === 0} controls={false}/><span>{isPublisher ? 'Ваш предпросмотр' : status === 'connected' ? 'Прямой эфир' : 'Подключение…'}</span></div>}
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
