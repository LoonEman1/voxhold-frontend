import type { StreamCodecProfile, StreamDynamicRange } from '../domain/types'
import { clientDiagnostics } from '../platform/clientDiagnostics'

export interface HDROutputCapabilities {
  dynamicRange: 'standard' | 'high'
  gamut: 'srgb' | 'p3' | 'rec2020'
}

export interface HDRProcessingCapabilities {
  trackProcessor: boolean
  trackGenerator: boolean
  webGPU: boolean
}

export interface HDRCodecProbe {
  codec: 'av1' | 'vp9'
  profile: 'main10' | '2'
  codecString: string
  encoder: boolean
  decoder: boolean
  roundTrip: boolean
}

export interface HDRCapabilities {
  output: HDROutputCapabilities
  processing: HDRProcessingCapabilities
  codecs: HDRCodecProbe[]
  codecProfiles: StreamCodecProfile[]
  canPublishHDR: boolean
  canViewHDR: boolean
  reason: string
}

export interface HDRFrameDescriptor {
  format?: string | null
  primaries?: string | null
  transfer?: string | null
  matrix?: string | null
}

export interface HDRCaptureProbe {
  supported: boolean
  sourceRange: StreamDynamicRange
  codecProfile: StreamCodecProfile | null
  bitDepth: 8 | 10
  colorPrimaries: 'bt709' | 'bt2020'
  transfer: 'bt709' | 'pq' | 'hlg'
  matrix: 'bt709' | 'bt2020-ncl'
  reason: string
}

interface TrackProcessorLike {
  readable: ReadableStream<VideoFrame>
}

type TrackProcessorConstructor = new (options: { track: MediaStreamTrack }) => TrackProcessorLike

const HDR_CODEC_CONFIGS = [
  { codec: 'av1', profile: 'main10', codecString: 'av01.0.08M.10' },
  { codec: 'vp9', profile: '2', codecString: 'vp09.02.10.10' },
] as const

let cachedCapabilities: Promise<HDRCapabilities> | null = null
const captureProbes = new WeakMap<MediaStream, HDRCaptureProbe>()

export function detectHDROutputCapabilities(
  match: (query: string) => Pick<MediaQueryList, 'matches'>,
): HDROutputCapabilities {
  const dynamicRange = match('(video-dynamic-range: high)').matches ? 'high' : 'standard'
  const gamut = match('(video-color-gamut: rec2020)').matches
    ? 'rec2020'
    : match('(video-color-gamut: p3)').matches ? 'p3' : 'srgb'
  return { dynamicRange, gamut }
}

export function classifyHDRFrame(value: HDRFrameDescriptor): {
  dynamicRange: StreamDynamicRange
  bitDepth: 8 | 10
  valid: boolean
} {
  const format = (value.format ?? '').toUpperCase()
  const tenBit = /(^|[^0-9])10([^0-9]|$)|P010|I010|I210|I410|RGBAF16/.test(format)
  const primaries = (value.primaries ?? '').toLowerCase()
  const transfer = (value.transfer ?? '').toLowerCase()
  const matrix = (value.matrix ?? '').toLowerCase()
  const bt2020 = primaries === 'bt2020' && (matrix === 'bt2020-ncl' || matrix === 'bt2020-cl')
  if (tenBit && bt2020 && (transfer === 'smpte-st-2084' || transfer === 'smpte2084')) {
    return { dynamicRange: 'hdr10', bitDepth: 10, valid: true }
  }
  if (tenBit && bt2020 && transfer === 'arib-std-b67') {
    return { dynamicRange: 'hlg', bitDepth: 10, valid: true }
  }
  return { dynamicRange: 'sdr', bitDepth: tenBit ? 10 : 8, valid: false }
}

function processingCapabilities(): HDRProcessingCapabilities {
  const scope = globalThis as typeof globalThis & {
    MediaStreamTrackProcessor?: TrackProcessorConstructor
    VideoTrackGenerator?: unknown
  }
  return {
    trackProcessor: typeof scope.MediaStreamTrackProcessor === 'function',
    trackGenerator: typeof scope.VideoTrackGenerator === 'function',
    webGPU: typeof navigator !== 'undefined' && !!(navigator as Navigator & { gpu?: unknown }).gpu,
  }
}

