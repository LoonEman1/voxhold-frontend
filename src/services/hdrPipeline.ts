import type { StreamCodec, StreamRendition } from '../domain/types'
import type { HDRCaptureProbe } from './hdrCapabilities'

export interface StreamPublishPipeline {
  stream: MediaStream
  renditions: StreamRendition[]
  close: () => void
}

// Kept as an alias for callers compiled against the experimental HDR API.
export type HDRPublishPipeline = StreamPublishPipeline

type VideoWithFrameCallbacks = HTMLVideoElement & {
  requestVideoFrameCallback?: (callback: () => void) => number
  cancelVideoFrameCallback?: (handle: number) => void
}

type CanvasWithCapture = HTMLCanvasElement & {
  captureStream?: (frameRate?: number) => MediaStream
}

interface TrackProcessorLike {
  readable: ReadableStream<VideoFrame>
}

interface TrackGeneratorLike {
  writable: WritableStream<VideoFrame>
  track?: MediaStreamTrack
}

type TrackProcessorConstructor = new (options: { track: MediaStreamTrack }) => TrackProcessorLike
type TrackGeneratorConstructor = new (options?: { kind: 'video' }) => TrackGeneratorLike
type Canvas2DTarget = HTMLCanvasElement | OffscreenCanvas

function frameTransformConstructors() {
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

function sdrProfile(codec: StreamCodec) {
  if (codec === 'vp9') return '0'
  if (codec === 'h264') return 'baseline'
  if (codec === 'av1') return 'main'
  return ''
}

export function buildSDRStreamRenditions(codec: StreamCodec): StreamRendition[] {
  return [{
    id: 'sdr',
    codec,
    profile: sdrProfile(codec),
    dynamic_range: 'sdr',
    bit_depth: 8,
    color_primaries: 'bt709',
    transfer: 'bt709',
    matrix: 'bt709',
  }]
}

export function buildHDRStreamRenditions(
  sdrCodec: StreamCodec,
  probe: HDRCaptureProbe,
): StreamRendition[] {
  if (!probe.supported || !probe.codecProfile) {
    throw new Error(probe.reason || 'HDR capture probe did not pass')
  }
  return [
    ...buildSDRStreamRenditions(sdrCodec),
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

function waitForRenderableVideo(video: HTMLVideoElement, timeoutMs = 5_000) {
  if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) return Promise.resolve()
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      window.clearTimeout(timeout)
      video.removeEventListener('loadeddata', ready)
      video.removeEventListener('error', failed)
    }
    const ready = () => {
      cleanup()
      resolve()
    }
    const failed = () => {
      cleanup()
      reject(new Error('Браузер не смог декодировать захваченный экран для SDR-преобразования'))
    }
    const timeout = window.setTimeout(() => {
      cleanup()
      reject(new Error('Истёк таймаут подготовки SDR-преобразования экрана'))
    }, timeoutMs)
    video.addEventListener('loadeddata', ready, { once: true })
    video.addEventListener('error', failed, { once: true })
  })
}

function createSRGBContext(canvas: Canvas2DTarget) {
  const target = canvas as Canvas2DTarget & {
    getContext: (
      contextId: '2d',
      options?: CanvasRenderingContext2DSettings,
    ) => CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null
  }
  try {
    const context = target.getContext('2d', {
      alpha: false,
      colorSpace: 'srgb',
      desynchronized: true,
    } as CanvasRenderingContext2DSettings)
    if (context) return context
  } catch {
    // Older engines reject newer context attributes. Their default 2D canvas
    // is still 8-bit sRGB, which is the compatibility path we need here.
  }
  return target.getContext('2d', { alpha: false })
}

function createFrameCanvas(width: number, height: number): Canvas2DTarget | null {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height)
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

function createFrameDrivenSDRPipeline(
  capture: MediaStream,
  codec: StreamCodec,
  onFailure?: (error: Error) => void,
): StreamPublishPipeline | null {
  const { Processor, Generator } = frameTransformConstructors()
  if (!Processor || !Generator || typeof VideoFrame === 'undefined') return null
  const source = capture.getVideoTracks()[0]
  if (!source) throw new Error('Источник экрана не предоставил видеодорожку')
  const settings = source.getSettings()
  const width = Math.max(1, settings.width ?? 1920)
  const height = Math.max(1, settings.height ?? 1080)
  const canvas = createFrameCanvas(width, height)
  if (!canvas) return null
  const context = createSRGBContext(canvas)
  if (!context) return null

  const processorTrack = source.clone()
  const processor = new Processor({ track: processorTrack })
  const generator = new Generator({ kind: 'video' })
  const sdrTrack = generator.track ?? generator as unknown as MediaStreamTrack
  sdrTrack.contentHint = 'detail'
  const reader = processor.readable.getReader()
  const writer = generator.writable.getWriter()
  let closed = false

  const pump = async () => {
    while (!closed) {
      const sample = await reader.read()
      if (sample.done || !sample.value) break
      const input = sample.value
      let output: VideoFrame | null = null
      try {
        context.drawImage(input, 0, 0, width, height)
        output = new VideoFrame(canvas, {
          timestamp: input.timestamp,
          duration: input.duration ?? undefined,
          alpha: 'discard',
        })
        await writer.write(output)
      } finally {
        output?.close()
        input.close()
      }
    }
    if (!closed) await writer.close()
  }
  void pump().catch((value: unknown) => {
    if (!closed) onFailure?.(value instanceof Error ? value : new Error('SDR frame pipeline stopped'))
  })

  return {
    stream: new MediaStream([sdrTrack, ...capture.getAudioTracks()]),
    renditions: buildSDRStreamRenditions(codec),
    close: () => {
      if (closed) return
      closed = true
      void reader.cancel().catch(() => undefined)
      void writer.abort(new Error('SDR pipeline closed')).catch(() => undefined)
      processorTrack.stop()
      sdrTrack.stop()
    },
  }
}

