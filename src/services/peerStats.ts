interface CachedStats { report?: RTCStatsReport; sampledAt: number; pending?: Promise<RTCStatsReport> }
const samples = new WeakMap<RTCPeerConnection, CachedStats>()

/** Coalesce simultaneous quality/watchdog/diagnostic reads of one peer. */
export function readPeerStats(peer: RTCPeerConnection): Promise<RTCStatsReport> {
  const now = performance.now()
  let cached = samples.get(peer)
  if (cached?.pending) return cached.pending
  if (cached?.report && now - cached.sampledAt < 500) return Promise.resolve(cached.report)
  if (!cached) { cached = { sampledAt: 0 }; samples.set(peer, cached) }
  const entry = cached
  entry.pending = peer.getStats().then((report) => { entry.report = report; entry.sampledAt = performance.now(); return report }).finally(() => { entry.pending = undefined })
  return entry.pending
}