function syntheticHDRFrame(): VideoFrame {
  const width = 64
  const height = 64
  const lumaSamples = width * height
  const chromaSamples = (width / 2) * (height / 2)
  const samples = new Uint16Array(lumaSamples + chromaSamples * 2)
  samples.fill(256)
  const BufferVideoFrame = VideoFrame as unknown as new (
    data: BufferSource,
    init: {
      format: string
      codedWidth: number
      codedHeight: number
      timestamp: number
      colorSpace: HDRFrameDescriptor & { fullRange: boolean }
    },
  ) => VideoFrame
  return new BufferVideoFrame(new Uint8Array(samples.buffer), {
    format: 'I010',
    codedWidth: width,
    codedHeight: height,
    timestamp: 0,
    colorSpace: {
      primaries: 'bt2020',
      transfer: 'smpte-st-2084',
      matrix: 'bt2020-ncl',
      fullRange: false,
    },
  })
}

async function probeCodec(config: typeof HDR_CODEC_CONFIGS[number]): Promise<HDRCodecProbe> {
  const result: HDRCodecProbe = {
    codec: config.codec,
    profile: config.profile,
    codecString: config.codecString,
    encoder: false,
    decoder: false,
    roundTrip: false,
  }
  if (typeof VideoEncoder === 'undefined' || typeof VideoDecoder === 'undefined' || typeof VideoFrame === 'undefined') {
    return result
  }
  const encoderConfig: VideoEncoderConfig = {
    codec: config.codecString,
    width: 64,
    height: 64,
    bitrate: 200_000,
    framerate: 1,
    hardwareAcceleration: 'prefer-hardware',
    latencyMode: 'realtime',
  }
  try {
    result.encoder = (await VideoEncoder.isConfigSupported(encoderConfig)).supported === true
    result.decoder = (await VideoDecoder.isConfigSupported({
      codec: config.codecString,
      hardwareAcceleration: 'prefer-hardware',
      optimizeForLatency: true,
    })).supported === true
  } catch {
    return result
  }
  if (!result.encoder || !result.decoder) return result

  const chunks: Array<{ chunk: EncodedVideoChunk; metadata?: EncodedVideoChunkMetadata }> = []
  const decoded: VideoFrame[] = []
  let codecFailed = false
  const encoder = new VideoEncoder({
    output: (chunk, metadata) => chunks.push({ chunk, metadata }),
    error: () => { codecFailed = true },
  })
  let decoder: VideoDecoder | null = null
  let input: VideoFrame | null = null
  try {
    input = syntheticHDRFrame()
    encoder.configure(encoderConfig)
    encoder.encode(input, { keyFrame: true })
    await encoder.flush()
    if (codecFailed || chunks.length === 0) return result
    decoder = new VideoDecoder({
      output: (frame) => decoded.push(frame),
      error: () => { codecFailed = true },
    })
    const decoderConfig = chunks[0]?.metadata?.decoderConfig ?? { codec: config.codecString }
    decoder.configure({ ...decoderConfig, hardwareAcceleration: 'prefer-hardware', optimizeForLatency: true })
    for (const value of chunks) decoder.decode(value.chunk)
    await decoder.flush()
    const frame = decoded[0]
    if (!codecFailed && frame) {
      result.roundTrip = classifyHDRFrame({
        format: frame.format,
        primaries: frame.colorSpace.primaries,
        transfer: frame.colorSpace.transfer,
        matrix: frame.colorSpace.matrix,
      }).valid
    }
  } catch {
    result.roundTrip = false
  } finally {
    input?.close()
    for (const frame of decoded) frame.close()
    if (encoder.state !== 'closed') encoder.close()
    if (decoder && decoder.state !== 'closed') decoder.close()
  }
  return result
}

