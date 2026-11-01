/**
 * Sender-key distribution for one room (FEAT-13). Every member encrypts its
 * own audio with a random AES-256 key and sends that key to each other device,
 * wrapped with the pairwise ECDH key (keyWrap.ts). The server only relays.
 *
 * Rotation happens on every membership change (changes within 1 s share one
 * rotation, and rotations are at least 2 s apart) and every 10 minutes: the new key
 * is distributed first and used for sending 1 s later; receivers keep previous
 * keys for 10 s (worker). Key ids cycle through 0-7, enough because no more
 * than 6 keys of one sender are alive at once.
 */
import type { LocalDevice } from './deviceKeys'
import { unwrapSenderKey, wrapSenderKey, type WrapContext } from './keyWrap'

export interface RoomMember { userId: number; deviceId: string }

export const senderId = (member: RoomMember) => `${member.userId}:${member.deviceId}`

export interface SenderKeyTransport {
  sendKey(to: RoomMember, payload: string): void
  requestKey(to: RoomMember): void
}

export interface SenderKeySink {
  setSendKey(keyId: number, key: Uint8Array<ArrayBuffer>): void
  addReceiveKey(senderId: string, keyId: number, key: Uint8Array<ArrayBuffer>): void
  removeSender(senderId: string): void
}

export interface PublicKeyDirectory { publicKey(member: RoomMember): Promise<CryptoKey> }

export interface Clock {
  now(): number
  setTimeout(callback: () => void, ms: number): ReturnType<typeof setTimeout>
  clearTimeout(handle: ReturnType<typeof setTimeout>): void
}

const systemClock: Clock = {
  now: () => Date.now(),
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle),
}

export const ROTATION_DEBOUNCE_MS = 2_000
/** Changes within this window after the first one share a rotation. */
export const ROTATION_GATHER_MS = 1_000
export const ROTATION_PERIOD_MS = 10 * 60_000
export const ACTIVATION_DELAY_MS = 1_000
const PENDING_KEY_LIMIT = 32

interface SessionOptions {
  room: string
  self: LocalDevice
  transport: SenderKeyTransport
  sink: SenderKeySink
  directory: PublicKeyDirectory
  clock?: Clock
  onError?: (error: unknown) => void
}

export class SenderKeySession {
  private readonly clock: Clock
  private members = new Map<string, RoomMember>()
  private latest: { keyId: number; key: Uint8Array<ArrayBuffer> } | null = null
  private nextKeyId = 0
  private lastRotation = -Infinity
  private rotationTimer: ReturnType<typeof setTimeout> | null = null
  private periodicTimer: ReturnType<typeof setTimeout> | null = null
  private readonly activationTimers = new Set<ReturnType<typeof setTimeout>>()
  private readonly pending: Array<{ from: RoomMember; payload: string }> = []
  private closed = false

  constructor(private readonly options: SessionOptions) {
    this.clock = options.clock ?? systemClock
  }

  private get self(): RoomMember { return { userId: this.options.self.userId, deviceId: this.options.self.deviceId } }

  private context(sender: RoomMember, recipient: RoomMember): WrapContext {
    return { room: this.options.room, senderDevice: senderId(sender), recipientDevice: senderId(recipient) }
  }

  /** Creates and activates the first key at once: nobody can hear us before. */
  start() {
    void this.rotate(true)
  }

  /** Replaces the room members (without this device). */
  setMembers(list: RoomMember[]) {
    if (this.closed) return
    const next = new Map(list.filter((member) => member.userId !== this.options.self.userId || member.deviceId !== this.options.self.deviceId).map((member) => [senderId(member), member]))
    const changed = next.size !== this.members.size || [...next.keys()].some((id) => !this.members.has(id))
    for (const id of this.members.keys()) if (!next.has(id)) this.options.sink.removeSender(id)
    this.members = next
    if (changed) this.scheduleRotation()
    const waiting = this.pending.splice(0)
    for (const item of waiting) void this.receiveKey(item.from, item.payload)
  }

  private scheduleRotation() {
    if (this.rotationTimer !== null || this.closed) return
    const delay = Math.max(ROTATION_GATHER_MS, this.lastRotation + ROTATION_DEBOUNCE_MS - this.clock.now())
    this.rotationTimer = this.clock.setTimeout(() => {
      this.rotationTimer = null
      void this.rotate(false)
    }, delay)
  }

  private async rotate(immediate: boolean) {
    if (this.closed) return
    this.lastRotation = this.clock.now()
    if (this.periodicTimer !== null) this.clock.clearTimeout(this.periodicTimer)
    this.periodicTimer = this.clock.setTimeout(() => { this.periodicTimer = null; void this.rotate(false) }, ROTATION_PERIOD_MS)
    const keyId = this.nextKeyId
    this.nextKeyId = (keyId + 1) % 8
    const key = crypto.getRandomValues(new Uint8Array(32))
    this.latest = { keyId, key }
    try {
      await Promise.all([...this.members.values()].map((member) => this.sendLatest(member)))
    } catch (error) {
      this.options.onError?.(error)
    }
    if (this.closed || this.latest?.key !== key) return
    const activate = () => { if (!this.closed) this.options.sink.setSendKey(keyId, key) }
    if (immediate) { activate(); return }
    const timer = this.clock.setTimeout(() => { this.activationTimers.delete(timer); activate() }, ACTIVATION_DELAY_MS)
    this.activationTimers.add(timer)
  }

  private async sendLatest(member: RoomMember) {
    const latest = this.latest
    if (!latest) return
    const publicKey = await this.options.directory.publicKey(member)
    const payload = await wrapSenderKey(this.options.self.privateKey, publicKey, this.context(this.self, member), latest.keyId, latest.key)
    if (!this.closed && this.members.has(senderId(member))) this.options.transport.sendKey(member, payload)
  }

  /** Installs a key from another member; keys of unknown senders wait briefly. */
  async receiveKey(from: RoomMember, payload: string) {
    if (this.closed) return
    if (!this.members.has(senderId(from))) {
      if (this.pending.length >= PENDING_KEY_LIMIT) this.pending.shift()
      this.pending.push({ from, payload })
      return
    }
    try {
      const publicKey = await this.options.directory.publicKey(from)
      const unwrapped = await unwrapSenderKey(this.options.self.privateKey, publicKey, this.context(from, this.self), payload)
      if (!this.closed && this.members.has(senderId(from))) this.options.sink.addReceiveKey(senderId(from), unwrapped.keyId, unwrapped.key)
    } catch (error) {
      this.options.onError?.(error)
    }
  }

  /** A member could not decrypt us: send the newest key again. */
  resendTo(member: RoomMember) {
    if (this.closed || !this.members.has(senderId(member))) return
    void this.sendLatest(member).catch((error: unknown) => this.options.onError?.(error))
  }

  /** We cannot decrypt a member: ask it for its key. */
  requestKey(member: RoomMember) {
    if (!this.closed && this.members.has(senderId(member))) this.options.transport.requestKey(member)
  }

  memberBySender(id: string) { return this.members.get(id) }

  /** The counter of the send key is running out: rotate soon. */
  forceRotation() { this.scheduleRotation() }

  close() {
    this.closed = true
    if (this.rotationTimer !== null) this.clock.clearTimeout(this.rotationTimer)
    if (this.periodicTimer !== null) this.clock.clearTimeout(this.periodicTimer)
    for (const timer of this.activationTimers) this.clock.clearTimeout(timer)
    this.activationTimers.clear()
    this.pending.length = 0
    this.latest = null
  }
}
