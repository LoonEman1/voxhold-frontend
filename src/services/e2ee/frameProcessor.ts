/**
 * Worker-side state of FEAT-13, free of worker globals so tests can drive it:
 * the sender key, the receive keys per (sender, key id), which receiver
 * belongs to which sender, key retirement and the "missing key" signal.
 */
import { FrameDecryptor, FrameEncryptor, deriveFrameKey, type DropReason } from './frameCipher'

export interface TransformOptions { role: 'send' | 'recv'; kind: 'audio' | 'video'; receiverId?: string }

export type WorkerCommand =
  | { type: 'sendKey'; keyId: number; key: Uint8Array<ArrayBuffer> }
  | { type: 'receiveKey'; senderId: string; keyId: number; key: Uint8Array<ArrayBuffer> }
  | { type: 'removeSender'; senderId: string }
  | { type: 'mapReceiver'; receiverId: string; senderId: string | null }

export type WorkerEvent =
  | { type: 'missingKey'; senderId: string }
  | { type: 'exhausted' }
  | { type: 'firstFrame'; direction: 'send' | 'recv' }
  | { type: 'stats'; encrypted: number; decrypted: number; dropped: Record<DropReason | 'no_key' | 'unmapped', number>; averageMicros: number }

export type WorkerRequest = { type: 'command'; id: number; command: WorkerCommand }
export type WorkerReply = WorkerEvent | { type: 'ready' } | { type: 'applied'; id: number } | { type: 'commandError'; id: number }

/** Receivers keep a superseded key this long for frames still in flight. */
export const KEY_RETIRE_MS = 10_000
/** Minimum interval between retries; the first missing-key request is immediate. */
export const MISSING_KEY_MS = 2_000
export const STATS_INTERVAL_MS = 15_000

interface SenderHealth { requestedAt: number }

export function createFrameProcessor(post: (event: WorkerEvent) => void, now: () => number = () => performance.now()) {
  const encryptor = new FrameEncryptor()
  const decryptor = new FrameDecryptor()
  const receivers = new Map<string, string>()
  const health = new Map<string, SenderHealth>()
  const latestKeyId = new Map<string, number>()
  const emptyDrops = () => ({ malformed: 0, unknown_key: 0, replay: 0, auth: 0, no_key: 0, unmapped: 0 })
  let stats = { encrypted: 0, decrypted: 0, dropped: emptyDrops(), micros: 0, timed: 0 }
  let exhaustedReported = false
  let sentFirst = false, receivedFirst = false

  const statsTimer = setInterval(() => {
    if (stats.encrypted + stats.decrypted + stats.timed === 0 && Object.values(stats.dropped).every((value) => value === 0)) return
    post({ type: 'stats', encrypted: stats.encrypted, decrypted: stats.decrypted, dropped: stats.dropped, averageMicros: stats.timed ? Math.round(stats.micros / stats.timed) : 0 })
    stats = { encrypted: 0, decrypted: 0, dropped: emptyDrops(), micros: 0, timed: 0 }
  }, STATS_INTERVAL_MS)

  function failed(senderId: string) {
    const entry = health.get(senderId) ?? { requestedAt: -Infinity }
    const at = now()
    if (at - entry.requestedAt >= MISSING_KEY_MS) {
      entry.requestedAt = at
      post({ type: 'missingKey', senderId })
    }
    health.set(senderId, entry)
  }

  async function apply(message: WorkerCommand) {
    switch (message.type) {
      case 'sendKey':
        encryptor.setKey(await deriveFrameKey(message.keyId, message.key))
        exhaustedReported = false
        break
      case 'receiveKey': {
        const derived = await deriveFrameKey(message.keyId, message.key)
        decryptor.setKey(message.senderId, derived)
        latestKeyId.set(message.senderId, message.keyId)
        // Older keys of this sender stay for frames in flight, then go.
        for (let keyId = 0; keyId < 8; keyId++) {
          if (keyId === message.keyId) continue
          setTimeout(() => { if (latestKeyId.get(message.senderId) !== keyId) decryptor.removeKey(message.senderId, keyId) }, KEY_RETIRE_MS)
        }
        break
      }
      case 'removeSender':
        decryptor.removeSender(message.senderId)
        latestKeyId.delete(message.senderId)
        health.delete(message.senderId)
        break
      case 'mapReceiver':
        if (message.senderId) receivers.set(message.receiverId, message.senderId)
        else receivers.delete(message.receiverId)
        break
    }
  }

  // Key derivation is asynchronous: run commands in order, or an older key
  // could land after a newer one (and a removal before a late install).
  let queue: Promise<void> = Promise.resolve()
  function command(message: WorkerCommand) {
    const run = queue.then(() => apply(message))
    queue = run.catch(() => undefined)
    return run
  }

  /** Returns the transformed frame, or null to drop it. */
  async function process(options: TransformOptions, data: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer> | null> {
    const started = now()
    if (options.role === 'send') {
      const sealed = await encryptor.encrypt(data)
      if (!sealed) {
        stats.dropped.no_key++
        if (encryptor.exhausted && !exhaustedReported) { exhaustedReported = true; post({ type: 'exhausted' }) }
        return null
      }
      stats.encrypted++
      if (sealed.length && !sentFirst) { sentFirst = true; post({ type: 'firstFrame', direction: 'send' }) }
      stats.micros += (now() - started) * 1000
      stats.timed++
      return sealed
    }
    const senderId = options.receiverId ? receivers.get(options.receiverId) : undefined
    if (!senderId) { stats.dropped.unmapped++; return null }
    const result = await decryptor.decrypt(senderId, data)
    if (typeof result === 'string') {
      stats.dropped[result]++
      if (result === 'unknown_key' || result === 'auth') failed(senderId)
      return null
    }
    stats.decrypted++
    if (result.length && !receivedFirst) { receivedFirst = true; post({ type: 'firstFrame', direction: 'recv' }) }
    stats.micros += (now() - started) * 1000
    stats.timed++
    return result
  }

  return { command, process, close: () => clearInterval(statsTimer) }
}
