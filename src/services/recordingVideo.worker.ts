/// <reference lib="webworker" />
export {}
let reader: ReadableStreamDefaultReader<VideoFrame> | null = null
let writer: WritableStreamDefaultWriter<VideoFrame> | null = null
let generation = 0
let writing = false
let lastDraw = -Infinity
let started = 0
const canvas = new OffscreenCanvas(1280, 720)
const context = canvas.getContext('2d', { alpha: false })!
function placeholder() {
  context.fillStyle = '#16191f'; context.fillRect(0, 0, 1280, 720)
  context.fillStyle = '#c3c9d4'; context.textAlign = 'center'; context.font = '32px sans-serif'
  context.fillText('Voxhold · голосовой канал', 640, 360)
}
placeholder()
self.onmessage = async ({ data }: MessageEvent<{ writable?: WritableStream<VideoFrame>; readable?: ReadableStream<VideoFrame>; clear?: boolean }>) => {
  if (data.writable) {
    writer = data.writable.getWriter(); started = performance.now()
    setInterval(() => {
      if (!writer || writing) return
      writing = true
      const frame = new VideoFrame(canvas, { timestamp: Math.round((performance.now() - started) * 1000), alpha: 'discard' })
      void writer.write(frame).catch(() => self.postMessage('error')).finally(() => { frame.close(); writing = false })
    }, 1000 / 24)
    self.postMessage('ready')
    return
  }
  const version = ++generation
  await reader?.cancel().catch(() => undefined)
  reader = null
  if (version !== generation) return
  placeholder()
  if (!data.readable) return
  const current = data.readable.getReader(); reader = current
  try {
    while (version === generation) {
      const { value: frame, done } = await current.read()
      if (done || !frame) break
      try {
        const now = performance.now()
        if (version !== generation || now - lastDraw < 1000 / 24) continue
        const scale = Math.min(1280 / frame.displayWidth, 720 / frame.displayHeight)
        const width = Math.round(frame.displayWidth * scale), height = Math.round(frame.displayHeight * scale)
        context.fillStyle = '#000'; context.fillRect(0, 0, 1280, 720)
        context.drawImage(frame, (1280 - width) / 2, (720 - height) / 2, width, height)
        lastDraw = now
      } finally { frame.close() }
    }
  } catch { /* Source replacement cancels the previous reader. */ }
  finally { await current.cancel().catch(() => undefined) }
}
