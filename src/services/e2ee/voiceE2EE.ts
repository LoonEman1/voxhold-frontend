/**
 * Glue for one end-to-end encrypted call (FEAT-13): the sender-key session,
 * the media worker and the mapping "receiver -> sender device" that the
 * worker needs to pick the right key for every incoming audio track. Receiver
 * IDs stay stable across SDP negotiations; they are not m-line IDs.
 */
import type { E2EEDevice, EntityId } from '../../domain/types'
import { clientDiagnostics } from '../../platform/clientDiagnostics'
import type { E2EEStore, LocalDevice } from './deviceKeys'
import type { WorkerEvent } from './frameProcessor'
import { base64Decode, importDevicePublicKey } from './keyWrap'
import { E2EEMediaTransform, type E2EETransformMode } from './mediaTransform'
import { rememberPeerKeys } from './safetyCode'
import { SenderKeySession, senderId, type KeyStage, type PublicKeyDirectory, type RoomMember, type SenderKeyTransport } from './senderKeys'

const DIRECTORY_TTL_MS = 60_000
interface DirectoryEntry { keys: Map<string, Promise<CryptoKey>>; raw: Record<string, string>; trust?: Promise<void> }

/**
 * Public keys of room members, fetched from the server and cached briefly.
 * Each fetch is compared with the keys seen before (TOFU) so a substituted
 * or new key raises a visible warning.
 */
export function createKeyDirectory(fetchDevices: (userId: number) => Promise<E2EEDevice[]>, store: E2EEStore, onKeyChanged: (userId: number) => void): PublicKeyDirectory {
  const users = new Map<number, { at: number; devices: Promise<DirectoryEntry> }>()
  const load = (userId: number) => {
    const cached = users.get(userId)
    if (cached && Date.now() - cached.at < DIRECTORY_TTL_MS) return cached.devices
    const devices: Promise<DirectoryEntry> = fetchDevices(userId).then((list) => {
      const keys = new Map(list.map((device) => [device.device_id, importDevicePublicKey(base64Decode(device.public_key))]))
      // Prefetch is read-only: verify/persist trust only when the call uses it.
      for (const key of keys.values()) void key.catch(() => undefined)
      return { keys, raw: Object.fromEntries(list.map((device) => [device.device_id, device.public_key])) }
    })
    devices.catch(() => { if (users.get(userId)?.devices === devices) users.delete(userId) })
    users.set(userId, { at: Date.now(), devices })
    return devices
  }
  return {
    prefetch(members: RoomMember[]) {
      for (const userId of new Set(members.map((member) => member.userId))) void load(userId).catch(() => undefined)
    },
    async publicKey(member: RoomMember) {
      let entry = await load(member.userId)
      let key = entry.keys.get(member.deviceId)
      if (!key) {
        // A device registered after our last fetch: refresh once.
        users.delete(member.userId)
        entry = await load(member.userId)
        key = entry.keys.get(member.deviceId)
      }
      if (!key) throw new Error('unknown e2ee device')
      const publicKey = await key
      entry.trust ??= rememberPeerKeys(store, member.userId, entry.raw)
        .then((trust) => { if (trust === 'changed') onKeyChanged(member.userId) })
        .catch((error: unknown) => { entry.trust = undefined; throw error })
      await entry.trust
      return publicKey
    },
  }
}

export interface CallParticipant { connectionId: string; userId: EntityId; deviceId?: string }

interface CallE2EEOptions {
  room: string
  mode: E2EETransformMode
  device: LocalDevice
  directory: PublicKeyDirectory
  transport: SenderKeyTransport
  onError?: (error: unknown) => void
  media?: E2EEMediaTransform
  startedAt?: number
  onFirstFrame?: (direction: 'send' | 'recv') => void
  signal?: AbortSignal
}

export class CallE2EE {
  readonly media: E2EEMediaTransform
  private readonly session: SenderKeySession
  private participants = new Map<string, RoomMember>()
  private receiverOwners = new Map<string, string>()
  private readonly mapped = new Map<string, string | null>()
  private readonly startedAt: number
  private readonly stages = new Set<string>()
  private readonly abort = () => this.close()

  constructor(private readonly options: CallE2EEOptions) {
    this.startedAt = options.startedAt ?? performance.now()
    this.media = options.media ?? new E2EEMediaTransform(options.mode)
    this.media.setHandlers((event) => this.onWorkerEvent(event), (error) => options.onError?.(error))
    this.session = new SenderKeySession({ room: options.room, self: options.device, transport: options.transport, sink: this.media, directory: options.directory, onError: options.onError, onStage: (stage) => this.recordStage(stage) })
    this.session.start()
    options.signal?.addEventListener('abort', this.abort, { once: true })
    if (options.signal?.aborted) this.close()
  }

  private onWorkerEvent(event: WorkerEvent) {
    if (event.type === 'missingKey') {
      const member = this.session.memberBySender(event.senderId)
      if (member) this.session.requestKey(member)
    } else if (event.type === 'exhausted') {
      this.session.forceRotation()
    } else if (event.type === 'firstFrame') {
      this.recordStage(`first_${event.direction}_frame`)
      this.options.onFirstFrame?.(event.direction)
    } else {
      clientDiagnostics.record('webrtc', 'e2ee_frames', 'info', { encrypted: event.encrypted, decrypted: event.decrypted, dropped: event.dropped, average_us: event.averageMicros })
    }
  }

  private recordStage(stage: KeyStage | `first_${'send' | 'recv'}_frame`) {
    if (this.stages.has(stage)) return
    this.stages.add(stage)
    clientDiagnostics.record('webrtc', `e2ee_${stage}`, 'info', { elapsed_ms: Math.max(0, Math.round(performance.now() - this.startedAt)) })
  }

  /** All participants of the call, including this connection. */
  setParticipants(list: CallParticipant[]) {
    this.participants = new Map(list.filter((item) => item.deviceId).map((item) => [item.connectionId, { userId: item.userId, deviceId: item.deviceId! }]))
    this.session.setMembers([...this.participants.values()])
    this.syncReceivers()
  }

  /** Which participant connection each receiver (by id) currently belongs to. */
  setReceiverOwners(owners: ReadonlyMap<string, string>) {
    this.receiverOwners = new Map(owners)
    this.syncReceivers()
  }

  private syncReceivers() {
    const ids = new Set([...this.receiverOwners.keys(), ...this.mapped.keys()])
    for (const receiverId of ids) {
      const owner = this.receiverOwners.get(receiverId)
      const member = owner ? this.participants.get(owner) : undefined
      const sender = member ? senderId(member) : null
      if (this.mapped.get(receiverId) === sender) continue
      this.mapped.set(receiverId, sender)
      this.media.mapReceiver(receiverId, sender)
    }
  }

  receiveKey(from: RoomMember, payload: string) { void this.session.receiveKey(from, payload) }

  keyRequested(from: RoomMember) { this.session.resendTo(from) }

  close() {
    this.options.signal?.removeEventListener('abort', this.abort)
    this.session.close()
    this.media.close()
  }
}
