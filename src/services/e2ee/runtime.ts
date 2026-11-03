/**
 * Lazily loaded entry point of FEAT-13 for the workspace: keeps WebCrypto
 * plumbing, IndexedDB and the worker glue out of the main WorkspacePage chunk.
 */
import type { VoxholdApi } from '../api'
import type { VoiceParticipant } from '../../domain/types'
import { clientDiagnostics } from '../../platform/clientDiagnostics'
import { IndexedDBStore, createDevice, ensureDevice, type E2EEStore, type LocalDevice } from './deviceKeys'
import { base64Decode, base64Encode } from './keyWrap'
import { E2EEMediaTransform, e2eeTransformMode } from './mediaTransform'
import { rememberPeerKeys, safetyCode, type SafetyCodeResult } from './safetyCode'
import { E2EE_RECORDING_NOTICE } from './notices'
import type { RoomMember, SenderKeyTransport } from './senderKeys'
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
  startedAt?: number
  signal?: AbortSignal
}

type PreparationOptions = Pick<OpenOptions, 'api' | 'token' | 'userId' | 'room'>
const PREWARM_TTL_MS = 30_000
interface Prepared {
  media: E2EEMediaTransform
  directory: ReturnType<typeof createKeyDirectory>
  device: Promise<LocalDevice>
  ready: Promise<void>
  notifyKeyChanges: (handler: (userId: number) => void) => void
}
interface WarmEntry {
  options: PreparationOptions; prepared: Prepared; timer: ReturnType<typeof setTimeout>; leases: number; consumed: boolean
}
let warming: WarmEntry | null = null

function sameScope(a: PreparationOptions, b: PreparationOptions) {
  return a.api === b.api && a.token === b.token && a.userId === b.userId && a.room === b.room
}

function validateScope(options: PreparationOptions) {
  if (!options.token || !Number.isSafeInteger(options.userId) || options.userId <= 0) throw new Error('Сессия истекла. Войдите снова')
}

function prepare(options: PreparationOptions): Prepared {
  validateScope(options)
  const mode = e2eeTransformMode()
  if (!mode || typeof indexedDB === 'undefined') throw new Error(E2EE_UNSUPPORTED)
  store ??= new IndexedDBStore()
  const media = new E2EEMediaTransform(mode)
  // A new identity stays in memory until an actual join. Prewarming never
  // registers a device or writes private keys/trust records after logout.
  const device = store.getDevice(options.userId).then((existing) => existing ?? createDevice(options.userId))
  let changed: (userId: number) => void = () => undefined
  const directory = createKeyDirectory((userId) => options.api.e2ee.devices(options.token, userId), store, (userId) => changed(userId))
  const ready = Promise.all([media.ready, device]).then(() => undefined)
  void ready.catch(() => media.close())
  return { media, directory, device, ready, notifyKeyChanges: (handler) => { changed = handler } }
}

function dispose(entry: WarmEntry) {
  clearTimeout(entry.timer)
  if (warming === entry) warming = null
  if (!entry.consumed) entry.prepared.media.close()
}

/** One bounded, account/token/room-scoped warm worker; the caller releases it. */
export function prewarmCallE2EE(options: PreparationOptions, peers: RoomMember[] = []): () => void {
  let entry = warming
  if (!entry || !sameScope(entry.options, options)) {
    if (entry) dispose(entry)
    const prepared = prepare(options)
    entry = { options, prepared, timer: setTimeout(() => { if (warming === entry) dispose(entry!) }, PREWARM_TTL_MS), leases: 0, consumed: false }
    warming = entry
    const created = entry
    void prepared.ready.catch((error: unknown) => { if (warming === created) { dispose(created); reportPrewarmError(error) } })
  }
  entry.leases++
  entry.prepared.directory.prefetch?.(peers)
  const leased = entry
  let released = false
  return () => {
    if (released) return
    released = true
    leased.leases--
    if (!leased.leases && warming === leased) dispose(leased)
  }
}

export function prewarmVoiceChannel(options: Omit<PreparationOptions, 'room'> & { channelId: number }, participants: Readonly<Record<string, VoiceParticipant>>) {
  const peers = Object.values(participants)
    .filter((peer) => peer.channel_id === options.channelId && peer.e2ee_device_id)
    .map((peer) => ({ userId: peer.user_id, deviceId: peer.e2ee_device_id! }))
  try { return prewarmCallE2EE({ ...options, room: `voice:${options.channelId}` }, peers) }
  catch (error) { reportPrewarmError(error); return () => undefined }
}

function reportPrewarmError(error: unknown) {
  clientDiagnostics.record('webrtc', 'e2ee_prewarm_failed', 'debug', { error_name: error instanceof Error ? error.name : typeof error })
}

