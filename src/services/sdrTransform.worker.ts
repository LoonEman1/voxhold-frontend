/// <reference lib="webworker" />
import { isSDRFrame } from './videoColor'

interface TransformRequest {
  readable: ReadableStream<VideoFrame>
  writable: WritableStream<VideoFrame>
  idleRefreshMs: number
}

self.onmessage = async ({ data }: MessageEvent<TransformRequest>) => {
  let reader: ReadableStreamDefaultReader<VideoFrame> | undefined
  let writer: WritableStreamDefaultWriter<VideoFrame> | undefined
  let refresh: ReturnType<typeof setInterval> | undefined
  let writing = false
  let hasPicture = false
  let lastTimestamp = -Infinity
  let lastEmittedAt = 0
  let lastPicture: VideoFrame | null = null
  try {
    const canvas = new OffscreenCanvas(1, 1)
    const context = canvas.getContext('2d', { alpha: false, colorSpace: 'srgb' })
    if (!context) throw new Error('SDR canvas is unavailable in the worker')
    reader = data.readable.getReader()
    writer = data.writable.getWriter()
    const emit = async (timestamp: number, duration?: number) => {
      if (writing) return
      writing = true
      const output = new VideoFrame(lastPicture ?? canvas, { timestamp: Math.max(timestamp, lastTimestamp + 1), duration, alpha: 'discard' })
      lastTimestamp = output.timestamp
      lastEmittedAt = performance.now()
      try { await writer!.write(output) } finally { output.close(); writing = false }
    }
    self.postMessage({ type: 'ready' })
    refresh = setInterval(() => {
      const elapsed = performance.now() - lastEmittedAt
      if (hasPicture && !writing && elapsed >= data.idleRefreshMs) {
        void emit(lastTimestamp + Math.max(1, Math.round(elapsed * 1000))).catch(() => self.postMessage({ type: 'error', reason: 'SDR output stopped' }))
      }
    }, Math.max(50, data.idleRefreshMs / 2))
    while (true) {
      const { value: input, done } = await reader.read()
      if (done || !input) break
      try {
        if (writing) continue
        lastPicture?.close()
        lastPicture = null
        if (isSDRFrame(input)) {
          // VideoFrame retains the original image; no canvas draw/pixel copy.
          lastPicture = new VideoFrame(input)
        } else {
          const width = input.displayWidth || input.codedWidth
          const height = input.displayHeight || input.codedHeight
          if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height }
          context.drawImage(input, 0, 0, width, height)
        }
        hasPicture = true
        await emit(input.timestamp, input.duration ?? undefined)
      } finally { input.close() }
    }
    await writer.close()
  } catch (error) {
    self.postMessage({ type: 'error', reason: error instanceof Error ? error.message : 'SDR worker failed' })
  } finally {
    if (refresh !== undefined) clearInterval(refresh)
    lastPicture?.close()
    await reader?.cancel().catch(() => undefined)
  }
}
