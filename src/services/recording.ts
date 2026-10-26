import type { ChannelRecording } from '../domain/types'
import { RecordingStore, downloadBlob, type LocalRecording } from './recordingStore'

export function recordingMIME() {
  if (!globalThis.MediaRecorder) return null
  // VP8 is widely hardware accelerated; don't force a costly software VP9 encoder.
  return ['video/webm;codecs=vp8,opus', 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/webm', 'video/mp4'].find((mime) => MediaRecorder.isTypeSupported(mime)) ?? null
}
type ProcessorConstructor = new (options: { track: MediaStreamTrack; maxBufferSize: number }) => { readable: ReadableStream<VideoFrame> }
type GeneratorConstructor = new (options: { kind: 'video' }) => { writable: WritableStream<VideoFrame>; track?: MediaStreamTrack }
class RecordingVideo {
  readonly track: MediaStreamTrack
  private worker?: Worker
  private processor?: ProcessorConstructor
  private clone?: MediaStreamTrack
  private source?: MediaStreamTrack
  private video?: HTMLVideoElement
  private timer?: number
  constructor(failed: () => void) {
    const scope = globalThis as typeof globalThis & { MediaStreamTrackProcessor?: ProcessorConstructor; MediaStreamTrackGenerator?: GeneratorConstructor }
    if (scope.MediaStreamTrackProcessor && scope.MediaStreamTrackGenerator && globalThis.OffscreenCanvas) {
      const generator = new scope.MediaStreamTrackGenerator({ kind: 'video' })
      this.track = generator.track ?? generator as unknown as MediaStreamTrack
      this.processor = scope.MediaStreamTrackProcessor
      this.worker = new Worker(new URL('./recordingVideo.worker.ts', import.meta.url), { type: 'module' })
      this.worker.onerror = failed
      this.worker.onmessage = ({ data }) => { if (data === 'error') failed() }
      this.worker.postMessage({ writable: generator.writable }, [generator.writable])
    } else {
      const canvas = document.createElement('canvas'); canvas.width = 1280; canvas.height = 720
      if (!canvas.captureStream) throw new Error('Запись видео недоступна в этом браузере')
      const context = canvas.getContext('2d', { alpha: false })!
      this.video = document.createElement('video'); this.video.muted = true; this.video.playsInline = true
      this.timer = window.setInterval(() => {
        context.fillStyle = '#16191f'; context.fillRect(0, 0, 1280, 720)
        const video = this.video!
        if (video.readyState >= 2 && video.videoWidth) {
          const scale = Math.min(1280 / video.videoWidth, 720 / video.videoHeight)
          const width = video.videoWidth * scale, height = video.videoHeight * scale
          context.drawImage(video, (1280 - width) / 2, (720 - height) / 2, width, height)
        } else {
          context.fillStyle = '#c3c9d4'; context.textAlign = 'center'; context.font = '32px sans-serif'
          context.fillText('Voxhold · голосовой канал', 640, 360)
        }
      }, 1000 / 24)
      this.track = canvas.captureStream(24).getVideoTracks()[0]!
    }
  }
  setStream(stream: MediaStream | null) {
    const track = stream?.getVideoTracks().find((item) => item.readyState === 'live')
    if (track === this.source) return
    this.source = track; this.clone?.stop(); this.clone = track?.clone()
    if (this.worker && this.processor) {
      const readable = this.clone ? new this.processor({ track: this.clone, maxBufferSize: 1 }).readable : undefined
      this.worker.postMessage({ readable, clear: !readable }, readable ? [readable] : [])
    } else if (this.video) {
      this.video.srcObject = this.clone ? new MediaStream([this.clone]) : null
      if (this.clone) void this.video.play().catch(() => undefined)
    }
  }
  close() {
    this.clone?.stop(); this.worker?.terminate(); this.track.stop()
    window.clearInterval(this.timer)
    if (this.video) { this.video.pause(); this.video.srcObject = null }
  }
}

/** Recording owns only generated tracks. It never changes/stops live call tracks. */
export class CallRecorder {
  private video: RecordingVideo
  private context: AudioContext
  private destination: MediaStreamAudioDestinationNode
  private compressor: DynamicsCompressorNode
  private sources = new Map<MediaStreamTrack, MediaStreamAudioSourceNode>()
  private recorder: MediaRecorder
  private pending = Promise.resolve()
  private pendingBytes = 0
  private tail: Blob[] = []
  private local: LocalRecording
  private started = performance.now()
  private finishing = false
  private finalized = false
  private stopped: Promise<LocalRecording>
  private finish!: (local: LocalRecording) => void
  constructor(private store: RecordingStore, record: ChannelRecording, mime: string, private changed: () => void, private warn: (message: string) => void, context?: AudioContext) {
    this.local = { key: store.key(record.id), scope: store.scope, record, bytes: 0, chunks: 0, duration: 0, finished: false }
    this.context = context ?? new AudioContext({ sampleRate: 48_000 })
    this.destination = this.context.createMediaStreamDestination()
    this.compressor = this.context.createDynamicsCompressor(); this.compressor.connect(this.destination)
    this.video = new RecordingVideo(() => { this.warn('Видеозапись прервана. Сохраняем доступную часть.'); void this.stop() })
    const media = new MediaStream([this.video.track, ...this.destination.stream.getAudioTracks()])
    try {
      this.recorder = new MediaRecorder(media, { mimeType: mime, videoBitsPerSecond: 1_200_000, audioBitsPerSecond: 96_000 })
    } catch (error) {
      this.video.close(); this.destination.stream.getTracks().forEach((track) => track.stop()); void this.context.close().catch(() => undefined)
      throw error
    }
    this.stopped = new Promise((resolve) => { this.finish = resolve })
    this.recorder.ondataavailable = ({ data }) => {
      if (!data.size) return
      this.pendingBytes += data.size
      this.pending = this.pending.then(async () => {
        // Keep unsaved chunks recoverable if storage fills, then stop promptly.
        if (this.local.error) { this.tail.push(data); return }
        const next = { ...this.local, bytes: this.local.bytes + data.size, chunks: this.local.chunks + 1 }
        try { await this.store.save(next, data); this.local = next }
        catch { this.tail.push(data); this.local.error = 'Локальное хранилище заполнено. Скачайте доступную часть перед закрытием страницы.'; this.warn(this.local.error); void this.stop() }
      }).finally(() => { this.pendingBytes -= data.size })
      if (this.pendingBytes > 16 << 20) { this.warn('Хранилище не успевает за записью. Сохраняем доступную часть.'); void this.stop() }
    }
    this.recorder.onerror = () => { this.warn('Браузер прервал запись. Сохраняем доступную часть.'); void this.stop() }
    this.recorder.onstop = () => { void this.finalize() }
  }
  async start() {
    await this.store.save(this.local)
    let timer = 0
    try {
      await Promise.race([
        this.context.resume(),
        new Promise<never>((_resolve, reject) => { timer = window.setTimeout(() => reject(new Error('Браузер блокирует звук записи. Нажмите запись ещё раз или проверьте разрешения звука.')), 5000) }),
      ])
    } finally { window.clearTimeout(timer) }
    this.started = performance.now()
    this.recorder.start(2000)
  }
  setSources(audio: MediaStreamTrack[], stream: MediaStream | null) {
    this.video.setStream(stream)
    const tracks = new Set([...audio, ...(stream?.getAudioTracks() ?? [])].filter((track) => track.readyState === 'live'))
    for (const [track, node] of this.sources) if (!tracks.has(track)) { node.disconnect(); this.sources.delete(track) }
    tracks.forEach((track) => {
      if (this.sources.has(track)) return
      const node = this.context.createMediaStreamSource(new MediaStream([track])); node.connect(this.compressor); this.sources.set(track, node)
    })
  }
  stop() {
    if (!this.finishing) {
      this.finishing = true
      if (this.recorder.state !== 'inactive') this.recorder.stop()
      else void this.finalize()
    }
    return this.stopped
  }
  private async finalize() {
    if (this.finalized) return
    this.finalized = true
    this.video.close(); this.sources.forEach((node) => node.disconnect()); this.sources.clear()
    this.compressor.disconnect(); this.destination.stream.getTracks().forEach((track) => track.stop()); void this.context.close().catch(() => undefined)
    await this.pending
    this.local = { ...this.local, duration: Math.min(86_400_000, Math.round(performance.now() - this.started)), finished: true }
    if (!this.local.bytes && !this.tail.length) {
      // Nothing was encoded: neither keep an empty entry nor download a 0-byte file.
      try { await this.store.remove(this.local.record.id) } catch { /* Only empty metadata remains. */ }
    } else {
      try { await this.store.save(this.local) } catch { /* Already reported, preserve the in-memory tail. */ }
      try { downloadBlob(await this.store.blob(this.local, this.tail), this.local.record) }
      catch { this.warn('Автоскачивание не удалось. Используйте список записей, пока эта вкладка открыта.') }
    }
    this.changed(); this.finish(this.local)
  }
  async download() { downloadBlob(await this.store.blob(this.local, this.tail), this.local.record) }
  dispose() { this.video.close(); this.sources.forEach((node) => node.disconnect()); this.destination.stream.getTracks().forEach((track) => track.stop()); void this.context.close().catch(() => undefined) }
}
