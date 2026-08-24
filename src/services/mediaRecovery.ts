import { clientDiagnostics } from '../platform/clientDiagnostics'

export interface InboundVideoSample {
  timestamp: number
  bytesReceived?: number
  framesDecoded?: number
  keyFramesDecoded?: number
  packetsLost?: number
  nackCount?: number
  pliCount?: number
  freezeCount?: number
}

export interface DecodeWatchdogOptions {
  /** Pulls one inbound video stats snapshot; null when no video inbound-rtp exists yet. */
  getSample: () => Promise<InboundVideoSample | null>
  requestKeyframe?: () => void
  requestIceRestart?: () => void
  /** One bounded full session recreation (server-mode viewer). */
  requestFullRewatch?: () => void
  sampleIntervalMs?: number
  keyframeCooldownMs?: number
  iceCooldownMs?: number
  maxKeyframesPerWindow?: number
  keyframeWindowMs?: number
  bytesStallSamples?: number
  framesStallSamples?: number
  maxRewatches?: number
}

const SAMPLE_INTERVAL_MS = 2_000
const KEYFRAME_COOLDOWN_MS = 5_000
const ICE_COOLDOWN_MS = 15_000
const KEYFRAME_WINDOW_MS = 30_000
const MAX_KEYFRAMES_PER_WINDOW = 3
const BYTES_STALL_SAMPLES = 4
const FRAMES_STALL_SAMPLES = 3
const MAX_REWATCHES = 3

type WatchdogPhase = 'idle' | 'healthy' | 'keyframing' | 'ice_recovery' | 'rewatching' | 'exhausted'

/**
 * Bounded decoded-frame watchdog. RTP flowing but framesDecoded frozen leads
 * to keyframe requests, then an ICE recovery, then at most a few full session
 * recreations before surfacing an explicit error. Every counter resets as soon
 * as frames decode again; packetsLost alone never triggers recovery.
 */
export class DecodeWatchdog {
  private timer: ReturnType<typeof setInterval> | null = null
  private sampling = false
  private phase: WatchdogPhase = 'idle'
  private lastBytes: number | null = null
  private lastFrames: number | null = null
  private bytesStalled = 0
  private framesStalled = 0
  private keyframeTimestamps: number[] = []
  private lastKeyframeAt = 0
  private lastIceAt = 0
  private rewatches = 0
  private generation = 0

  constructor(private readonly options: DecodeWatchdogOptions) {}

  start() {
    if (this.timer !== null) return
    const interval = this.options.sampleIntervalMs ?? SAMPLE_INTERVAL_MS
    this.timer = setInterval(() => void this.tick(), interval)
    clientDiagnostics.record('media', 'stream_decode_watchdog_started', 'debug')
  }

  stop() {
    this.generation += 1
    if (this.timer !== null) clearInterval(this.timer)
    this.timer = null
    this.phase = 'idle'
  }

  /** A presented/decoded frame resets every stall sequence. */
  notifyFramePresented() {
    this.resetStalls()
  }

  phaseName() {
    return this.phase
  }

  private resetStalls() {
    this.bytesStalled = 0
    this.framesStalled = 0
    this.lastBytes = null
    this.lastFrames = null
    if (this.phase !== 'idle' && this.phase !== 'exhausted') this.phase = 'healthy'
  }

  private async tick() {
    if (this.sampling || typeof document === 'undefined' || document.visibilityState !== 'visible') return
    const generation = this.generation
    this.sampling = true
    let sample: InboundVideoSample | null = null
    try {
      sample = await this.options.getSample()
    } catch {
      sample = null
    } finally {
      this.sampling = false
    }
    // The session may have been closed while getStats was in flight.
    if (generation !== this.generation || this.timer === null) return
    if (!sample) return

    const now = sample.timestamp
    const bytes = typeof sample.bytesReceived === 'number' ? sample.bytesReceived : undefined
    const frames = typeof sample.framesDecoded === 'number' ? sample.framesDecoded : undefined

    // Feature detection: missing cumulative counters must not look like zeros.
    if (bytes === undefined && frames === undefined) return

    if (bytes !== undefined) {
      if (this.lastBytes !== null && bytes > this.lastBytes) {
        this.bytesStalled = 0
      } else if (this.lastBytes !== null) {
        this.bytesStalled += 1
      }
      this.lastBytes = bytes
    }

    if (frames !== undefined && this.lastFrames !== null && frames > this.lastFrames) {
      this.resetStalls()
      this.lastFrames = frames
      return
    }
    if (frames !== undefined) {
      this.framesStalled += 1
      this.lastFrames = frames
    }

    if ((bytes !== undefined ? this.bytesStalled : 0) >= (this.options.bytesStallSamples ?? BYTES_STALL_SAMPLES)) {
      this.triggerIceRecovery(now)
      return
    }
    if (this.framesStalled >= (this.options.framesStallSamples ?? FRAMES_STALL_SAMPLES)) {
      this.triggerKeyframe(now)
    }
  }

