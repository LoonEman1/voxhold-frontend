import { readPeerStats } from './peerStats'

/** Detects a live transport whose encoder has stopped consuming capture frames. */
export class PublisherWatchdog {
  private timer: ReturnType<typeof setInterval> | null = null
  private generation = 0
  private sampling = false
  private recovering = false
  private frames: number | null = null
  private progressAt = 0
  constructor(private readonly peer: RTCPeerConnection, private readonly recover: () => Promise<void>, private readonly stallMs = 10_000) {}

  start() {
    if (this.timer !== null) return
    this.progressAt = performance.now()
    this.timer = setInterval(() => void this.sample(), 2_000)
  }
  stop() {
    this.generation++
    if (this.timer !== null) clearInterval(this.timer)
    this.timer = null
  }
  private async sample() {
    if (this.sampling || this.recovering || this.peer.connectionState !== 'connected') { this.progressAt = performance.now(); return }
    const generation = this.generation
    this.sampling = true
    try {
      const report = await readPeerStats(this.peer)
      if (generation !== this.generation || this.timer === null) return
      let frames: number | null = null
      report.forEach((raw) => {
        const stats = raw as RTCStats & { kind?: string; mediaType?: string; framesEncoded?: number; isRemote?: boolean }
        if (stats.type === 'outbound-rtp' && !stats.isRemote && (stats.kind === 'video' || stats.mediaType === 'video') && typeof stats.framesEncoded === 'number') frames = (frames ?? 0) + stats.framesEncoded
      })
      // Missing counters are a browser capability, not an encoder failure.
      if (frames === null) { this.progressAt = performance.now(); return }
      if (this.frames === null || frames !== this.frames) this.progressAt = performance.now()
      this.frames = frames
      if (performance.now() - this.progressAt < this.stallMs) return
      this.recovering = true
      try { await this.recover() } finally { this.progressAt = performance.now(); this.frames = null; this.recovering = false }
    } catch {
      // Transport/getStats failures are handled by the connection recovery path.
    } finally { this.sampling = false }
  }
}
