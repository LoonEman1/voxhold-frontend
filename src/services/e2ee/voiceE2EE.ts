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
import { SenderKeySession, senderId, type PublicKeyDirectory, type RoomMember, type SenderKeyTransport } from './senderKeys'

const DIRECTORY_TTL_MS = 60_000

/**
 * Public keys of room members, fetched from the server and cached briefly.
 * Each fetch is compared with the keys seen before (TOFU) so a substituted
 * or new key raises a visible warning.
 */
export function createKeyDirectory(fetchDevices: (userId: number) => Promise<E2EEDevice[]>, store: E2EEStore, onKeyChanged: (userId: number) => void): PublicKeyDirectory {
  const users = new Map<number, { at: number; devices: Promise<Map<string, Promise<CryptoKey>>> }>()
  const load = (userId: number) => {
    const cached = users.get(userId)
    if (cached && Date.now() - cached.at < DIRECTORY_TTL_MS) return cached.devices
    const devices = fetchDevices(userId).then(async (list) => {
      const trust = await rememberPeerKeys(store, userId, Object.fromEntries(list.map((device) => [device.device_id, device.public_key])))
      if (trust === 'changed') onKeyChanged(userId)
      return new Map(list.map((device) => [device.device_id, importDevicePublicKey(base64Decode(device.public_key))]))
    })
    devices.catch(() => { if (users.get(userId)?.devices === devices) users.delete(userId) })
    users.set(userId, { at: Date.now(), devices })
    return devices
  }
  return {
    async publicKey(member: RoomMember) {
      let key = (await load(member.userId)).get(member.deviceId)
      if (!key) {
        // A device registered after our last fetch: refresh once.
        users.delete(member.userId)
        key = (await load(member.userId)).get(member.deviceId)
      }
      if (!key) throw new Error('unknown e2ee device')
      return key
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
}

export class CallE2EE {
  readonly media: E2EEMediaTransform
  private readonly session: SenderKeySession
  private participants = new Map<string, RoomMember>()
  private receiverOwners = new Map<string, string>()
  private readonly mapped = new Map<string, string | null>()

  constructor(options: CallE2EEOptions) {
    this.media = new E2EEMediaTransform(options.mode, (event) => this.onWorkerEvent(event))
    this.session = new SenderKeySession({ room: options.room, self: options.device, transport: options.transport, sink: this.media, directory: options.directory, onError: options.onError })
    this.session.start()
  }

  private onWorkerEvent(event: WorkerEvent) {
    if (event.type === 'missingKey') {
      const member = this.session.memberBySender(event.senderId)
      if (member) this.session.requestKey(member)
    } else if (event.type === 'exhausted') {
      this.session.forceRotation()
    } else {
      clientDiagnostics.record('webrtc', 'e2ee_frames', 'info', { encrypted: event.encrypted, decrypted: event.decrypted, dropped: event.dropped, average_us: event.averageMicros })
    }
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
    this.session.close()
    this.media.close()
  }
}
