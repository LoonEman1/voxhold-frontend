/**
 * Wraps a 32-byte sender key for one recipient device (FEAT-13):
 * AES-256-GCM with a key from HKDF-SHA-256 over static ECDH P-256 of the two
 * devices. salt = room, info binds room and both device ids, and the AAD adds
 * the key id and generation, so a payload cannot be replayed into another
 * room, pair or slot, nor pass for a newer key. Static ECDH also proves to
 * the recipient which device sent the key.
 */
import { MAX_KEY_ID } from './frame'

const encoder = new TextEncoder()
const VERSION = 2

export interface WrapContext { room: string; senderDevice: string; recipientDevice: string }

function wrapInfo(context: WrapContext) {
  return `voxhold-e2ee-v1|${context.room}|${context.senderDevice}|${context.recipientDevice}`
}

async function wrappingKey(privateKey: CryptoKey, peerPublicKey: CryptoKey, context: WrapContext, purpose = '') {
  const shared = await crypto.subtle.deriveBits({ name: 'ECDH', public: peerPublicKey }, privateKey, 256)
  const base = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: encoder.encode(context.room), info: encoder.encode(wrapInfo(context) + purpose) },
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

const additionalData = (context: WrapContext, keyId: number, gen: number) => encoder.encode(`${wrapInfo(context)}|${keyId}|${gen}`)

/** `gen` grows with every key of a sender (senderKeys.ts) and is authenticated. */
export async function wrapSenderKey(privateKey: CryptoKey, recipientPublicKey: CryptoKey, context: WrapContext, keyId: number, gen: number, senderKey: Uint8Array<ArrayBuffer>, readyNonce?: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await wrappingKey(privateKey, recipientPublicKey, context)
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: additionalData(context, keyId, gen) }, key, senderKey))
  // Legacy clients ignore ready_nonce and still unwrap the unchanged v2 key.
  // Changing/removing the nonce can only delay readiness, never forge an ACK.
  const payload = JSON.stringify({ v: VERSION, key_id: keyId, gen, iv: base64Encode(iv), ct: base64Encode(ct), ...(readyNonce ? { ready_nonce: readyNonce } : {}) })
  return base64Encode(encoder.encode(payload))
}

export interface UnwrappedKey { keyId: number; gen: number; key: Uint8Array<ArrayBuffer>; readyNonce?: string }

/** Throws on any malformed, foreign or forged payload. */
export async function unwrapSenderKey(privateKey: CryptoKey, senderPublicKey: CryptoKey, context: WrapContext, payload: string): Promise<UnwrappedKey> {
  const parsed = JSON.parse(new TextDecoder().decode(base64Decode(payload))) as { v?: unknown; key_id?: unknown; gen?: unknown; iv?: unknown; ct?: unknown; ready_nonce?: unknown }
  if (parsed.v !== VERSION || typeof parsed.key_id !== 'number' || !Number.isInteger(parsed.key_id) || parsed.key_id < 0 || parsed.key_id > MAX_KEY_ID
    || typeof parsed.gen !== 'number' || !Number.isSafeInteger(parsed.gen) || parsed.gen < 0 || typeof parsed.iv !== 'string' || typeof parsed.ct !== 'string') {
    throw new Error('unsupported e2ee key payload')
  }
  const iv = base64Decode(parsed.iv)
  const ct = base64Decode(parsed.ct)
  if (iv.length !== 12 || ct.length !== 32 + 16) throw new Error('malformed e2ee key payload')
  const key = await wrappingKey(privateKey, senderPublicKey, context)
  const raw = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: additionalData(context, parsed.key_id, parsed.gen) }, key, ct))
  const readyNonce = typeof parsed.ready_nonce === 'string' && base64Decode(parsed.ready_nonce).length === 16 ? parsed.ready_nonce : undefined
  return { keyId: parsed.key_id, gen: parsed.gen, key: raw, readyNonce }
}

export interface KeyAcknowledgement { keyId: number; gen: number; nonce: string; iv: Uint8Array<ArrayBuffer>; tag: Uint8Array<ArrayBuffer> }

/** The existing opaque relay carries ACKs; no new backend event is needed. */
export function readKeyAcknowledgement(payload: string): KeyAcknowledgement | null {
  const value = JSON.parse(new TextDecoder().decode(base64Decode(payload))) as Record<string, unknown>
  if (value.type !== 'key-installed') return null
  if (value.v !== 1 || !Number.isInteger(value.key_id) || (value.key_id as number) < 0 || (value.key_id as number) > MAX_KEY_ID
    || !Number.isSafeInteger(value.gen) || (value.gen as number) < 0 || typeof value.nonce !== 'string' || typeof value.iv !== 'string' || typeof value.ct !== 'string') throw new Error('invalid key acknowledgement')
  const iv = base64Decode(value.iv), tag = base64Decode(value.ct)
  if (base64Decode(value.nonce).length !== 16 || iv.length !== 12 || tag.length !== 16) throw new Error('invalid key acknowledgement')
  return { keyId: value.key_id as number, gen: value.gen as number, nonce: value.nonce, iv, tag }
}

const receiptData = (context: WrapContext, keyId: number, gen: number, nonce: string) => encoder.encode(`${wrapInfo(context)}|key-installed|${keyId}|${gen}|${nonce}`)

/** Pairwise authentication prevents another room member from ACKing for us. */
export async function wrapKeyAcknowledgement(privateKey: CryptoKey, peerPublicKey: CryptoKey, context: WrapContext, keyId: number, gen: number, nonce: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await wrappingKey(privateKey, peerPublicKey, context, '|key-installed')
  const tag = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: receiptData(context, keyId, gen, nonce) }, key, new Uint8Array(0))
  return base64Encode(encoder.encode(JSON.stringify({ v: 1, type: 'key-installed', key_id: keyId, gen, nonce, iv: base64Encode(iv), ct: base64Encode(new Uint8Array(tag)) })))
}

export async function verifyKeyAcknowledgement(privateKey: CryptoKey, peerPublicKey: CryptoKey, context: WrapContext, receipt: KeyAcknowledgement): Promise<void> {
  const key = await wrappingKey(privateKey, peerPublicKey, context, '|key-installed')
  await crypto.subtle.decrypt({ name: 'AES-GCM', iv: receipt.iv, additionalData: receiptData(context, receipt.keyId, receipt.gen, receipt.nonce) }, key, receipt.tag)
}