  private triggerKeyframe(now: number) {
    const window = this.options.keyframeWindowMs ?? KEYFRAME_WINDOW_MS
    const maxPerWindow = this.options.maxKeyframesPerWindow ?? MAX_KEYFRAMES_PER_WINDOW
    const cooldown = this.options.keyframeCooldownMs ?? KEYFRAME_COOLDOWN_MS
    this.keyframeTimestamps = this.keyframeTimestamps.filter((value) => now - value < window)
    if (now - this.lastKeyframeAt < cooldown) return
    if (this.keyframeTimestamps.length >= maxPerWindow) {
      this.triggerIceRecovery(now)
      return
    }
    this.lastKeyframeAt = now
    this.keyframeTimestamps.push(now)
    this.framesStalled = 0
    this.phase = 'keyframing'
    clientDiagnostics.record('media', 'stream_keyframe_requested', 'warn', {
      attempts_in_window: this.keyframeTimestamps.length,
    })
    this.options.requestKeyframe?.()
  }

  private triggerIceRecovery(now: number) {
    const cooldown = this.options.iceCooldownMs ?? ICE_COOLDOWN_MS
    if (now - this.lastIceAt < cooldown) return
    this.lastIceAt = now
    this.bytesStalled = 0
    this.framesStalled = 0
    this.keyframeTimestamps = []

    if (this.phase === 'ice_recovery' || this.phase === 'rewatching') {
      this.triggerFullRewatch()
      return
    }
    this.phase = 'ice_recovery'
    clientDiagnostics.record('media', 'stream_rtp_stalled', 'error', { recovery: 'ice_restart' })
    this.options.requestIceRestart?.()
  }

  private triggerFullRewatch() {
    if (this.rewatches >= (this.options.maxRewatches ?? MAX_REWATCHES)) {
      if (this.phase !== 'exhausted') {
        this.phase = 'exhausted'
        clientDiagnostics.record('media', 'stream_recovery_exhausted', 'error', {
          rewatches: this.rewatches,
        })
        this.stop()
      }
      return
    }
    this.rewatches += 1
    this.phase = 'rewatching'
    clientDiagnostics.record('media', 'stream_session_rewatch', 'warn', {
      attempt: this.rewatches,
    })
    this.options.requestFullRewatch?.()
  }
}

interface InboundVideoStatsLike extends RTCStats {
  kind?: string
  mediaType?: string
  isRemote?: boolean
  bytesReceived?: number
  framesDecoded?: number
  keyFramesDecoded?: number
  packetsLost?: number
  nackCount?: number
  pliCount?: number
  freezeCount?: number
}

/** Samples the first live inbound video stream from a getStats report. */
export async function sampleInboundVideoStats(
  peer: RTCPeerConnection,
): Promise<InboundVideoSample | null> {
  if (typeof peer.getStats !== 'function') return null
  const report = await peer.getStats()
  let result: InboundVideoSample | null = null
  report.forEach((raw) => {
    if (result) return
    const stats = raw as InboundVideoStatsLike
    if (
      stats.type !== 'inbound-rtp'
      || stats.isRemote
      || (stats.kind !== 'video' && stats.mediaType !== 'video')
    ) return
    result = {
      timestamp: stats.timestamp,
      bytesReceived: stats.bytesReceived,
      framesDecoded: stats.framesDecoded,
      keyFramesDecoded: stats.keyFramesDecoded,
      packetsLost: stats.packetsLost,
      nackCount: stats.nackCount,
      pliCount: stats.pliCount,
      freezeCount: stats.freezeCount,
    }
  })
  return result
}
