import { useStreamQuality } from './MediaActivity'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { ActiveStream } from '../domain/types'
import type { StreamPreferences } from '../services/streamSettings'
import type { StreamQualityStats } from '../services/stream'
import { useLiveDuration } from '../hooks/useLiveDuration'
import { useMediaPlayback } from '../hooks/useMediaPlayback'
import { pictureInPictureAvailable, togglePictureInPicture } from '../lib/pictureInPicture'
import { StreamVolumeControl } from './StreamVolumeControl'
import { Icon } from './Icon'
import { useFloatingWindow } from '../hooks/useFloatingWindow'
import { useStreamPlaybackGain } from '../hooks/useStreamPlaybackGain'
import { MAX_STREAM_VOLUME } from '../services/streamSettings'
import '../styles/stream-preview.css'

interface PersistentStreamPlayerProps {
  onPlaybackRecovery?: () => void
  callControls?: ReactNode
  mode: 'mini' | 'expanded'
  stream: ActiveStream | null
  role: 'publisher' | 'viewer'
  audioMuted?: boolean
  onToggleAudio?: () => void
  status: 'idle' | 'requesting' | 'signaling' | 'connected'
  media: MediaStream | null
  channelName: string
  publisherName?: string
  preferences: StreamPreferences
  quality?: StreamQualityStats | null
  onPreferencesChange: (value: StreamPreferences) => void
  onExpand: () => void
  onCollapse: () => void
  onLeave: () => void
  onOpenSettings?: () => void
  /** Expanded only: enter the fullscreen cinema mode right after mounting. */
  startInCinema?: boolean
}

/** Cinema controls fade out after this long without input. */
export const CINEMA_IDLE_MS = 2_500

