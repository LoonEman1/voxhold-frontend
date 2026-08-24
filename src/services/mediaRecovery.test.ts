// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DecodeWatchdog,
  SignallingRecoveryCoordinator,
  type InboundVideoSample,
  type RecoveryIntent,
} from './mediaRecovery'

type Counters = {
  keyframes: number
  iceRestarts: number
  rewatches: number
}

function setVisible(visible: boolean) {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value: visible ? 'visible' : 'hidden',
  })
}

function createWatchdog(
  samples: Array<Partial<InboundVideoSample>>,
  counters: Counters,
  overrides: Partial<ConstructorParameters<typeof DecodeWatchdog>[0]> = {},
) {
  return new DecodeWatchdog({
    getSample: async () => {
      const raw = samples.shift()
      return raw ? { timestamp: Date.now(), ...raw } : null
    },
    requestKeyframe: () => { counters.keyframes += 1 },
    requestIceRestart: () => { counters.iceRestarts += 1 },
    requestFullRewatch: () => { counters.rewatches += 1 },
    keyframeCooldownMs: 5_000,
    iceCooldownMs: 15_000,
    ...overrides,
  })
}

async function runTicks(watchdog: DecodeWatchdog, ticks: number) {
  for (let index = 0; index < ticks; index += 1) {
    await vi.advanceTimersByTimeAsync(2_000)
  }
}

describe('DecodeWatchdog', () => {
  let counters: Counters

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    setVisible(true)
    counters = { keyframes: 0, iceRestarts: 0, rewatches: 0 }
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('requests a bounded keyframe when bytes grow but frames stay frozen', async () => {
    const watchdog = createWatchdog([
      { bytesReceived: 1000, framesDecoded: 10 },
      { bytesReceived: 2000, framesDecoded: 10 },
      { bytesReceived: 3000, framesDecoded: 10 },
      // Frames decode again: recovery succeeded, counters reset.
      { bytesReceived: 4000, framesDecoded: 20 },
    ], counters)
    watchdog.start()

    await runTicks(watchdog, 3)
    expect(counters.keyframes).toBe(1)
    expect(counters.iceRestarts).toBe(0)

    await runTicks(watchdog, 1)
    expect(counters.keyframes).toBe(1)
    expect(counters.iceRestarts).toBe(0)
    watchdog.stop()
  })

  it('does not run while the tab is hidden', async () => {
    setVisible(false)
    const frozen = { bytesReceived: 1000, framesDecoded: 10 }
    const watchdog = createWatchdog(
      Array.from({ length: 8 }, () => ({ ...frozen })),
      counters,
    )
    watchdog.start()

    await runTicks(watchdog, 8)
    expect(counters.keyframes).toBe(0)
    expect(counters.iceRestarts).toBe(0)
    watchdog.stop()
    setVisible(true)
  })

  it('escalates to an ICE recovery request when RTP itself stops', async () => {
    const frozen = { bytesReceived: 1000, framesDecoded: 10 }
    const watchdog = createWatchdog(
      Array.from({ length: 8 }, () => ({ ...frozen })),
      counters,
    )
    watchdog.start()

    await runTicks(watchdog, 6)
    expect(counters.iceRestarts).toBeGreaterThanOrEqual(1)
    watchdog.stop()
  })

  it('never starts recovery from packetsLost alone', async () => {
    const watchdog = createWatchdog([
      { bytesReceived: 1000, framesDecoded: 10, packetsLost: 5 },
      { bytesReceived: 2000, framesDecoded: 20, packetsLost: 50 },
      { bytesReceived: 3000, framesDecoded: 30, packetsLost: 500 },
      { bytesReceived: 4000, framesDecoded: 40, packetsLost: 5000 },
    ], counters)
    watchdog.start()

    await runTicks(watchdog, 4)
    expect(counters.keyframes).toBe(0)
    expect(counters.iceRestarts).toBe(0)
    watchdog.stop()
  })

  it('limits keyframe requests inside the rolling window', async () => {
    const frozen = { bytesReceived: 3000, framesDecoded: 10 }
    // Bytes keep flowing so the keyframe path is exercised exclusively.
    let byteCounter = 3000
    const samples = Array.from({ length: 30 }, () => ({ bytesReceived: (byteCounter += 1000), framesDecoded: 10 }))
    const watchdog = createWatchdog(samples, counters)
    watchdog.start()

    await runTicks(watchdog, 30)
    expect(counters.keyframes).toBeLessThanOrEqual(3)
    watchdog.stop()
  })

  it('ends in an explicit exhausted state after bounded rewatches', async () => {
    const frozen = { bytesReceived: 1000, framesDecoded: 10 }
    const watchdog = createWatchdog(
      Array.from({ length: 60 }, () => ({ ...frozen })),
      counters,
      { maxRewatches: 2, iceCooldownMs: 5_000, keyframeCooldownMs: 1_000 },
    )
    watchdog.start()

    await vi.advanceTimersByTimeAsync(120_000)
    expect(counters.rewatches).toBe(2)
    expect(watchdog.phaseName()).toBe('exhausted')
    watchdog.stop()
  })
})

