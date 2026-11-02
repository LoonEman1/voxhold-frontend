import { IV_BYTES, MAX_COUNTER, ReplayWindow, TAG_BYTES, frameIV, headerLength, readHeader, writeHeader } from './frame'

const encoder = new TextEncoder()
const NO_SALT = new Uint8Array(0)
const KEY_INFO = encoder.encode('voxhold-e2ee-v1 frame key')
const SALT_INFO = encoder.encode('voxhold-e2ee-v1 frame salt')

export interface FrameKey { keyId: number; key: CryptoKey; salt: Uint8Array }

/** Derives the AES-GCM key and IV salt from a 32-byte sender key once. */
export async function deriveFrameKey(keyId: number, raw: Uint8Array<ArrayBuffer>): Promise<FrameKey> {
  if (raw.length !== 32) throw new Error('sender key must be 32 bytes')
  const base = await crypto.subtle.importKey('raw', raw, 'HKDF', false, ['deriveKey', 'deriveBits'])
  const [key, salt] = await Promise.all([
    crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: NO_SALT, info: KEY_INFO }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']),
    crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: NO_SALT, info: SALT_INFO }, base, IV_BYTES * 8),
  ])
  return { keyId, key, salt: new Uint8Array(salt) }
}

export type DropReason = 'malformed' | 'unknown_key' | 'replay' | 'auth'

/**
 * Encrypts outgoing frames with the current sender key. The counter of a key
 * only grows, so a (key, IV) pair is never reused; reaching MAX_COUNTER stops
 * encryption (frames are dropped, never sent in clear) until a new key is set.
 */
export class FrameEncryptor {
  private current: FrameKey | null = null
  private counter = 0
  private readonly iv = new Uint8Array(IV_BYTES)

  setKey(key: FrameKey) {
    this.current = key
    this.counter = 0
  }

  get exhausted() { return this.counter >= MAX_COUNTER }

  /** Returns the encrypted frame, or null when it must be dropped. */
  async encrypt(frame: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer> | null> {
    const key = this.current
    if (!key || this.counter >= MAX_COUNTER) return null
    if (frame.length === 0) return new Uint8Array(0)
    const counter = this.counter++
    const prefix = 1 + headerLength(counter)
    const output = new Uint8Array(prefix + frame.length - 1 + TAG_BYTES)
    output[0] = frame[0] as number
    writeHeader(output, 1, key.keyId, counter)
    const sealed = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: frameIV(key.salt, counter, this.iv), additionalData: output.subarray(0, prefix), tagLength: TAG_BYTES * 8 },
      key.key,
      frame.subarray(1),
    )
    output.set(new Uint8Array(sealed), prefix)
    return output
  }
}

interface ReceiveKey extends FrameKey { window: ReplayWindow }

/** Decrypts frames of many senders, keyed by (sender, key id). */
export class FrameDecryptor {
  private readonly keys = new Map<string, ReceiveKey>()

  setKey(senderId: string, key: FrameKey) {
    this.keys.set(`${senderId}#${key.keyId}`, { ...key, window: new ReplayWindow() })
  }

  removeKey(senderId: string, keyId: number, expected?: CryptoKey) {
    const id = `${senderId}#${keyId}`
    if (!expected || this.keys.get(id)?.key === expected) this.keys.delete(id)
  }

  removeSender(senderId: string) {
    for (const id of this.keys.keys()) if (id.startsWith(`${senderId}#`)) this.keys.delete(id)
  }

  hasSender(senderId: string) {
    for (const id of this.keys.keys()) if (id.startsWith(`${senderId}#`)) return true
    return false
  }

  /** Returns the plain frame, or the reason it was dropped. */
  async decrypt(senderId: string, frame: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer> | DropReason> {
    if (frame.length === 0) return new Uint8Array(0)
    const header = readHeader(frame, 1)
    if (!header || frame.length < 1 + header.length + TAG_BYTES) return 'malformed'
    const key = this.keys.get(`${senderId}#${header.keyId}`)
    if (!key) return 'unknown_key'
    if (!key.window.check(header.counter)) return 'replay'
    const prefix = 1 + header.length
    let plain: ArrayBuffer
    try {
      plain = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: frameIV(key.salt, header.counter), additionalData: frame.subarray(0, prefix), tagLength: TAG_BYTES * 8 },
        key.key,
        frame.subarray(prefix),
      )
    } catch {
      return 'auth'
    }
    // Commit only after authentication; recheck for frames racing in parallel.
    if (!key.window.check(header.counter)) return 'replay'
    key.window.accept(header.counter)
    const output = new Uint8Array(1 + plain.byteLength)
    output[0] = frame[0] as number
    output.set(new Uint8Array(plain), 1)
    return output
  }
}