export function detectHDRCapabilities(): Promise<HDRCapabilities> {
  if (cachedCapabilities) return cachedCapabilities
  cachedCapabilities = (async () => {
    const match = typeof window.matchMedia === 'function'
      ? (query: string) => window.matchMedia(query)
      : () => ({ matches: false })
    const output = detectHDROutputCapabilities(match)
    const processing = processingCapabilities()
    const codecs = await Promise.all(HDR_CODEC_CONFIGS.map(probeCodec))
    const codecProfiles = codecs
      .filter((codec) => codec.roundTrip)
      .map(({ codec, profile }) => ({ codec, profile }))
    const outputReady = output.dynamicRange === 'high' && output.gamut !== 'srgb'
    const processingReady = processing.trackProcessor && processing.trackGenerator && processing.webGPU
    const canPublishHDR = outputReady && processingReady && codecProfiles.length > 0
    const canViewHDR = outputReady && codecs.some((codec) => codec.decoder)
    const reason = !outputReady
      ? 'HDR-вывод или широкий цветовой охват не обнаружен'
      : !processingReady
        ? 'Браузер не поддерживает безопасную обработку HDR-кадров через WebGPU'
        : codecProfiles.length === 0
          ? '10-bit AV1/VP9 не прошёл локальную encode/decode проверку'
          : ''
    const result = { output, processing, codecs, codecProfiles, canPublishHDR, canViewHDR, reason }
    clientDiagnostics.record('media', 'hdr_capability_probe', canPublishHDR ? 'info' : 'debug', {
      output_range: output.dynamicRange,
      output_gamut: output.gamut,
      track_processor: processing.trackProcessor,
      track_generator: processing.trackGenerator,
      webgpu: processing.webGPU,
      codec_profiles: codecProfiles.map((value) => `${value.codec}:${value.profile}`),
      reason,
    })
    return result
  })()
  return cachedCapabilities
}

export async function probeCapturedHDRTrack(
  track: MediaStreamTrack,
  capabilities: HDRCapabilities,
  sampleCount = 3,
): Promise<HDRCaptureProbe> {
  const fallback: HDRCaptureProbe = {
    supported: false,
    sourceRange: 'sdr',
    codecProfile: null,
    bitDepth: 8,
    colorPrimaries: 'bt709',
    transfer: 'bt709',
    matrix: 'bt709',
    reason: capabilities.reason || 'Источник не предоставил подтверждённые HDR-кадры',
  }
  const scope = globalThis as typeof globalThis & { MediaStreamTrackProcessor?: TrackProcessorConstructor }
  if (!capabilities.canPublishHDR || !scope.MediaStreamTrackProcessor) return fallback
  const clone = track.clone()
  const reader = new scope.MediaStreamTrackProcessor({ track: clone }).readable.getReader()
  let detected: ReturnType<typeof classifyHDRFrame> | null = null
  try {
    for (let index = 0; index < sampleCount; index += 1) {
      const sample = await Promise.race([
        reader.read(),
        new Promise<ReadableStreamReadResult<VideoFrame>>((resolve) => {
          window.setTimeout(() => resolve({ done: true, value: undefined }), 1_500)
        }),
      ])
      if (sample.done || !sample.value) break
      const frame = sample.value
      const classification = classifyHDRFrame({
        format: frame.format,
        primaries: frame.colorSpace.primaries,
        transfer: frame.colorSpace.transfer,
        matrix: frame.colorSpace.matrix,
      })
      frame.close()
      if (classification.valid) {
        detected = classification
        break
      }
    }
  } catch {
    return fallback
  } finally {
    await reader.cancel().catch(() => undefined)
    clone.stop()
  }
  const codecProfile = capabilities.codecProfiles[0] ?? null
  if (!detected || !codecProfile) return fallback
  return {
    supported: true,
    sourceRange: detected.dynamicRange,
    codecProfile,
    bitDepth: 10,
    colorPrimaries: 'bt2020',
    transfer: detected.dynamicRange === 'hlg' ? 'hlg' : 'pq',
    matrix: 'bt2020-ncl',
    reason: '',
  }
}

export function rememberHDRCaptureProbe(stream: MediaStream, probe: HDRCaptureProbe) {
  captureProbes.set(stream, probe)
}

export function capturedHDRProbe(stream: MediaStream): HDRCaptureProbe | null {
  return captureProbes.get(stream) ?? null
}
