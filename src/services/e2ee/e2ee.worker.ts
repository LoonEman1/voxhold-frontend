/// <reference lib="webworker" />
/**
 * One worker per call connection encrypts outgoing and decrypts incoming
 * Opus frames (FEAT-13). Video frames pass through unchanged. No per-frame
 * logging: only counters, posted every 15 s.
 */
import { createFrameProcessor, type TransformOptions, type WorkerCommand } from './frameProcessor'

declare const self: DedicatedWorkerGlobalScope

type EncodedFrame = RTCEncodedAudioFrame | RTCEncodedVideoFrame

const processor = createFrameProcessor((message) => self.postMessage(message))

function pipe(readable: ReadableStream<EncodedFrame>, writable: WritableStream<EncodedFrame>, options: TransformOptions) {
  const transform = new TransformStream<EncodedFrame, EncodedFrame>({
    async transform(frame, controller) {
      if (options.kind !== 'audio') { controller.enqueue(frame); return }
      const data = await processor.process(options, new Uint8Array(frame.data))
      if (!data) return
      frame.data = data.buffer
      controller.enqueue(frame)
    },
  })
  void readable.pipeThrough(transform).pipeTo(writable).catch(() => undefined)
}

self.onmessage = ({ data }: MessageEvent<WorkerCommand | { type: 'stream'; readable: ReadableStream<EncodedFrame>; writable: WritableStream<EncodedFrame>; options: TransformOptions }>) => {
  if (data.type === 'stream') pipe(data.readable, data.writable, data.options)
  else void processor.command(data)
}

// RTCRtpScriptTransform (Firefox, Safari, recent Chrome).
self.onrtctransform = (event: RTCTransformEvent) => {
  const transformer = event.transformer
  pipe(transformer.readable as ReadableStream<EncodedFrame>, transformer.writable as WritableStream<EncodedFrame>, transformer.options as TransformOptions)
}