/**
 * Produces an actual SDR video track instead of merely labelling the captured
 * HDR pixels as BT.709. Rendering into the default 8-bit sRGB canvas invokes
 * the browser's color-managed HDR/WCG -> SDR conversion before WebRTC encodes
 * the canvas track.
 */
export async function createSDRPublishPipeline(
  capture: MediaStream,
  codec: StreamCodec,
  onFailure?: (error: Error) => void,
): Promise<StreamPublishPipeline> {
  // A frame-driven transform is independent of page visibility. Unlike
  // requestVideoFrameCallback/requestAnimationFrame, it continues to receive
  // the active getDisplayMedia track while the publisher opens another tab.
  const frameDriven = createFrameDrivenSDRPipeline(capture, codec, onFailure)
  if (frameDriven) return frameDriven

  if (typeof document === 'undefined') throw new Error('SDR-преобразование доступно только в браузере')
  const source = capture.getVideoTracks()[0]
  if (!source) throw new Error('Источник экрана не предоставил видеодорожку')

  const playbackTrack = source.clone()
  const video = document.createElement('video') as VideoWithFrameCallbacks
  const canvas = document.createElement('canvas') as CanvasWithCapture
  const settings = source.getSettings()
  canvas.width = Math.max(1, settings.width ?? 1920)
  canvas.height = Math.max(1, settings.height ?? 1080)
  const context = createSRGBContext(canvas)
  if (!context || typeof canvas.captureStream !== 'function') {
    playbackTrack.stop()
    throw new Error('Браузер не поддерживает безопасное HDR → SDR преобразование экрана')
  }

  video.muted = true
  video.autoplay = true
  video.playsInline = true
  video.srcObject = new MediaStream([playbackTrack])

  try {
    // Start the readiness timeout concurrently: a few engines leave play()
    // pending forever when a capture track dies during initialization.
    await Promise.all([video.play(), waitForRenderableVideo(video)])
    context.drawImage(video, 0, 0, canvas.width, canvas.height)
  } catch (error) {
    video.pause()
    video.srcObject = null
    playbackTrack.stop()
    throw error
  }

  const frameRate = Math.max(1, Math.min(120, settings.frameRate ?? 30))
  const canvasStream = canvas.captureStream(frameRate)
  const sdrTrack = canvasStream.getVideoTracks()[0]
  if (!sdrTrack) {
    video.pause()
    video.srcObject = null
    playbackTrack.stop()
    canvasStream.getTracks().forEach((track) => track.stop())
    throw new Error('Браузер не создал SDR-видеодорожку')
  }
  sdrTrack.contentHint = 'detail'

  let closed = false
  let frameCallback: number | null = null
  let interval: number | null = null
  let failureReported = false
  const reportFailure = (value: unknown) => {
    if (closed || failureReported) return
    failureReported = true
    onFailure?.(value instanceof Error ? value : new Error('SDR-преобразование экрана остановлено'))
  }
  const draw = () => {
    if (closed) return
    try {
      context.drawImage(video, 0, 0, canvas.width, canvas.height)
    } catch (error) {
      reportFailure(error)
    }
  }
  const scheduleFrame = () => {
    if (closed || typeof video.requestVideoFrameCallback !== 'function') return
    frameCallback = video.requestVideoFrameCallback(() => {
      draw()
      scheduleFrame()
    })
  }
  if (typeof video.requestVideoFrameCallback === 'function') {
    scheduleFrame()
  } else {
    interval = window.setInterval(draw, Math.max(8, Math.round(1000 / frameRate)))
  }
  const videoError = () => reportFailure(new Error('Браузер потерял кадры SDR-преобразования'))
  video.addEventListener('error', videoError)

  const stream = new MediaStream([sdrTrack, ...capture.getAudioTracks()])
  return {
    stream,
    renditions: buildSDRStreamRenditions(codec),
    close: () => {
      if (closed) return
      closed = true
      video.removeEventListener('error', videoError)
      if (frameCallback !== null && typeof video.cancelVideoFrameCallback === 'function') {
        video.cancelVideoFrameCallback(frameCallback)
      }
      if (interval !== null) window.clearInterval(interval)
      video.pause()
      video.srcObject = null
      playbackTrack.stop()
      canvasStream.getTracks().forEach((track) => track.stop())
    },
  }
}

export async function createHDRPublishPipeline(
  capture: MediaStream,
  sdrCodec: StreamCodec,
  probe: HDRCaptureProbe,
  onFailure?: (error: Error) => void,
): Promise<StreamPublishPipeline> {
  const source = capture.getVideoTracks()[0]
  if (!source) throw new Error('HDR source has no video track')
  const renditions = buildHDRStreamRenditions(sdrCodec, probe)

  // The previous WebGPU path requested Rec.2020 conversion and then treated
  // the converted samples as untouched PQ/HLG, applying the transfer twice.
  const sdrPipeline = await createSDRPublishPipeline(capture, sdrCodec, onFailure)
  const sdrTrack = sdrPipeline.stream.getVideoTracks()[0]
  if (!sdrTrack) {
    sdrPipeline.close()
    throw new Error('HDR pipeline did not create its mandatory SDR rendition')
  }
  return {
    stream: new MediaStream([sdrTrack, source, ...capture.getAudioTracks()]),
    renditions,
    close: sdrPipeline.close,
  }
}
