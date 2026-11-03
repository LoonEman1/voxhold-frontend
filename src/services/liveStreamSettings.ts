import type { StreamPublishPipeline } from './hdrPipeline'
import { normalizeStreamPreferences, selectedStreamResolution, type StreamPreferences } from './streamSettings'

export interface LiveStreamTarget {
  capture: MediaStream
  pipeline: StreamPublishPipeline | null
  updateSenders: (preferences: StreamPreferences, sourceSettings?: MediaTrackSettings) => Promise<void>
  isCurrent: () => boolean
}

export function streamCaptureConstraints(preferences: StreamPreferences): MediaTrackConstraints {
  const size = selectedStreamResolution(preferences)
  return { width: { ideal: size.width, max: size.width }, height: { ideal: size.height, max: size.height }, frameRate: { ideal: preferences.frameRate, max: preferences.frameRate } }
}

/** Keeps the capture, tracks and PeerConnections alive; failures restore prior limits. */
export async function applyLiveStreamSettings(target: LiveStreamTarget, previous: StreamPreferences, value: StreamPreferences) {
  const next = normalizeStreamPreferences(value)
  if (next.mode !== previous.mode || next.codec !== previous.codec || next.dynamicRange !== previous.dynamicRange || next.includeAudio !== previous.includeAudio) throw new Error('Источник, кодек, диапазон и захват звука выбираются перед запуском')
  const track = target.capture.getVideoTracks()[0]
  if (!track || track.readyState === 'ended' || !target.isCurrent()) throw new Error('Трансляция уже завершена')
  const geometryChanged = next.resolution !== previous.resolution || next.frameRate !== previous.frameRate
  const oldConstraints = track.getConstraints()
  const oldHint = track.contentHint
  try {
    if (geometryChanged) {
      await track.applyConstraints(streamCaptureConstraints(next))
      if (!target.isCurrent()) throw new Error('Трансляция уже завершена')
      await target.pipeline?.configureCapture?.(streamCaptureConstraints(next))
    }
    if (!target.isCurrent()) throw new Error('Трансляция уже завершена')
    await target.updateSenders(next, track.getSettings?.())
    if (!target.isCurrent()) throw new Error('Трансляция уже завершена')
    track.contentHint = next.content === 'motion' ? 'motion' : 'detail'
    return next
  } catch (error) {
    if (target.isCurrent()) {
      if (geometryChanged) {
        await track.applyConstraints(oldConstraints).catch(() => undefined)
        await target.pipeline?.configureCapture?.(streamCaptureConstraints(previous)).catch(() => undefined)
      }
      await target.updateSenders(previous, track.getSettings?.()).catch(() => undefined)
      track.contentHint = oldHint
    }
    throw error
  }
}
