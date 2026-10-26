type Stat = RTCStats & Record<string, unknown>
const numeric = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : 0
export const mediaAttemptID = () => typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`

/** Interval counters, not lifetime loss percentages; never exports addresses. */
export class MediaQualityTracker {
  private previous = new Map<string, Stat>()

  sample(report: RTCStatsReport) {
    const intervalAvailable = this.previous.size > 0
    let lost = 0, received = 0, concealed = 0, audioSamples = 0, jitterDelay = 0, jitterCount = 0
    let decodeTime = 0, decoded = 0, freezes = 0, freezeDuration = 0
    let rtt: number | null = null
    let route = 'unknown', protocol = 'unknown', outgoing = 0
    const next = new Map<string, Stat>()
    const delta = (current: Stat, old: Stat | undefined, field: string) => old ? Math.max(0, numeric(current[field]) - numeric(old[field])) : 0
    report.forEach((raw) => {
      const value = raw as Stat
      const old = this.previous.get(value.id)
      if (value.type === 'transport' && typeof value.selectedCandidatePairId === 'string') {
        const pair = report.get(value.selectedCandidatePairId) as Stat | undefined
        if (pair) {
          if (typeof pair.currentRoundTripTime === 'number') rtt = numeric(pair.currentRoundTripTime) * 1000
          outgoing = numeric(pair.availableOutgoingBitrate) / 1000
          const local = report.get(String(pair.localCandidateId)) as Stat | undefined
          const remote = report.get(String(pair.remoteCandidateId)) as Stat | undefined
          route = local?.candidateType === 'relay' || remote?.candidateType === 'relay' ? 'relay' : 'direct'
          protocol = String(local?.protocol ?? remote?.protocol ?? 'unknown')
        }
      }
      if (value.type === 'remote-inbound-rtp' && typeof value.roundTripTime === 'number') rtt = Math.max(rtt ?? 0, numeric(value.roundTripTime) * 1000)
      if (value.type !== 'inbound-rtp') return
      next.set(value.id, value)
      lost += delta(value, old, 'packetsLost')
      received += delta(value, old, 'packetsReceived')
      concealed += delta(value, old, 'concealedSamples')
      audioSamples += delta(value, old, 'totalSamplesReceived')
      jitterDelay += delta(value, old, 'jitterBufferDelay')
      jitterCount += delta(value, old, 'jitterBufferEmittedCount')
      decodeTime += delta(value, old, 'totalDecodeTime')
      decoded += delta(value, old, 'framesDecoded')
      freezes += delta(value, old, 'freezeCount')
      freezeDuration += delta(value, old, 'totalFreezesDuration')
    })
    this.previous = next
    return {
      interval_available: intervalAvailable,
      rtt_ms: rtt === null ? null : Math.round(rtt), ice_route: route, ice_protocol: protocol,
      available_outgoing_kbps: Math.round(outgoing),
      packet_loss_percent: lost + received ? Math.round(lost / (lost + received) * 10_000) / 100 : null,
      concealed_audio_percent: audioSamples ? Math.min(100, Math.round(concealed / audioSamples * 10_000) / 100) : null,
      jitter_buffer_ms: jitterCount ? Math.round(jitterDelay / jitterCount * 1000) : null,
      decode_ms_per_frame: decoded ? Math.round(decodeTime / decoded * 100_000) / 100 : null,
      freezes, freeze_duration_ms: Math.round(freezeDuration * 1000),
    }
  }
}