export function PersistentStreamPlayer({ onPlaybackRecovery, mode, stream, role, status, media, channelName, publisherName, preferences, quality: qualityOverride, onPreferencesChange, onExpand, onCollapse, onLeave, onOpenSettings, startInCinema = false, callControls, audioMuted = false, onToggleAudio }: PersistentStreamPlayerProps) {
  const quality = useStreamQuality(qualityOverride)
  const playerRef = useRef<HTMLElement>(null)
  useEffect(() => {
    if (mode !== 'expanded') return
    const previous = document.activeElement as HTMLElement | null
    playerRef.current?.focus({ preventScroll: true })
    return () => { if (previous?.isConnected) previous.focus({ preventScroll: true }) }
  }, [mode])
  const [uiHidden, setUIHidden] = useState(false)
  const cinemaRequestedRef = useRef(false)
  const fullscreenRequestRef = useRef<Promise<void> | null>(null)
  const floating = useFloatingWindow({ storageKey: 'voxhold.window.channel-stream-preview.v1', width: 360, height: 225, minWidth: 280, minHeight: 175, placement: 'bottom-right', enabled: !uiHidden, elementRef: playerRef })
  const [idle, setIdle] = useState(false)
  const controlsHoveredRef = useRef(false)
  const isPublisher = role === 'publisher'
  const duration = useLiveDuration(stream?.started_at_ms)
  const canPictureInPicture = !isPublisher && pictureInPictureAvailable()
  const wantMuted = isPublisher || (preferences.playbackMuted || preferences.playbackVolume === 0)
  const gain = useStreamPlaybackGain(media, preferences.playbackVolume, isPublisher)
  const { videoRef, state: playbackState, muted, attach, enableAudio } = useMediaPlayback({
    role,
    muted: wantMuted,
    recovering: status === 'signaling',
    onRecoveryRequired: onPlaybackRecovery,
    context: { channel_id: stream?.channel_id ?? null },
  })

  useEffect(() => {
    attach(gain.media)
    return () => attach(null)
  }, [gain.media, attach])

  // Volume follows preferences without fighting the playback hook.
  useEffect(() => {
    const video = videoRef.current
    if (video) video.volume = gain.elementVolume
  }, [gain.elementVolume, videoRef])

  const enterCinemaMode = useCallback(async () => {
    cinemaRequestedRef.current = true
    setUIHidden(true)
    const player = playerRef.current
    if (!player?.requestFullscreen || document.fullscreenElement || fullscreenRequestRef.current) return
    let pending: Promise<void> | null = null
    try {
      pending = player.requestFullscreen()
      fullscreenRequestRef.current = pending
      await pending
    } catch {
      // CSS fullscreen remains available when the browser denies the native API.
    } finally {
      if (fullscreenRequestRef.current === pending) fullscreenRequestRef.current = null
    }
  }, [])

  const restoreUI = useCallback(async () => {
    cinemaRequestedRef.current = false
    // Escape can arrive while requestFullscreen is still pending. Wait for it
    // before exiting so a late native entry cannot enlarge the restored preview.
    const pending = fullscreenRequestRef.current
    if (pending) {
      try { await pending } catch { /* CSS fallback has no native fullscreen to exit. */ }
    }
    if (cinemaRequestedRef.current) return
    if (playerRef.current && document.fullscreenElement === playerRef.current && document.exitFullscreen) {
      try {
        await document.exitFullscreen()
      } catch {
        // The browser may already be leaving fullscreen after Escape.
      }
    }
    if (cinemaRequestedRef.current) return
    setUIHidden(false)
    playerRef.current?.focus({ preventScroll: true })
  }, [])

  // "Полный экран" in the room panel mounts the player and goes fullscreen in
  // the same click, while the browser still honours the user gesture.
  const startInCinemaRef = useRef(startInCinema)
  useEffect(() => {
    if (mode === 'expanded' && startInCinemaRef.current) {
      startInCinemaRef.current = false
      void enterCinemaMode()
    }
  }, [mode, enterCinemaMode])

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !uiHidden && !playerRef.current?.contains(document.activeElement)) return
      if (event.key === 'Tab' && uiHidden) {
        const buttons = [...(playerRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)') ?? [])].filter((element) => element.getClientRects().length > 0)
        const first = buttons[0], last = buttons.at(-1)
        if (event.shiftKey && (document.activeElement === first || document.activeElement === playerRef.current)) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && (document.activeElement === last || document.activeElement === playerRef.current)) { event.preventDefault(); first?.focus() }
      }
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
      if (uiHidden) void restoreUI()
      else onCollapse()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [mode, onCollapse, uiHidden, enterCinemaMode, restoreUI])

  useEffect(() => {
    const syncFullscreenState = () => {
      if (uiHidden && document.fullscreenElement !== playerRef.current) { cinemaRequestedRef.current = false; setUIHidden(false); playerRef.current?.focus({ preventScroll: true }) }
    }
    document.addEventListener('fullscreenchange', syncFullscreenState)
    return () => document.removeEventListener('fullscreenchange', syncFullscreenState)
  }, [mode, uiHidden])

  // Cinema mode shows nothing but the picture: the controls come back on any
  // input and fade out again after a short pause.
  useEffect(() => {
    controlsHoveredRef.current = false
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
    gain.resume()
    const volume = Math.max(0, Math.min(MAX_STREAM_VOLUME, value))
    if (isPublisher) {
      if (volume > 0) onPreferencesChange({ ...preferences, publishVolume: volume })
      if ((volume === 0) !== audioMuted) onToggleAudio?.()
    } else {
      onPreferencesChange({ ...preferences, playbackVolume: volume || preferences.playbackVolume, playbackMuted: volume === 0 })
    }
  }
  const togglePlaybackAudio = () => { gain.resume(); onPreferencesChange({ ...preferences, playbackVolume: preferences.playbackVolume || 100, playbackMuted: !(preferences.playbackMuted || preferences.playbackVolume === 0) }) }
  const volumeControl = (compact = false) => <StreamVolumeControl
    compact={compact} publisher={!!isPublisher}
    volume={isPublisher ? preferences.publishVolume : preferences.playbackVolume}
    muted={isPublisher ? audioMuted : preferences.playbackMuted}
    disabled={!stream?.has_audio} onVolumeChange={updateVolume}
    onToggleMute={isPublisher ? () => onToggleAudio?.() : togglePlaybackAudio}/>

  const liveLabel = isPublisher
    ? audioMuted ? 'Ваш предпросмотр · звук выключен' : 'Ваш предпросмотр'
    : playbackState === 'playing'
      ? 'Прямой эфир'
      : status === 'connected' ? 'Ожидание первого кадра…' : 'Подключение…'
  const leaveLabel = isPublisher ? 'Завершить трансляцию' : 'Перестать смотреть'
  const audioBlockedOverlay = !isPublisher && (playbackState === 'audio_blocked' || gain.blocked)
  const rangeLabel = quality?.dynamicRange === 'hdr10' ? 'HDR10' : quality?.dynamicRange === 'hlg' ? 'HLG' : quality?.dynamicRange === 'sdr' ? 'SDR' : ''

  const expand = () => { onExpand(); void enterCinemaMode() }
  const sourceName = isPublisher ? 'Ваш экран' : publisherName ?? 'Трансляция экрана'
  const qualityLabel = [quality?.height ? `${quality.height}p` : '', quality?.framesPerSecond ? `${quality.framesPerSecond} FPS` : '', rangeLabel].filter(Boolean).join(' · ')

  return <section ref={playerRef} style={floating.style} tabIndex={-1} className={`stream-expanded-player stream-preview-player floating-window ${uiHidden ? 'is-ui-hidden' : ''} ${uiHidden && idle ? 'is-idle' : ''}`} role={mode === 'expanded' || uiHidden ? 'dialog' : 'complementary'} aria-modal={uiHidden || undefined} aria-label={`Трансляция в канале ${channelName}`}>
    <header className="stream-preview-player__header">
      <button type="button" className="stream-preview-player__back" onClick={onCollapse} aria-label="Вернуться в голосовой канал" title="Вернуться в голосовой канал"><Icon name="chevron" size={18}/></button>
      <button type="button" className="stream-preview-player__move" aria-label="Переместить окно трансляции" title="Перетащите окно · стрелки для перемещения · Home для сброса" onPointerDown={floating.beginMove} onKeyDown={floating.moveKey}><span>{channelName}</span><Icon name="grip" size={14}/></button>
      <span className="stream-preview-player__live" title={liveLabel}><i/>LIVE</span>
    </header>
    <div className="stream-expanded-player__video" onDoubleClick={() => { if (uiHidden) void restoreUI(); else void enterCinemaMode() }}>
      <video ref={videoRef} autoPlay playsInline muted={muted}/>
      {audioBlockedOverlay && (
        <div className="stream-audio-blocked-overlay">
          <span>Трансляция идёт без звука: браузер заблокировал автовоспроизведение</span>
          <button className="button button--primary" type="button" onClick={() => { gain.resume(); enableAudio() }}><Icon name="volume"/>Включить звук</button>
        </div>
      )}
      {!audioBlockedOverlay && (playbackState === 'stalled' || (!media && status === 'signaling' && uiHidden)) && (
        <div className="stream-audio-blocked-overlay"><span>Восстанавливаем соединение…</span></div>
      )}
      {!uiHidden && !audioBlockedOverlay && playbackState !== 'playing' && playbackState !== 'stalled' && !isPublisher && <span className="stream-preview-player__status">{liveLabel}</span>}
      {uiHidden && <div
        className="stream-cinema-controls"
        onDoubleClick={(event) => event.stopPropagation()}
        onPointerEnter={() => { controlsHoveredRef.current = true }}
        onPointerLeave={() => { controlsHoveredRef.current = false }}
      >
        {stream?.has_audio ? volumeControl() : <span/>}
        <button type="button" onClick={() => void restoreUI()} title="Выйти из полноэкранного режима (Esc или F)"><Icon name="minimize" size={16}/><span>Выйти из полного экрана</span></button>
        {callControls}
      </div>}
    </div>
    <footer className="stream-preview-player__footer">
      {gain.error && <span role="alert">{gain.error}</span>}
      <div className="stream-preview-player__source"><b title={sourceName}>{sourceName}</b><small>{[duration, qualityLabel].filter(Boolean).join(' · ') || liveLabel}</small></div>
      <div className="stream-preview-player__actions">
        {isPublisher && onOpenSettings && <button type="button" onClick={onOpenSettings} aria-label="Настройки трансляции" title="Настройки трансляции"><Icon name="settings" size={18}/></button>}
        {stream?.has_audio && (!isPublisher || onToggleAudio) && volumeControl(true)}
        {canPictureInPicture && <button type="button" onClick={() => void togglePictureInPicture(videoRef.current)} aria-label="Картинка в картинке" title="Смотреть поверх других окон"><Icon name="pip" size={18}/></button>}
        <button type="button" onClick={expand} title="Открыть трансляцию на весь экран" aria-label="Полный экран"><Icon name="maximize" size={18}/></button>
        <button type="button" className="is-danger" onClick={onLeave} title={leaveLabel} aria-label={leaveLabel}><Icon name="close" size={18}/></button>
      </div>
    </footer>
    {!uiHidden && <button type="button" className="floating-window__resize" aria-label="Изменить размер окна трансляции" title="Изменить размер · стрелки или перетаскивание" onPointerDown={floating.beginResize} onKeyDown={floating.resizeKey}><Icon name="more" size={17}/></button>}
  </section>
}
