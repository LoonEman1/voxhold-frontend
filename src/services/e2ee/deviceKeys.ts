/**
 * Per-device ECDH P-256 identity (FEAT-13). The private key is generated
 * non-extractable and kept as a CryptoKey in IndexedDB (structured clone), so
 * it never leaves this browser profile; only the public key is registered.
 */
import { base64Encode } from './keyWrap'

export interface LocalDevice {
  userId: number
  deviceId: string
  privateKey: CryptoKey
  publicKey: Uint8Array<ArrayBuffer>
  registered: boolean
}

/** Last device keys seen for a peer, for the "key changed" warning (TOFU). */
export interface SeenKeys { userId: number; keys: Record<string, string> }

export interface E2EEStore {
  getDevice(userId: number): Promise<LocalDevice | undefined>
  putDevice(device: LocalDevice): Promise<void>
  deleteDevice(userId: number): Promise<void>
  getSeen(userId: number): Promise<SeenKeys | undefined>
  putSeen(value: SeenKeys): Promise<void>
}

const DB_NAME = 'voxhold-e2ee'
const DEVICES = 'devices'
const SEEN = 'seen'

function request<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    value.onsuccess = () => resolve(value.result)
    value.onerror = () => reject(value.error ?? new Error('IndexedDB request failed'))
  })
}

export class IndexedDBStore implements E2EEStore {
  private database: Promise<IDBDatabase> | null = null

  private open() {
    this.database ??= new Promise<IDBDatabase>((resolve, reject) => {
      const opening = indexedDB.open(DB_NAME, 1)
      opening.onupgradeneeded = () => {
        opening.result.createObjectStore(DEVICES, { keyPath: 'userId' })
        opening.result.createObjectStore(SEEN, { keyPath: 'userId' })
      }
      opening.onsuccess = () => resolve(opening.result)
      opening.onerror = () => reject(opening.error ?? new Error('IndexedDB is unavailable'))
    })
    return this.database
  }

  private async store(name: string, mode: IDBTransactionMode) {
    return (await this.open()).transaction(name, mode).objectStore(name)
  }

  async getDevice(userId: number) { return request<LocalDevice | undefined>((await this.store(DEVICES, 'readonly')).get(userId)) }
  async putDevice(device: LocalDevice) { await request((await this.store(DEVICES, 'readwrite')).put(device)) }
  async deleteDevice(userId: number) { await request((await this.store(DEVICES, 'readwrite')).delete(userId)) }
  async getSeen(userId: number) { return request<SeenKeys | undefined>((await this.store(SEEN, 'readonly')).get(userId)) }
  async putSeen(value: SeenKeys) { await request((await this.store(SEEN, 'readwrite')).put(value)) }
}

export function randomDeviceId() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function createDevice(userId: number): Promise<LocalDevice> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits'])
  const publicKey = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))
  return { userId, deviceId: randomDeviceId(), privateKey: pair.privateKey, publicKey, registered: false }
}

export interface DeviceRegistry {
  register(deviceId: string, publicKey: string): Promise<void>
  revoke(deviceId: string): Promise<void>
}

/** HTTP 409: the server knows this device id with another key or revoked it. */
export function isDeviceConflict(error: unknown) {
  return typeof error === 'object' && error !== null && 'status' in error && (error as { status: unknown }).status === 409
}

/**
 * Returns this browser's registered device for the user, creating and
 * registering it on first use. A device the server refuses (revoked or
 * conflicting) is replaced by a fresh one once.
 */
export async function ensureDevice(store: E2EEStore, registry: DeviceRegistry, userId: number): Promise<LocalDevice> {
  let device = await store.getDevice(userId)
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!device) {
      device = await createDevice(userId)
      await store.putDevice(device)
    }
    if (device.registered) return device
    try {
      await registry.register(device.deviceId, base64Encode(device.publicKey))
      device = { ...device, registered: true }
      await store.putDevice(device)
      return device
    } catch (error) {
      if (!isDeviceConflict(error) || attempt > 0) throw error
      await store.deleteDevice(userId)
      device = undefined
    }
  }
  throw new Error('Не удалось зарегистрировать ключ устройства')
}

/** Logout: forget the private key here and revoke it on the server. */
export async function forgetDevice(store: E2EEStore, registry: DeviceRegistry | null, userId: number) {
  const device = await store.getDevice(userId)
  if (!device) return
  await store.deleteDevice(userId)
  if (device.registered && registry) await registry.revoke(device.deviceId).catch(() => undefined)
}
