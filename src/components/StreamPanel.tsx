import { useStreamQuality } from './MediaActivity'
import { useEffect } from 'react'
import type { ActiveStream } from '../domain/types'
import type { StreamPreferences } from '../services/streamSettings'
import type { StreamQualityStats } from '../services/stream'
import { useLiveDuration } from '../hooks/useLiveDuration'
import { viewerLabel } from '../lib/format'
import { useMediaPlayback } from '../hooks/useMediaPlayback'
import { pictureInPictureAvailable, togglePictureInPicture } from '../lib/pictureInPicture'
import { StreamVolumeControl } from './StreamVolumeControl'
import { Icon } from './Icon'
import { StreamQualitySummary } from './StreamQualitySummary'

interface StreamPanelProps {
  tile?: boolean
  onPlaybackRecovery?: () => void
  stream: ActiveStream | null
  currentUserId: number
  /** Display name of the publisher, resolved from the member list. */
  publisherName?: string
  voiceActive: boolean
  status: 'idle' | 'requesting' | 'signaling' | 'connected'
  error: string
  media: MediaStream | null
  preferences: StreamPreferences
  quality?: StreamQualityStats | null
  audioMuted?: boolean
  onPreferencesChange: (value: StreamPreferences) => void
  onOpenSettings: () => void
  onWatch: () => void
  onLeave: () => void
  onExpand: () => void
  /** Opens the player straight in fullscreen cinema mode. */
  onFullscreen?: () => void
  onToggleAudio?: () => void
}