/** Registers this device if needed and starts the sender-key session. */
export async function openCallE2EE(options: OpenOptions) {
  if (options.signal?.aborted) throw new DOMException('Call preparation canceled', 'AbortError')
  validateScope(options)
  const entry = warming
  let prepared: Prepared
  if (entry && sameScope(entry.options, options)) {
    entry.consumed = true
    clearTimeout(entry.timer)
    warming = null
    prepared = entry.prepared
  } else {
    if (entry) dispose(entry)
    prepared = prepare(options)
  }
  let abort: (() => void) | undefined
  const canceled = options.signal ? new Promise<never>((_resolve, reject) => {
    abort = () => { reject(new DOMException('Call preparation canceled', 'AbortError')); prepared.media.close() }
    options.signal!.addEventListener('abort', abort, { once: true })
    if (options.signal!.aborted) abort()
  }) : null
  const wait = <T>(promise: Promise<T>): Promise<T> => canceled ? Promise.race([promise, canceled]) : promise
  try {
    await wait(prepared.ready)
    const candidate = await prepared.device
    if (options.signal?.aborted) throw new DOMException('Call preparation canceled', 'AbortError')
    // Revalidate on every real join, including a previously warmed/revoked device.
    const device = await wait(ensureDevice(store!, {
      register: (deviceId, publicKey) => options.api.e2ee.registerDevice(options.token, deviceId, publicKey),
      revoke: (deviceId) => options.api.e2ee.revokeDevice(options.token, deviceId),
    }, options.userId, candidate, options.signal))
    if (options.signal?.aborted) throw new DOMException('Call preparation canceled', 'AbortError')
    prepared.notifyKeyChanges(options.onKeyChanged)
    const onError = options.onError ?? ((error: unknown) => clientDiagnostics.record('webrtc', 'e2ee_key_error', 'warn', { error_name: error instanceof Error ? error.name : typeof error }))
    const e2ee = new CallE2EE({ room: options.room, mode: prepared.media.mode, media: prepared.media, device, directory: prepared.directory, transport: options.transport, onError, startedAt: options.startedAt, signal: options.signal })
    return { e2ee, deviceId: device.deviceId }
  } catch (error) { prepared.media.close(); throw error }
  finally { if (abort) options.signal?.removeEventListener('abort', abort) }
}

/**
 * Security code of two users from their registered device keys. It only
 * proves something if it covers the keys this browser really uses: our own
 * list must contain this device (else the server could show both sides the
 * same substituted keys), and the peer's list goes into the same
 * trust-on-first-use record as calls, so a list served only to this dialog,
 * or only to calls, raises the key-change warning.
 */
export async function userSafetyCode(api: VoxholdApi, token: string, me: number, other: number, keys: E2EEStore = (store ??= new IndexedDBStore())): Promise<SafetyCodeResult> {
  const [mine, theirs, local] = await Promise.all([api.e2ee.devices(token, me), api.e2ee.devices(token, other), keys.getDevice(me)])
  if (!local) throw new Error('Код можно проверить на устройстве, которое уже подключалось к звонку со сквозным шифрованием')
  if (!theirs.length) throw new Error('Код появится, когда собеседник подключится к звонку со сквозным шифрованием')
  const own = base64Encode(local.publicKey)
  if (!mine.some((device) => base64Encode(base64Decode(device.public_key)) === own)) {
    throw new Error('Ключа этого устройства нет в списке на сервере. Подключитесь к звонку со сквозным шифрованием и проверьте код снова; если ошибка повторится, сервер мог подменить ключи')
  }
  const trust = await rememberPeerKeys(keys, other, Object.fromEntries(theirs.map((device) => [device.device_id, device.public_key])))
  const code = await safetyCode({ userId: me, publicKeys: mine.map((device) => device.public_key) }, { userId: other, publicKeys: theirs.map((device) => device.public_key) })
  return { code, myDevices: mine.length, theirDevices: theirs.length, keyChanged: trust === 'changed' }
}

const RECORDING_NOTICE_KEY = 'voxhold:e2ee-recording-notice'

/** Shown once per browser before recording an end-to-end encrypted channel. */
export function confirmEncryptedRecording() {
  try { if (localStorage.getItem(RECORDING_NOTICE_KEY)) return true } catch { /* storage may be blocked */ }
  const accepted = window.confirm(`${E2EE_RECORDING_NOTICE}: файл увидит сервер. Начать запись?`)
  if (accepted) { try { localStorage.setItem(RECORDING_NOTICE_KEY, '1') } catch { /* storage may be blocked */ } }
  return accepted
}
