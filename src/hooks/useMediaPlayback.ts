import { useCallback, useEffect, useRef, useState } from 'react'
import { clientDiagnostics } from '../platform/clientDiagnostics'

export type MediaPlaybackState = 'idle' | 'loading' | 'playing' | 'audio_blocked' | 'stalled' | 'failed'

interface UseMediaPlaybackOptions {
  role: 'publisher' | 'viewer'
  /** Initial desired mute state; autoplay-blocked viewers fall back to muted video. */
  muted: boolean
  context?: Record<string, unknown>
}

/**
 * Owns the <video> element playback lifecycle for stream players: attaching
 * media, retrying play(), translating NotAllowedError into an explicit
 * audio-blocked state with a user gesture recovery path, and tracking
 * stalled/ended/error states instead of showing a silent black rectangle.
 */
export function useMediaPlayback(options: UseMediaPlaybackOptions) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [state, setState] = useState<MediaPlaybackState>('idle')
  const [muted, setMuted] = useState(options.muted)
  const [media, setMedia] = useState<MediaStream | null>(null)
  const stateRef = useRef(state)
  stateRef.current = state
  // Keep volatile fields in refs so playback effects do not re-run on every
  // render just because an inline context object changed identity.
  const contextRef = useRef(options.context)
  contextRef.current = options.context

  const attach = useCallback((value: MediaStream | null) => {
    setMedia(value)
    setState(value ? 'loading' : 'idle')
  }, [])

  useEffect(() => {
    setMuted(options.muted)
  }, [options.muted])

  // Attach/cleanup srcObject and event listeners whenever media changes.
  useEffect(() => {
    const video = videoRef.current
    if (!video || !media) {
      if (video && !media && video.srcObject) video.srcObject = null
      return
    }
    video.srcObject = media
    const startedAt = performance.now()
    let firstFrameMs: number | null = null
    let stalledAt: number | null = null
    let stallCount = 0
    let stallMs = 0
    let frameCallback: number | null = null
    const firstFrame = () => {
      if (firstFrameMs !== null) return
      firstFrameMs = Math.round(performance.now() - startedAt)
      clientDiagnostics.record('media', 'stream_first_frame', 'info', { ...contextRef.current, role: options.role, first_frame_ms: firstFrameMs })
    }
    const loadedData = () => { if (typeof video.requestVideoFrameCallback !== 'function') firstFrame() }
    if (typeof video.requestVideoFrameCallback === 'function') frameCallback = video.requestVideoFrameCallback(firstFrame)
    const resetHiddenStall = () => { if (document.visibilityState !== 'visible') stalledAt = null }
    document.addEventListener('visibilitychange', resetHiddenStall)

    const tracks = (typeof media.getVideoTracks === 'function' ? media.getVideoTracks() : []) as MediaStreamTrack[]

    const markPlaying = () => {
      if (stalledAt !== null) { stallMs += performance.now() - stalledAt; stalledAt = null }
      if (stateRef.current !== 'failed') setState('playing')
    }
    const markStalled = () => {
      if (video.readyState < 3) {
        setState('stalled')
        if (firstFrameMs !== null && stalledAt === null && document.visibilityState === 'visible') { stalledAt = performance.now(); stallCount += 1 }
      }
    }
    const onTrackEnded = () => setState('stalled')
    const markFailed = () => setState('failed')
    video.addEventListener('loadedmetadata', markPlaying)
    video.addEventListener('loadeddata', loadedData)
    video.addEventListener('canplay', markPlaying)
    video.addEventListener('playing', markPlaying)
    video.addEventListener('waiting', markStalled)
    video.addEventListener('stalled', markStalled)
    video.addEventListener('error', markFailed)
    for (const track of tracks) track.addEventListener('ended', onTrackEnded)

    return () => {
      if (stalledAt !== null) stallMs += performance.now() - stalledAt
      clientDiagnostics.record('media', 'stream_playback_summary', 'info', { ...contextRef.current, role: options.role, duration_ms: Math.round(performance.now() - startedAt), first_frame_ms: firstFrameMs, stall_count: stallCount, stall_ms: Math.round(stallMs) })
      document.removeEventListener('visibilitychange', resetHiddenStall)
      if (frameCallback !== null) video.cancelVideoFrameCallback?.(frameCallback)
      video.removeEventListener('loadeddata', loadedData)
      video.removeEventListener('loadedmetadata', markPlaying)
      video.removeEventListener('canplay', markPlaying)
      video.removeEventListener('playing', markPlaying)
      video.removeEventListener('waiting', markStalled)
      video.removeEventListener('stalled', markStalled)
      video.removeEventListener('error', markFailed)
      for (const track of tracks) track.removeEventListener('ended', onTrackEnded)
      if (video.srcObject === media) video.srcObject = null
    }
  }, [media, options.role])

  // Attempt playback whenever media or mute intent changes.
  useEffect(() => {
    const video = videoRef.current
    if (!video || !media) return
    let cancelled = false
    video.muted = muted
    video.play().then(() => {
      if (cancelled) return
      clientDiagnostics.record('media', 'stream_playback_started', 'info', {
        role: options.role,
        muted,
        ...contextRef.current,
      })
      if (stateRef.current !== 'failed') setState('playing')
    }).catch((error: unknown) => {
      if (cancelled) return
      const name = error instanceof DOMException ? error.name : typeof error
      clientDiagnostics.record('media', 'stream_playback_blocked', 'warn', {
        role: options.role,
        error_name: name,
        ...contextRef.current,
      })
      if (error instanceof DOMException && error.name === 'NotAllowedError') {
        if (!options.muted && options.role === 'viewer') {
          // Show the picture immediately without sound and surface the
          // explicit "enable audio" action.
          video.muted = true
          setMuted(true)
          setState('audio_blocked')
          void video.play().catch(() => undefined)
        } else {
          setState('audio_blocked')
        }
        return
      }
      if (error instanceof DOMException && error.name === 'AbortError') return
      setState('failed')
    })
    return () => { cancelled = true }
  }, [media, muted, options.role, options.muted])

  /** Must be called directly from a user click handler to satisfy autoplay policy. */
  const enableAudio = useCallback(() => {
    const video = videoRef.current
    setMuted(false)
    if (!video) return
    video.muted = false
    video.play().then(() => setState('playing')).catch((error: unknown) => {
      clientDiagnostics.record('media', 'stream_unmute_blocked', 'warn', {
        role: options.role,
        error_name: error instanceof Error ? error.name : typeof error,
      })
      setState('audio_blocked')
    })
  }, [options.role])

  const resume = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    void video.play().catch(() => undefined)
  }, [])

  return { videoRef, state, muted, attach, enableAudio, resume }
}
