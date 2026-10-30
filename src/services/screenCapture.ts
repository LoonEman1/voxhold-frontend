import { normalizeStreamPreferences, selectedStreamResolution, type StreamPreferences } from './streamSettings'
import { clientDiagnostics } from '../platform/clientDiagnostics'

/** Screen Capture spec constraint, not yet in TypeScript's DOM library. */
type DisplayAudioConstraints = MediaTrackConstraints & { restrictOwnAudio?: boolean }

/** Whether this browser understands restrictOwnAudio at all. */
export function canRestrictOwnAudio() {
  const supported = navigator.mediaDevices?.getSupportedConstraints?.() as
    (MediaTrackSupportedConstraints & { restrictOwnAudio?: boolean }) | undefined
  return supported?.restrictOwnAudio === true
}

/**
 * True when a capture carries whole-system audio (screen or window) that
 * still contains this page's playback, so friends would hear themselves.
 * A shared tab only carries that tab's own audio and is never affected.
 */
export function capturedAudioIncludesOwnPlayback(media: MediaStream) {
  const audio = media.getAudioTracks()[0]
  if (!audio) return false
  const surface = (media.getVideoTracks()[0]?.getSettings() as MediaTrackSettings & { displaySurface?: string } | undefined)
    ?.displaySurface
  if (surface === 'browser') return false
  return (audio.getSettings() as MediaTrackSettings & { restrictOwnAudio?: boolean }).restrictOwnAudio !== true
}

export async function captureScreen(value: StreamPreferences): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getDisplayMedia) throw new Error('Браузер не поддерживает трансляцию экрана')
  const preferences = normalizeStreamPreferences(value)
  const resolution = selectedStreamResolution(preferences)
  // Voice processing is tuned for microphones: on system audio it pumps
  // music and cuts game sound, so the captured mix is sent untouched.
  // restrictOwnAudio removes what this page plays itself: system audio would
  // otherwise carry the voice chat back to the friends who are speaking.
  const audio: DisplayAudioConstraints = {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
    restrictOwnAudio: true,
  }
  const options: DisplayMediaStreamOptions & Record<string, unknown> = {
    video: {
      width: { ideal: resolution.width, max: resolution.width },
      height: { ideal: resolution.height, max: resolution.height },
      frameRate: { ideal: preferences.frameRate, max: preferences.frameRate },
    },
    audio: preferences.includeAudio ? audio : false,
    // Chromium hints (ignored elsewhere): never offer the Voxhold tab itself,
    // which would mirror the stream endlessly, and allow switching the shared
    // tab without restarting the stream.
    selfBrowserSurface: 'exclude',
    surfaceSwitching: 'include',
    systemAudio: preferences.includeAudio ? 'include' : 'exclude',
  }
  const media = await navigator.mediaDevices.getDisplayMedia(options)
  const video = media.getVideoTracks()[0]
  if (!video) {
    media.getTracks().forEach((track) => track.stop())
    throw new Error('Источник экрана не предоставил видеодорожку')
  }
  video.contentHint = preferences.content === 'motion' ? 'motion' : 'detail'
  media.getAudioTracks().forEach((track) => { track.contentHint = 'music' })
  const settings = video.getSettings()
  clientDiagnostics.record('media', 'stream_capture_ready', 'info', {
    has_audio: media.getAudioTracks().length > 0,
    audio_includes_own_playback: capturedAudioIncludesOwnPlayback(media),
    width: settings.width ?? null,
    height: settings.height ?? null,
    frame_rate: settings.frameRate ?? null,
  })
  if (preferences.dynamicRange === 'hdr' && preferences.mode === 'server') {
    try {
      const { detectHDRCapabilities, probeCapturedHDRTrack, rememberHDRCaptureProbe } = await import('./hdrCapabilities')
      const capabilities = await detectHDRCapabilities()
      const probe = await probeCapturedHDRTrack(video, capabilities)
      rememberHDRCaptureProbe(media, probe)
      clientDiagnostics.record('media', 'hdr_capture_probe', probe.supported ? 'info' : 'warn', {
        source_range: probe.sourceRange,
        bit_depth: probe.bitDepth,
        codec_profile: probe.codecProfile ? `${probe.codecProfile.codec}:${probe.codecProfile.profile}` : '',
        reason: probe.reason,
      })
    } catch (error) { media.getTracks().forEach((track) => track.stop()); throw error }
  }
  return media
}
