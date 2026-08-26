// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildHDRStreamRenditions,
  buildSDRStreamRenditions,
  createHDRPublishPipeline,
  createSDRPublishPipeline,
} from './hdrPipeline'

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

class FakeMediaStream {
  constructor(readonly tracks: Array<{ kind: string; stop?: () => void }> = []) {}
  getTracks() { return [...this.tracks] }
  getVideoTracks() { return this.tracks.filter((track) => track.kind === 'video') }
  getAudioTracks() { return this.tracks.filter((track) => track.kind === 'audio') }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function installCanvasCaptureMocks() {
  const playbackTrack = { kind: 'video', stop: vi.fn() }
  const outputTrack = { kind: 'video', contentHint: '', stop: vi.fn() }
  const audioTrack = { kind: 'audio', stop: vi.fn() }
  const source = {
    kind: 'video',
    clone: vi.fn(() => playbackTrack),
    getSettings: () => ({ width: 1280, height: 720, frameRate: 30 }),
  }
  const capture = new FakeMediaStream([source, audioTrack]) as unknown as MediaStream
  const drawImage = vi.fn()
  const nativeCreateElement = document.createElement.bind(document)
  const video = nativeCreateElement('video')
  Object.defineProperty(video, 'readyState', { configurable: true, value: HTMLMediaElement.HAVE_CURRENT_DATA })
  Object.defineProperty(video, 'srcObject', { configurable: true, writable: true, value: null })
  video.play = vi.fn(async () => undefined)
  video.pause = vi.fn()
  video.requestVideoFrameCallback = vi.fn(() => 17)
  video.cancelVideoFrameCallback = vi.fn()
  const canvas = nativeCreateElement('canvas')
  canvas.getContext = vi.fn(() => ({ drawImage })) as unknown as typeof canvas.getContext
  canvas.captureStream = vi.fn(() => new FakeMediaStream([outputTrack]) as unknown as MediaStream)
  vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
    if (tagName === 'video') return video
    if (tagName === 'canvas') return canvas
    return nativeCreateElement(tagName)
  })
  vi.stubGlobal('MediaStream', FakeMediaStream)
  return { capture, source, playbackTrack, outputTrack, audioTrack, drawImage, video }
}

describe('publisher color pipelines', () => {
  it('declares a real BT.709 rendition for every SDR codec', () => {
    expect(buildSDRStreamRenditions('h264')).toEqual([
      {
        id: 'sdr',
        codec: 'h264',
        profile: 'baseline',
        dynamic_range: 'sdr',
        bit_depth: 8,
        color_primaries: 'bt709',
        transfer: 'bt709',
        matrix: 'bt709',
      },
    ])
  })

  it('builds an SDR fallback before the HDR master rendition', () => {
    expect(buildHDRStreamRenditions('h264', HDR_PROBE)).toEqual([
      expect.objectContaining({ id: 'sdr', codec: 'h264', profile: 'baseline', dynamic_range: 'sdr', bit_depth: 8 }),
      expect.objectContaining({ id: 'hdr', codec: 'av1', profile: 'main10', dynamic_range: 'hdr10', bit_depth: 10 }),
    ])
  })

  it('renders the captured screen into an sRGB canvas track and preserves audio', async () => {
    const mocks = installCanvasCaptureMocks()
    const pipeline = await createSDRPublishPipeline(mocks.capture, 'h264')

    expect(mocks.source.clone).toHaveBeenCalledOnce()
    expect(mocks.drawImage).toHaveBeenCalled()
    expect(pipeline.stream.getVideoTracks()).toEqual([mocks.outputTrack])
    expect(pipeline.stream.getAudioTracks()).toEqual([mocks.audioTrack])
    expect(mocks.outputTrack.contentHint).toBe('detail')

    pipeline.close()
    expect(mocks.playbackTrack.stop).toHaveBeenCalledOnce()
    expect(mocks.outputTrack.stop).toHaveBeenCalledOnce()
    expect(mocks.video.cancelVideoFrameCallback).toHaveBeenCalledWith(17)
    expect(mocks.video.pause).toHaveBeenCalled()
  })

  it('fails closed when a browser cannot produce a canvas capture track', async () => {
    const playbackTrack = { kind: 'video', stop: vi.fn() }
    const source = {
      kind: 'video',
      clone: () => playbackTrack,
      getSettings: () => ({ width: 1280, height: 720, frameRate: 30 }),
    }
    const capture = new FakeMediaStream([source]) as unknown as MediaStream
    const nativeCreateElement = document.createElement.bind(document)
    const canvas = nativeCreateElement('canvas')
    canvas.getContext = vi.fn(() => ({ drawImage: vi.fn() })) as unknown as typeof canvas.getContext
    Object.defineProperty(canvas, 'captureStream', { configurable: true, value: undefined })
    vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => (
      tagName === 'canvas' ? canvas : nativeCreateElement(tagName)
    ))

    await expect(createSDRPublishPipeline(capture, 'h264'))
      .rejects.toThrow('Браузер не поддерживает безопасное HDR → SDR преобразование экрана')
    expect(playbackTrack.stop).toHaveBeenCalledOnce()
  })

  it('publishes the normalized SDR track alongside the untouched HDR master', async () => {
    const mocks = installCanvasCaptureMocks()
    const pipeline = await createHDRPublishPipeline(mocks.capture, 'h264', HDR_PROBE)

    expect(pipeline.stream.getVideoTracks()).toEqual([mocks.outputTrack, mocks.source])
    expect(pipeline.renditions.map((item) => item.id)).toEqual(['sdr', 'hdr'])
    pipeline.close()
  })
})