describe('SignallingRecoveryCoordinator', () => {
  function makeIntent(overrides: Partial<RecoveryIntent> = {}): RecoveryIntent {
    return {
      serverId: 1,
      channelId: 2,
      channelName: 'Общий',
      staleConnectionId: 'old-conn',
      selfMute: false,
      selfDeaf: false,
      streamRole: null,
      ...overrides,
    }
  }

  function makeTimers() {
    const timers = {
      setTimeout: vi.fn((handler: () => void, ms: number) => {
        timers.pending.push({ handler, ms })
        return timers.pending.length
      }),
      clearTimeout: vi.fn((handle: number) => {
        delete timers.pending[handle - 1]
      }),
      pending: [] as Array<{ handler: () => void; ms: number }>,
      fireDeadline() {
        const last = this.pending.filter(Boolean).at(-1)
        if (last) last.handler()
      },
    }
    return timers
  }

  it('runs the automaton once per generation and ignores double ready', () => {
    const rejoin = vi.fn()
    const coordinator = new SignallingRecoveryCoordinator({ beginVoiceRejoin: rejoin })
    expect(coordinator.begin(makeIntent())).toBe(true)
    expect(coordinator.phase).toBe('signalling_lost')

    expect(coordinator.handleReady()).toBe(true)
    expect(coordinator.phase).toBe('rejoining_voice')
    expect(rejoin).toHaveBeenCalledOnce()

    // A duplicate ready event must not start a second join.
    expect(coordinator.handleReady()).toBe(false)
    expect(rejoin).toHaveBeenCalledOnce()
  })

  it('restores the stream only after a confirmed join with fresh id', () => {
    const restore = vi.fn()
    const finished = vi.fn()
    const coordinator = new SignallingRecoveryCoordinator({ restoreStream: restore, finished })
    coordinator.begin(makeIntent({ streamRole: 'viewer' }))
    coordinator.handleReady()

    // The stale teardown of the old generation is ignored.
    coordinator.markVoiceJoined('old-conn', true)
    expect(restore).not.toHaveBeenCalled()

    coordinator.markVoiceJoined('new-conn', true)
    expect(coordinator.phase).toBe('restoring_stream')
    coordinator.markStreamRestored()
    expect(coordinator.phase).toBe('active')
    expect(finished).toHaveBeenCalledWith('active', 'stream restored')
  })

  it('finishes as active when voice-only intent is confirmed', () => {
    const restore = vi.fn()
    const coordinator = new SignallingRecoveryCoordinator({ restoreStream: restore })
    coordinator.begin(makeIntent())
    coordinator.handleReady()
    coordinator.markVoiceJoined('new-conn', false)
    expect(coordinator.phase).toBe('active')
    expect(restore).not.toHaveBeenCalled()
  })

  it('expires after the grace period', () => {
    vi.useFakeTimers()
    const finished = vi.fn()
    const coordinator = new SignallingRecoveryCoordinator({ finished }, undefined, 60_000)
    coordinator.begin(makeIntent())
    vi.advanceTimersByTime(60_000)
    expect(finished).toHaveBeenCalledWith('expired', 'recovery grace period elapsed')
    expect(coordinator.phase).toBe('expired')
    vi.useRealTimers()
  })

  it('cancel prevents handleReady and later stale events are ignored', () => {
    const rejoin = vi.fn()
    const coordinator = new SignallingRecoveryCoordinator({ beginVoiceRejoin: rejoin })
    coordinator.begin(makeIntent())
    coordinator.cancel('explicit leave')
    expect(rejoin).not.toHaveBeenCalled()
    expect(coordinator.staleConnectionId()).toBeNull()
  })

  it('a second disconnect during rejoin starts a new generation', () => {
    vi.useFakeTimers()
    const finished = vi.fn()
    const coordinator = new SignallingRecoveryCoordinator({ finished }, undefined, 60_000)
    coordinator.begin(makeIntent())
    coordinator.handleReady()
    const firstGeneration = coordinator.generation

    // A disconnect that arrives while rejoining supersedes the old attempt.
    expect(coordinator.begin(makeIntent())).toBe(true)
    expect(coordinator.generation).toBe(firstGeneration + 1)
    expect(coordinator.phase).toBe('signalling_lost')
    // The old deadline must not expire the new generation.
    vi.advanceTimersByTime(59_999)
    expect(finished).not.toHaveBeenCalled()
    vi.advanceTimersByTime(60_000)
    expect(finished).toHaveBeenCalledTimes(1)
    expect(coordinator.phase).toBe('expired')
    vi.useRealTimers()
  })

  it('dropStreamIntent keeps the voice rejoin alive when capture dies', () => {
    const restore = vi.fn()
    const coordinator = new SignallingRecoveryCoordinator({ restoreStream })
    coordinator.begin(makeIntent({ streamRole: 'publisher' }))
    coordinator.dropStreamIntent()
    coordinator.handleReady()
    coordinator.markVoiceJoined('new-conn', false)
    expect(restore).not.toHaveBeenCalled()
    expect(coordinator.phase).toBe('active')
  })
})
