/**
 * Attaches the FEAT-13 worker to the senders and receivers of one
 * RTCPeerConnection. RTCRtpScriptTransform is used when present (and only on
 * audio); otherwise Chrome's insertable streams, where EVERY sender and
 * receiver of the connection must be piped, so video passes through as is.
 */
import type { SenderKeySink } from './senderKeys'
import type { TransformOptions, WorkerCommand, WorkerEvent } from './frameProcessor'

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

  constructor(readonly mode: E2EETransformMode, onEvent: (event: WorkerEvent) => void) {
    this.worker = new Worker(new URL('./e2ee.worker.ts', import.meta.url), { type: 'module' })
    this.worker.onmessage = ({ data }: MessageEvent<WorkerEvent>) => onEvent(data)
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

  private send(command: WorkerCommand) { this.worker.postMessage(command) }

  mapReceiver(receiverId: string, senderId: string | null) { this.send({ type: 'mapReceiver', receiverId, senderId }) }

  setSendKey(keyId: number, key: Uint8Array<ArrayBuffer>) { this.send({ type: 'sendKey', keyId, key }) }

  addReceiveKey(senderId: string, keyId: number, key: Uint8Array<ArrayBuffer>) { this.send({ type: 'receiveKey', senderId, keyId, key }) }

  removeSender(senderId: string) { this.send({ type: 'removeSender', senderId }) }

  close() { this.worker.terminate() }
}
