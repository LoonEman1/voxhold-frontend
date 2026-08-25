import type { StreamCodec, StreamRendition } from '../domain/types'
import type { HDRCaptureProbe } from './hdrCapabilities'

interface TrackProcessorLike {
  readable: ReadableStream<VideoFrame>
}

interface TrackGeneratorLike {
  writable: WritableStream<VideoFrame>
  track?: MediaStreamTrack
  stop?: () => void
  contentHint?: string
}

type TrackProcessorConstructor = new (options: { track: MediaStreamTrack }) => TrackProcessorLike
type TrackGeneratorConstructor = new (options?: { kind: 'video' }) => TrackGeneratorLike

export interface HDRPublishPipeline {
  stream: MediaStream
  renditions: StreamRendition[]
  close: () => void
}

interface WorkerReply {
  type: 'ready' | 'frame' | 'error'
  frame?: VideoFrame
  reason?: string
}

function scopeConstructors() {
  const scope = globalThis as typeof globalThis & {
    MediaStreamTrackProcessor?: TrackProcessorConstructor
    VideoTrackGenerator?: TrackGeneratorConstructor
    MediaStreamTrackGenerator?: TrackGeneratorConstructor
  }
  return {
    Processor: scope.MediaStreamTrackProcessor,
    Generator: scope.VideoTrackGenerator ?? scope.MediaStreamTrackGenerator,
  }
}

export function pqToRelativeLinear(value: number) {
  const m1 = 2610 / 16384
  const m2 = 2523 / 32
  const c1 = 3424 / 4096
  const c2 = 2413 / 128
  const c3 = 2392 / 128
  const power = Math.max(value, 0) ** (1 / m2)
  return (Math.max(power - c1, 0) / Math.max(c2 - c3 * power, 1e-7)) ** (1 / m1)
}

export function hlgToRelativeLinear(value: number) {
  const a = 0.17883277
  const b = 0.28466892
  const c = 0.55991073
  return value <= 0.5 ? (value * value) / 3 : (Math.exp((value - c) / a) + b) / 12
}

export function toneMapRelativeToSDR(value: number) {
  const nonNegative = Math.max(0, value)
  const shoulder = nonNegative / (1 + nonNegative)
  return shoulder <= 0.0031308
    ? shoulder * 12.92
    : 1.055 * shoulder ** (1 / 2.4) - 0.055
}

export function buildHDRStreamRenditions(
  sdrCodec: StreamCodec,
  probe: HDRCaptureProbe,
): StreamRendition[] {
  if (!probe.supported || !probe.codecProfile) {
    throw new Error(probe.reason || 'HDR capture probe did not pass')
  }
  const sdrProfile = sdrCodec === 'vp9' ? '0' : sdrCodec === 'h264' ? 'baseline' : sdrCodec === 'av1' ? 'main' : ''
  return [
    {
      id: 'sdr',
      codec: sdrCodec,
      profile: sdrProfile,
      dynamic_range: 'sdr',
      bit_depth: 8,
      color_primaries: 'bt709',
      transfer: 'bt709',
      matrix: 'bt709',
    },
    {
      id: 'hdr',
      codec: probe.codecProfile.codec,
      profile: probe.codecProfile.profile,
      dynamic_range: probe.sourceRange === 'hlg' ? 'hlg' : 'hdr10',
      bit_depth: 10,
      color_primaries: 'bt2020',
      transfer: probe.sourceRange === 'hlg' ? 'hlg' : 'pq',
      matrix: 'bt2020-ncl',
    },
  ]
}

export async function createHDRPublishPipeline(
  capture: MediaStream,
  sdrCodec: StreamCodec,
  probe: HDRCaptureProbe,
  onFailure?: (error: Error) => void,
): Promise<HDRPublishPipeline> {
  const source = capture.getVideoTracks()[0]
  if (!source) throw new Error('HDR source has no video track')
  const { Processor, Generator } = scopeConstructors()
  if (!Processor || !Generator || typeof Worker === 'undefined') {
    throw new Error('HDR frame processor or generator is unavailable')
  }
  const renditions = buildHDRStreamRenditions(sdrCodec, probe)
  const processorTrack = source.clone()
  const processor = new Processor({ track: processorTrack })
  const generator = new Generator({ kind: 'video' })
  const sdrTrack = generator.track ?? generator as unknown as MediaStreamTrack
  sdrTrack.contentHint = 'detail'
  const reader = processor.readable.getReader()
  const writer = generator.writable.getWriter()
  const worker = new Worker(new URL('../workers/hdrToneMap.worker.ts', import.meta.url), { type: 'module' })
  let closed = false
  let waiting: { resolve: (frame: VideoFrame) => void; reject: (error: Error) => void } | null = null

  const ready = new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error('HDR tone mapper initialization timed out')), 5_000)
    worker.onmessage = (event: MessageEvent<WorkerReply>) => {
      const message = event.data
      if (message.type === 'ready') {
        window.clearTimeout(timeout)
        resolve()
        return
      }
      if (message.type === 'frame' && message.frame && waiting) {
        const current = waiting
        waiting = null
        current.resolve(message.frame)
        return
      }
      if (message.type === 'error') {
        const error = new Error(message.reason || 'HDR tone mapper failed')
        if (waiting) {
          const current = waiting
          waiting = null
          current.reject(error)
        }
        reject(error)
        if (!closed) onFailure?.(error)
      }
    }
    worker.onerror = () => {
      const error = new Error('HDR tone mapper worker crashed')
      window.clearTimeout(timeout)
      reject(error)
      if (waiting) {
        const current = waiting
        waiting = null
        current.reject(error)
      }
      if (!closed) onFailure?.(error)
    }
  })

  const settings = source.getSettings()
  worker.postMessage({
    type: 'init',
    width: settings.width ?? 1920,
    height: settings.height ?? 1080,
    transfer: probe.sourceRange === 'hlg' ? 'hlg' : 'pq',
  })
  try {
    await ready
  } catch (error) {
    worker.terminate()
    processorTrack.stop()
    sdrTrack.stop()
    await reader.cancel().catch(() => undefined)
    writer.releaseLock()
    throw error
  }

  const processFrame = (frame: VideoFrame) => new Promise<VideoFrame>((resolve, reject) => {
    waiting = { resolve, reject }
    worker.postMessage({ type: 'frame', frame }, [frame])
  })

  const pump = async () => {
    while (!closed) {
      const sample = await reader.read()
      if (sample.done || !sample.value) break
      const output = await processFrame(sample.value)
      if (closed) {
        output.close()
        break
      }
      try {
        await writer.write(output)
      } finally {
        output.close()
      }
    }
  }
  void pump().catch((error: unknown) => {
    if (!closed) onFailure?.(error instanceof Error ? error : new Error('HDR frame pipeline failed'))
  })

  const stream = new MediaStream([
    sdrTrack,
    source,
    ...capture.getAudioTracks(),
  ])
  return {
    stream,
    renditions,
    close: () => {
      if (closed) return
      closed = true
      waiting?.reject(new Error('HDR pipeline closed'))
      waiting = null
      worker.postMessage({ type: 'close' })
      worker.terminate()
      void reader.cancel().catch(() => undefined)
      void writer.close().catch(() => undefined)
      processorTrack.stop()
      sdrTrack.stop()
    },
  }
}
