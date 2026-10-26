import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => vi.unstubAllGlobals())

describe('SDR worker frame ownership and backpressure', () => {
  it('passes SDR frames without drawing, converts an HDR surface switch and closes every input', async () => {
    const drawImage = vi.fn()
    const scope = { onmessage: null as unknown as (event: MessageEvent) => Promise<void>, postMessage: vi.fn() }
    class Canvas {
      width = 1
      height = 1
      getContext() { return { drawImage } }
    }
    class Frame {
      readonly tag: string
      readonly format: string
      readonly colorSpace: { primaries: string; transfer: string; matrix: string }
      readonly timestamp: number
      readonly duration = null
      readonly displayWidth = 640
      readonly displayHeight = 360
      close = vi.fn()
      constructor(source: string | Frame | Canvas, options?: VideoFrameInit) {
        this.tag = typeof source === 'string' ? source : source instanceof Frame ? source.tag : 'converted'
        this.format = this.tag === 'hdr' ? 'I010' : 'I420'
        this.colorSpace = this.tag === 'hdr' ? { primaries: 'bt2020', transfer: 'smpte-st-2084', matrix: 'bt2020-ncl' } : { primaries: 'bt709', transfer: 'bt709', matrix: 'bt709' }
        this.timestamp = options?.timestamp ?? (source instanceof Frame ? source.timestamp : 1000)
      }
    }
    vi.stubGlobal('self', scope)
    vi.stubGlobal('OffscreenCanvas', Canvas)
    vi.stubGlobal('VideoFrame', Frame)
    await import('./sdrTransform.worker')
    const inputs = [new Frame('sdr'), new Frame('hdr'), new Frame('sdr')]
    const readable = new ReadableStream({ start(controller) { inputs.forEach((frame) => controller.enqueue(frame)); controller.close() } })
    const writes: string[] = []
    const writable = new WritableStream<Frame>({ write(frame) { writes.push(frame.tag) } })
    await scope.onmessage({ data: { readable, writable, idleRefreshMs: 500 } } as MessageEvent)
    expect(writes).toEqual(['sdr', 'converted', 'sdr'])
    expect(drawImage).toHaveBeenCalledOnce()
    for (const input of inputs) expect(input.close).toHaveBeenCalledOnce()
    expect(scope.postMessage).toHaveBeenCalledWith({ type: 'ready' })
  })
})
