import { describe, expect, it } from 'vitest'
import { MediaQualityTracker } from './mediaQuality'

function report(received: number, lost: number, concealed: number, samples: number) {
  return new Map([
    ['audio', { id: 'audio', type: 'inbound-rtp', packetsReceived: received, packetsLost: lost, concealedSamples: concealed, totalSamplesReceived: samples, jitterBufferDelay: received * 0.02, jitterBufferEmittedCount: received }],
    ['transport', { id: 'transport', type: 'transport', selectedCandidatePairId: 'pair' }],
    ['pair', { id: 'pair', type: 'candidate-pair', currentRoundTripTime: 0.08, availableOutgoingBitrate: 6_000_000, localCandidateId: 'local', remoteCandidateId: 'remote' }],
    ['local', { id: 'local', type: 'local-candidate', candidateType: 'relay', protocol: 'tcp', address: 'private.example' }],
    ['remote', { id: 'remote', type: 'remote-candidate', candidateType: 'host', address: 'private.example' }],
  ]) as unknown as RTCStatsReport
}

describe('media quality intervals', () => {
  it('calculates loss and concealed audio over an interval and omits addresses', () => {
    const tracker = new MediaQualityTracker()
    tracker.sample(report(100, 50, 10_000, 50_000))
    const quality = tracker.sample(report(199, 51, 10_480, 98_000))
    expect(quality).toMatchObject({ packet_loss_percent: 1, concealed_audio_percent: 1, rtt_ms: 80, jitter_buffer_ms: 20, ice_route: 'relay', ice_protocol: 'tcp', available_outgoing_kbps: 6000 })
    expect(JSON.stringify(quality)).not.toContain('private.example')
  })

  it('does not report negative loss when cumulative counters reset', () => {
    const tracker = new MediaQualityTracker()
    tracker.sample(report(200, 50, 10_000, 50_000))
    expect(tracker.sample(report(1, 0, 0, 0)).packet_loss_percent).toBeNull()
  })
})
