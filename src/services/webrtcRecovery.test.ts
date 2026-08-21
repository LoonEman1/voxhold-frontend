// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WebRTCRecoveryController, remoteDescriptionAcceptsCandidate } from './webrtcRecovery'

describe('WebRTCRecoveryController', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('cancels delayed recovery when the connection returns', async () => {
    const attempt = vi.fn()
    const exhausted = vi.fn()
    const controller = new WebRTCRecoveryController([2000, 5000])
    controller.start(false, attempt, exhausted)
    await vi.advanceTimersByTimeAsync(1000)
    controller.stop()
    await vi.advanceTimersByTimeAsync(10000)
    expect(attempt).not.toHaveBeenCalled()
    expect(exhausted).not.toHaveBeenCalled()
  })

  it('retries immediately after a hard failure and eventually exhausts', async () => {
    const attempt = vi.fn()
    const exhausted = vi.fn()
    const controller = new WebRTCRecoveryController([2000, 5000, 10000])
    controller.start(true, attempt, exhausted)
    await vi.runAllTimersAsync()
    expect(attempt).toHaveBeenCalledTimes(3)
    expect(exhausted).toHaveBeenCalledOnce()
  })

  it('can recover during the grace period after the final attempt', async () => {
    const attempt = vi.fn()
    const exhausted = vi.fn()
    const controller = new WebRTCRecoveryController([0], 10000)
    controller.start(true, attempt, exhausted)
    await vi.advanceTimersByTimeAsync(0)
    expect(attempt).toHaveBeenCalledOnce()
    controller.stop()
    await vi.advanceTimersByTimeAsync(10000)
    expect(exhausted).not.toHaveBeenCalled()
  })
})

describe('remoteDescriptionAcceptsCandidate', () => {
  it('rejects a candidate from the previous ICE generation', () => {
    const peer = {
      remoteDescription: { sdp: 'v=0\r\na=ice-ufrag:new-generation\r\n' },
    } as RTCPeerConnection
    expect(remoteDescriptionAcceptsCandidate(peer, {
      username_fragment: 'old-generation',
    })).toBe(false)
    expect(remoteDescriptionAcceptsCandidate(peer, {
      username_fragment: 'new-generation',
    })).toBe(true)
  })
})
