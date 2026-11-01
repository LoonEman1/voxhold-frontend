/**
 * Wraps a 32-byte sender key for one recipient device (FEAT-13):
 * AES-256-GCM with a key from HKDF-SHA-256 over static ECDH P-256 of the two
 * devices. salt = room, info binds room and both device ids, and the AAD adds
 * the key id, so a payload cannot be replayed into another room, pair or slot.
 * Static ECDH also proves to the recipient which device sent the key.
 */
import { MAX_KEY_ID } from './frame'

const encoder = new TextEncoder()
const VERSION = 1

export interface WrapContext { room: string; senderDevice: string; recipientDevice: string }

function wrapInfo(context: WrapContext) {
  return `voxhold-e2ee-v1|${context.room}|${context.senderDevice}|${context.recipientDevice}`
}

async function wrappingKey(privateKey: CryptoKey, peerPublicKey: CryptoKey, context: WrapContext) {
  const shared = await crypto.subtle.deriveBits({ name: 'ECDH', public: peerPublicKey }, privateKey, 256)
  const base = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: encoder.encode(context.room), info: encoder.encode(wrapInfo(context)) },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

export function base64Encode(bytes: Uint8Array): string {
  let text = ''
  for (const byte of bytes) text += String.fromCharCode(byte)
  return btoa(text)
}

export function base64Decode(value: string): Uint8Array<ArrayBuffer> {
  const text = atob(value)
  const bytes = new Uint8Array(text.length)
  for (let index = 0; index < text.length; index++) bytes[index] = text.charCodeAt(index)
  return bytes
}

/** Imports a 65-byte uncompressed P-256 point received from the server. */
export function importDevicePublicKey(raw: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  if (raw.length !== 65 || raw[0] !== 0x04) return Promise.reject(new Error('invalid device public key'))
  return crypto.subtle.importKey('raw', raw, { name: 'ECDH', namedCurve: 'P-256' }, true, [])
}

export async function wrapSenderKey(privateKey: CryptoKey, recipientPublicKey: CryptoKey, context: WrapContext, keyId: number, senderKey: Uint8Array<ArrayBuffer>): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await wrappingKey(privateKey, recipientPublicKey, context)
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(`${wrapInfo(context)}|${keyId}`) }, key, senderKey))
  const payload = JSON.stringify({ v: VERSION, key_id: keyId, iv: base64Encode(iv), ct: base64Encode(ct) })
  return base64Encode(encoder.encode(payload))
}

export interface UnwrappedKey { keyId: number; key: Uint8Array<ArrayBuffer> }

/** Throws on any malformed, foreign or forged payload. */
export async function unwrapSenderKey(privateKey: CryptoKey, senderPublicKey: CryptoKey, context: WrapContext, payload: string): Promise<UnwrappedKey> {
  const parsed = JSON.parse(new TextDecoder().decode(base64Decode(payload))) as { v?: unknown; key_id?: unknown; iv?: unknown; ct?: unknown }
  if (parsed.v !== VERSION || typeof parsed.key_id !== 'number' || !Number.isInteger(parsed.key_id) || parsed.key_id < 0 || parsed.key_id > MAX_KEY_ID || typeof parsed.iv !== 'string' || typeof parsed.ct !== 'string') {
    throw new Error('unsupported e2ee key payload')
  }
  const iv = base64Decode(parsed.iv)
  const ct = base64Decode(parsed.ct)
  if (iv.length !== 12 || ct.length !== 32 + 16) throw new Error('malformed e2ee key payload')
  const key = await wrappingKey(privateKey, senderPublicKey, context)
  const raw = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(`${wrapInfo(context)}|${parsed.key_id}`) }, key, ct))
  return { keyId: parsed.key_id, key: raw }
}