export function StreamPanel({ tile = false, onPlaybackRecovery, stream, currentUserId, publisherName, voiceActive, status, error, media, preferences, quality: qualityOverride, audioMuted = false, onPreferencesChange, onOpenSettings, onWatch, onLeave, onExpand, onFullscreen, onToggleAudio }: StreamPanelProps) {
  const quality = useStreamQuality(qualityOverride)
  const pendingPublisher = !stream && !!media
  const isPublisher = pendingPublisher || stream?.publisher_user_id === currentUserId
  const duration = useLiveDuration(stream?.started_at_ms)
  const { videoRef, state: playbackState, attach, enableAudio } = useMediaPlayback({
    role: isPublisher ? 'publisher' : 'viewer',
    muted: !!isPublisher || (preferences.playbackMuted || preferences.playbackVolume === 0),
    recovering: status === 'signaling',
    onRecoveryRequired: onPlaybackRecovery,
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
    const volume = Math.max(0, Math.min(100, value))
    if (isPublisher) {
      if (volume > 0) onPreferencesChange({ ...preferences, publishVolume: volume })
      if ((volume === 0) !== audioMuted) onToggleAudio?.()
    } else {
      onPreferencesChange({ ...preferences, playbackVolume: volume || preferences.playbackVolume, playbackMuted: volume === 0 })
    }
  }
  const togglePlaybackAudio = () => onPreferencesChange({ ...preferences, playbackVolume: preferences.playbackVolume || 100, playbackMuted: !(preferences.playbackMuted || preferences.playbackVolume === 0) })
  const volumeControl = (compact = false) => <StreamVolumeControl
    compact={compact} publisher={!!isPublisher}
    volume={isPublisher ? preferences.publishVolume : preferences.playbackVolume}
    muted={isPublisher ? audioMuted : preferences.playbackMuted}
    disabled={!stream?.has_audio} onVolumeChange={updateVolume}
    onToggleMute={isPublisher ? () => onToggleAudio?.() : togglePlaybackAudio}/>

  const watching = !isPublisher && (!!media || status !== 'idle')
  const liveLabel = isPublisher
    ? audioMuted ? 'Ваш предпросмотр · звук выключен' : 'Ваш предпросмотр'
    : playbackState === 'stalled' ? 'Восстанавливаем трансляцию…' : playbackState === 'playing' ? 'В эфире' : 'Подключение…'
  const rangeLabel = quality?.dynamicRange === 'hdr10' ? 'HDR10' : quality?.dynamicRange === 'hlg' ? 'HLG' : quality?.dynamicRange === 'sdr' ? 'SDR' : ''
  const title = isPublisher
    ? 'Вы показываете экран'
    : publisherName ? `${publisherName} показывает экран` : 'Трансляция экрана'
  const subtitle = stream
    ? [viewerLabel(stream.viewer_count), duration].filter(Boolean).join(' · ')
    : 'Подключение трансляции…'

  if (tile) return <section className="call-stream-tile" aria-label={title}>
    <button className="call-stream-tile__preview" type="button" disabled={!media && (!voiceActive || watching)} onClick={media ? onExpand : onWatch} aria-label={media ? `Развернуть: ${title}` : watching ? 'Подключаем трансляцию' : `Смотреть: ${title}`}>
      {media ? <video ref={videoRef} autoPlay playsInline muted={!!isPublisher || (preferences.playbackMuted || preferences.playbackVolume === 0)}/> : <span className="call-stream-tile__placeholder"><Icon name="monitor" size={38}/><b>{watching ? 'Подключаемся…' : 'Смотреть трансляцию'}</b><small>{voiceActive ? 'Нажмите, чтобы присоединиться' : 'Подключитесь к каналу для просмотра'}</small></span>}
      <span className="call-stream-tile__live"><i/>{stream ? 'В ЭФИРЕ' : 'ЗАПУСК'}</span>
      {media && <span className="call-stream-tile__expand"><Icon name="maximize" size={22}/>Развернуть</span>}
    </button>
    {!isPublisher && playbackState === 'audio_blocked' && media && <button className="call-stream-tile__audio" onClick={enableAudio}><Icon name="volume" size={14}/>Включить звук</button>}
    <footer><div><b><Icon name="monitor" size={14}/>{isPublisher ? 'Ваш экран' : publisherName ?? 'Трансляция экрана'}</b><small>{playbackState === 'stalled' ? liveLabel : subtitle}</small></div><div className="call-stream-tile__actions">
      {stream?.has_audio && (isPublisher || watching) && volumeControl(true)}
      {media && onFullscreen && <button className="icon-button" onClick={onFullscreen} aria-label="Трансляция на полный экран"><Icon name="maximize" size={16}/></button>}
      {(isPublisher || watching) && <button className="icon-button" onClick={onLeave} aria-label={isPublisher ? 'Завершить трансляцию' : 'Перестать смотреть'}><Icon name="close" size={16}/></button>}
    </div></footer>
    {error && <p className="voice-error" role="alert">{error}</p>}
  </section>

  return <section className="stream-panel">
    <header>
      <div className="stream-panel__title">
        <span className={`stream-live ${stream ? '' : 'is-pending'}`}><i/>{stream ? 'В ЭФИРЕ' : 'ЗАПУСК'}</span>
        <h3>{title}</h3>
        <p>{subtitle}</p>
      </div>
      <div className="stream-badges"><span className="stream-mode">{stream?.codec?.toUpperCase() ?? preferences.codec.toUpperCase()}</span>{rangeLabel && <span className="stream-mode">{rangeLabel}</span>}<span className="stream-mode">{stream?.mode === 'p2p' ? 'P2P' : 'ЧЕРЕЗ СЕРВЕР'}</span></div>
    </header>

    {media && <div className="stream-video" onClick={(event) => { if (event.target === videoRef.current) onExpand() }} onDoubleClick={onFullscreen ?? onExpand}>
      <video ref={videoRef} autoPlay playsInline muted={!!isPublisher || (preferences.playbackMuted || preferences.playbackVolume === 0)} controls={false}/>
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

    {stream && !isPublisher && watching && volumeControl()}

    <div className="stream-actions">
      {isPublisher
        ? <button className="button button--danger" type="button" onClick={onLeave}>Завершить трансляцию</button>
        : watching
          ? <button className="button button--ghost" type="button" onClick={onLeave}>Перестать смотреть</button>
          : <button className="button button--primary" type="button" disabled={!voiceActive} onClick={onWatch}><Icon name="monitor"/>Смотреть трансляцию</button>}
      {isPublisher && stream?.has_audio && onToggleAudio && volumeControl()}
      {media && onFullscreen && <button className="stream-action" type="button" onClick={onFullscreen} title="Только видео, без интерфейса (F, выход — Esc)"><Icon name="maximize" size={16}/><span>Полный экран</span></button>}
      {media && <button className="stream-action" type="button" onClick={onExpand} title="Развернуть трансляцию в окне приложения"><Icon name="monitor" size={16}/><span>Развернуть</span></button>}
      {media && !isPublisher && pictureInPictureAvailable() && <button className="stream-action" type="button" onClick={() => void togglePictureInPicture(videoRef.current)} title="Смотреть поверх других окон"><Icon name="pip" size={16}/><span>Картинка в картинке</span></button>}
    </div>
  </section>
}
