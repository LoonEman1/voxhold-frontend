/**
 * Attaches the FEAT-13 worker to the senders and receivers of one
 * RTCPeerConnection. RTCRtpScriptTransform is used when present (and only on
 * audio); otherwise Chrome's insertable streams, where EVERY sender and
 * receiver of the connection must be piped, so video passes through as is.
 */
import type { SenderKeySink } from './senderKeys'
import type { TransformOptions, WorkerCommand, WorkerEvent, WorkerReply } from './frameProcessor'

export type E2EETransformMode = 'script' | 'streams'

interface EncodedStreams { readable: ReadableStream; writable: WritableStream }
type InsertableSender = RTCRtpSender & { createEncodedStreams?: () => EncodedStreams }
type InsertableReceiver = RTCRtpReceiver & { createEncodedStreams?: () => EncodedStreams }

/** null: this browser cannot encrypt voice end to end. */
export function e2eeTransformMode(): E2EETransformMode | null {
  if (typeof RTCRtpScriptTransform !== 'undefined') return 'script'
  if (typeof RTCRtpSender !== 'undefined' && 'createEncodedStreams' in RTCRtpSender.prototype) return 'streams'
  return null
}

export class E2EEMediaTransform implements SenderKeySink {
  private readonly worker: Worker
  private readonly attached = new WeakSet<object>()
  readonly ready: Promise<void>
  private nextRequest = 0
  private closed = false
  private failed: Error | null = null
  private readonly pending = new Map<number, { resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>()
  private onEvent: (event: WorkerEvent) => void
  private onError: (error: Error) => void = () => undefined
  private readyResolve!: () => void
  private readyReject!: (error: Error) => void
  private readonly startupTimer: ReturnType<typeof setTimeout>

  constructor(readonly mode: E2EETransformMode, onEvent: (event: WorkerEvent) => void = () => undefined) {
    this.onEvent = onEvent
    this.ready = new Promise<void>((resolve, reject) => { this.readyResolve = resolve; this.readyReject = reject })
    void this.ready.catch(() => undefined)
    this.worker = new Worker(new URL('./e2ee.worker.ts', import.meta.url), { type: 'module' })
    this.startupTimer = setTimeout(() => this.fail(new Error('E2EE worker did not start')), 5_000)
    this.worker.onerror = () => this.fail(new Error('E2EE worker failed'))
    this.worker.onmessageerror = () => this.fail(new Error('E2EE worker message failed'))
    this.worker.onmessage = ({ data }: MessageEvent<WorkerReply>) => {
      if (this.closed || this.failed) return
      if (data.type === 'ready') { clearTimeout(this.startupTimer); this.readyResolve() }
      else if (data.type === 'applied' || data.type === 'commandError') {
        const request = this.pending.get(data.id)
        if (!request) return
        clearTimeout(request.timer)
        this.pending.delete(data.id)
        if (data.type === 'applied') request.resolve()
        else request.reject(new Error('E2EE key installation failed'))
      } else this.onEvent(data)
    }
  }

  setHandlers(onEvent: (event: WorkerEvent) => void, onError: (error: Error) => void) { this.onEvent = onEvent; this.onError = onError }

  private fail(error: Error, report = true) {
    if (this.closed || this.failed) return
    this.failed = error
    this.worker.terminate()
    clearTimeout(this.startupTimer)
    this.readyReject(error)
    for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(error) }
    this.pending.clear()
    if (report) this.onError(error)
  }

  /** Insertable streams must be requested when the connection is created. */
  peerConfiguration(base: RTCConfiguration): RTCConfiguration {
    return this.mode === 'streams' ? { ...base, encodedInsertableStreams: true } as RTCConfiguration : base
  }

  private attach(target: InsertableSender | InsertableReceiver, options: TransformOptions) {
    if (this.attached.has(target)) return
    this.attached.add(target)
    if (this.mode === 'script') {
      if (options.kind === 'audio') target.transform = new RTCRtpScriptTransform(this.worker, options)
      return
    }
    const streams = target.createEncodedStreams?.()
    if (!streams) throw new Error('insertable streams are unavailable')
    this.worker.postMessage({ type: 'stream', readable: streams.readable, writable: streams.writable, options }, [streams.readable, streams.writable] as unknown as Transferable[])
  }

  attachSender(sender: RTCRtpSender, kind: 'audio' | 'video') { this.attach(sender, { role: 'send', kind }) }

  attachReceiver(receiver: RTCRtpReceiver, kind: 'audio' | 'video', receiverId: string) { this.attach(receiver, { role: 'recv', kind, receiverId }) }

  private send(command: WorkerCommand): Promise<void> {
    const request = new Promise<void>((resolve, reject) => {
      if (this.closed || this.failed) { reject(this.failed ?? new Error('E2EE worker is closed')); return }
      const id = ++this.nextRequest
      // A timed-out command may already have applied. Retrying it in this
      // worker could reset a replay window or IV counter: fail the worker.
      const timer = setTimeout(() => this.fail(new Error('E2EE worker command timed out')), 5_000)
      this.pending.set(id, { resolve, reject, timer })
      try { this.worker.postMessage({ type: 'command', id, command }) }
      catch { clearTimeout(timer); this.pending.delete(id); reject(new Error('E2EE worker command failed')) }
    })
    void request.catch(() => undefined)
    return request
  }

  mapReceiver(receiverId: string, senderId: string | null) { void this.send({ type: 'mapReceiver', receiverId, senderId }).catch((error: Error) => { if (!this.closed) this.onError(error) }) }

  setSendKey(keyId: number, key: Uint8Array<ArrayBuffer>) { return this.send({ type: 'sendKey', keyId, key }) }

  addReceiveKey(senderId: string, keyId: number, key: Uint8Array<ArrayBuffer>) { return this.send({ type: 'receiveKey', senderId, keyId, key }) }

  removeSender(senderId: string) { void this.send({ type: 'removeSender', senderId }).catch((error: Error) => { if (!this.closed) this.onError(error) }) }

  close() {
    if (this.closed) return
    this.fail(new Error('E2EE worker is closed'), false)
    this.closed = true
  }
}
