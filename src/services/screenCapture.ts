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

function displaySurface(media: MediaStream) {
  return media.getVideoTracks()[0]?.getSettings().displaySurface
}

function reportsOwnAudioRestriction(track: MediaStreamTrack) {
  return (track.getSettings() as MediaTrackSettings & { restrictOwnAudio?: boolean }).restrictOwnAudio === true
}

function audioCaptureRoute(track: MediaStreamTrack, surface: string | undefined) {
  // Chromium exposes some display-capture routes as virtual device IDs.
  // Other browsers can return an opaque value. Export only these categories.
  const id = track.getSettings().deviceId
  if (surface === 'browser') return 'tab'
  if (id === 'loopbackWithoutChrome') return 'browser_excluded'
  if (id?.startsWith('restrictOwnAudioBrowserLoopback:')) return 'capturing_tab_excluded'
  if (id === 'loopback' || id === 'loopbackWithMute' || id === 'loopbackAllDevices') return 'system_mix'
  if (id?.startsWith('applicationLoopback:')) return 'application'
  return 'unknown'
}

export function captureAudioMayIncludeVoice(media: MediaStream) {
  const surface = displaySurface(media)
  return media.getAudioTracks().some((track) => {
    const route = audioCaptureRoute(track, surface)
    return route === 'system_mix' || ((route === 'unknown' || route === 'application') && !reportsOwnAudioRestriction(track))
  })
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
    windowAudio: preferences.includeAudio ? 'window' : 'exclude',
  }
  const media = await navigator.mediaDevices.getDisplayMedia(options)
  const video = media.getVideoTracks()[0]
  if (!video) {
    media.getTracks().forEach((track) => track.stop())
    throw new Error('Источник экрана не предоставил видеодорожку')
  }
  // Select the loopback source at getDisplayMedia time. Applying constraints
  // to a running track cannot reliably change which OS audio source it uses.
  if (!preferences.includeAudio) {
    media.getAudioTracks().forEach((track) => { media.removeTrack(track); track.stop() })
  }
  const surface = displaySurface(media)
  const tracks = media.getAudioTracks()
  const echoRisk = captureAudioMayIncludeVoice(media)
  video.contentHint = preferences.content === 'motion' ? 'motion' : 'detail'
  media.getAudioTracks().forEach((track) => { track.contentHint = 'music' })
  const settings = video.getSettings()
  clientDiagnostics.record('media', 'stream_capture_ready', echoRisk ? 'warn' : 'info', {
    display_surface: surface ?? 'unknown',
    has_audio: tracks.length > 0,
    audio_routes: tracks.map((track) => audioCaptureRoute(track, surface)),
    own_audio_restriction_reported: tracks.some(reportsOwnAudioRestriction),
    capture_echo_risk: echoRisk,
    own_audio_restriction_supported: canRestrictOwnAudio(),
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
