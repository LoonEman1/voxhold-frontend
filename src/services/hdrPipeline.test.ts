// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildHDRStreamRenditions, createHDRPublishPipeline, hlgToRelativeLinear, pqToRelativeLinear, toneMapRelativeToSDR } from './hdrPipeline'

const HDR_PROBE = {
  supported: true,
  sourceRange: 'hdr10' as const,
  codecProfile: { codec: 'av1' as const, profile: 'main10' },
  bitDepth: 10 as const,
  colorPrimaries: 'bt2020' as const,
  transfer: 'pq' as const,
  matrix: 'bt2020-ncl' as const,
  reason: '',
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('HDR publisher pipeline', () => {
  it('builds an SDR fallback before the HDR master rendition', () => {
    expect(buildHDRStreamRenditions('h264', HDR_PROBE)).toEqual([
      expect.objectContaining({ id: 'sdr', codec: 'h264', profile: 'baseline', dynamic_range: 'sdr', bit_depth: 8 }),
      expect.objectContaining({ id: 'hdr', codec: 'av1', profile: 'main10', dynamic_range: 'hdr10', bit_depth: 10 }),
    ])
  })

  it('keeps transfer and tone-map functions finite and monotonic', () => {
    const pq = [0, 0.25, 0.5, 0.75, 1].map(pqToRelativeLinear)
    const hlg = [0, 0.25, 0.5, 0.75, 1].map(hlgToRelativeLinear)
    const mapped = [0, 0.1, 1, 10, 100].map(toneMapRelativeToSDR)
    for (const values of [pq, hlg, mapped]) {
      expect(values.every(Number.isFinite)).toBe(true)
      expect(values).toEqual([...values].sort((left, right) => left - right))
    }
    expect(mapped[0]).toBe(0)
    expect(mapped.at(-1)).toBeLessThanOrEqual(1)
  })

  it('keeps at most one frame in the worker and fails closed on device loss', async () => {
    const inputFrames = [{ close: vi.fn() }, { close: vi.fn() }]
    const source = {
      kind: 'video',
      contentHint: '',
      clone: () => ({ stop: vi.fn() }),
      getSettings: () => ({ width: 64, height: 64 }),
    }
    const sdrTrack = { kind: 'video', contentHint: '', stop: vi.fn() }
    const processorStream = new ReadableStream<VideoFrame>({
      start(controller) {
        for (const frame of inputFrames) controller.enqueue(frame as unknown as VideoFrame)
      },
    })
    class FakeProcessor {
      readable = processorStream
    }
    class FakeGenerator {
      track = sdrTrack
      writable = new WritableStream<VideoFrame>()
    }
    class FakeMediaStream {
      constructor(readonly tracks: unknown[]) {}
      getVideoTracks() { return this.tracks.filter((track) => (track as { kind: string }).kind === 'video') }
      getAudioTracks() { return [] }
    }
    class FakeWorker {
      static latest: FakeWorker | null = null
      onmessage: ((event: MessageEvent) => void) | null = null
      onerror: (() => void) | null = null
      frameMessages: Array<{ frame: VideoFrame }> = []
      constructor() { FakeWorker.latest = this }
      postMessage(message: { type: string; frame?: VideoFrame }) {
        if (message.type === 'init') queueMicrotask(() => this.onmessage?.({ data: { type: 'ready' } } as MessageEvent))
        if (message.type === 'frame' && message.frame) this.frameMessages.push({ frame: message.frame })
      }
      terminate() {}
    }
    vi.stubGlobal('MediaStreamTrackProcessor', FakeProcessor)
    vi.stubGlobal('VideoTrackGenerator', FakeGenerator)
    vi.stubGlobal('MediaStream', FakeMediaStream)
    vi.stubGlobal('Worker', FakeWorker)
    const onFailure = vi.fn()
    const capture = new FakeMediaStream([source]) as unknown as MediaStream
    const pipeline = await createHDRPublishPipeline(capture, 'h264', HDR_PROBE, onFailure)
    await vi.waitFor(() => expect(FakeWorker.latest?.frameMessages).toHaveLength(1))
    const firstOutput = { close: vi.fn() } as unknown as VideoFrame
    FakeWorker.latest?.onmessage?.({ data: { type: 'frame', frame: firstOutput } } as MessageEvent)
    await vi.waitFor(() => expect(FakeWorker.latest?.frameMessages).toHaveLength(2))
    FakeWorker.latest?.onmessage?.({ data: { type: 'error', reason: 'WebGPU device was lost' } } as MessageEvent)
    expect(onFailure).toHaveBeenCalledWith(expect.objectContaining({ message: 'WebGPU device was lost' }))
    pipeline.close()
  })
})
