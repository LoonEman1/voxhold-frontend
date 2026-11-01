/**
 * Lazily loaded entry point of FEAT-13 for the workspace: keeps WebCrypto
 * plumbing, IndexedDB and the worker glue out of the main WorkspacePage chunk.
 */
import type { VoxholdApi } from '../api'
import { IndexedDBStore, ensureDevice } from './deviceKeys'
import { e2eeTransformMode } from './mediaTransform'
import { safetyCode } from './safetyCode'
import { E2EE_RECORDING_NOTICE } from './notices'
import type { SenderKeyTransport } from './senderKeys'
import { CallE2EE, createKeyDirectory } from './voiceE2EE'

export { CallE2EE }

let store: IndexedDBStore | null = null

export const E2EE_UNSUPPORTED = 'Этот канал требует сквозного шифрования, а браузер его не поддерживает. Откройте Voxhold в свежем Chrome, Edge, Firefox или Safari'

interface OpenOptions {
  api: VoxholdApi
  token: string
  userId: number
  room: string
  transport: SenderKeyTransport
  onKeyChanged: (userId: number) => void
  onError?: (error: unknown) => void
}

/** Registers this device if needed and starts the sender-key session. */
export async function openCallE2EE(options: OpenOptions) {
  const mode = e2eeTransformMode()
  if (!mode || typeof indexedDB === 'undefined') throw new Error(E2EE_UNSUPPORTED)
  store ??= new IndexedDBStore()
  const device = await ensureDevice(store, {
    register: (deviceId, publicKey) => options.api.e2ee.registerDevice(options.token, deviceId, publicKey),
    revoke: (deviceId) => options.api.e2ee.revokeDevice(options.token, deviceId),
  }, options.userId)
  const directory = createKeyDirectory((userId) => options.api.e2ee.devices(options.token, userId), store, options.onKeyChanged)
  const e2ee = new CallE2EE({ room: options.room, mode, device, directory, transport: options.transport, onError: options.onError })
  return { e2ee, deviceId: device.deviceId }
}

/** Security code of two users from their registered device keys. */
export async function userSafetyCode(api: VoxholdApi, token: string, me: number, other: number) {
  const [mine, theirs] = await Promise.all([api.e2ee.devices(token, me), api.e2ee.devices(token, other)])
  if (!mine.length || !theirs.length) throw new Error('Код появится, когда вы оба подключитесь к каналу со сквозным шифрованием')
  return safetyCode({ userId: me, publicKeys: mine.map((device) => device.public_key) }, { userId: other, publicKeys: theirs.map((device) => device.public_key) })
}

const RECORDING_NOTICE_KEY = 'voxhold:e2ee-recording-notice'

/** Shown once per browser before recording an end-to-end encrypted channel. */
export function confirmEncryptedRecording() {
  try { if (localStorage.getItem(RECORDING_NOTICE_KEY)) return true } catch { /* storage may be blocked */ }
  const accepted = window.confirm(`${E2EE_RECORDING_NOTICE}: файл увидит сервер. Начать запись?`)
  if (accepted) { try { localStorage.setItem(RECORDING_NOTICE_KEY, '1') } catch { /* storage may be blocked */ } }
  return accepted
}
