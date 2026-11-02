/** Sender keys stay v2-compatible; upgraded peers ACK after worker installation. */
import type { LocalDevice } from './deviceKeys'
import { base64Encode, readKeyAcknowledgement, unwrapSenderKey, verifyKeyAcknowledgement, wrapKeyAcknowledgement, wrapSenderKey, type WrapContext } from './keyWrap'

export interface RoomMember { userId: number; deviceId: string }
export const senderId = (member: RoomMember) => `${member.userId}:${member.deviceId}`
export interface SenderKeyTransport {
  sendKey(to: RoomMember, payload: string): void
  requestKey(to: RoomMember): void
}
export interface SenderKeySink {
  setSendKey(keyId: number, key: Uint8Array<ArrayBuffer>): void | Promise<void>
  addReceiveKey(senderId: string, keyId: number, key: Uint8Array<ArrayBuffer>): void | Promise<void>
  removeSender(senderId: string): void
}
export interface PublicKeyDirectory { publicKey(member: RoomMember): Promise<CryptoKey>; prefetch?(members: RoomMember[]): void }
export interface Clock {
  now(): number
  setTimeout(callback: () => void, ms: number): ReturnType<typeof setTimeout>
  clearTimeout(handle: ReturnType<typeof setTimeout>): void
}
const systemClock: Clock = { now: () => Date.now(), setTimeout: (callback, ms) => setTimeout(callback, ms), clearTimeout: (handle) => clearTimeout(handle) }

// Eight frame key slots and ten-second receive-key retention still require
// bounded rotation. Bootstrap distribution does not consume another slot.
export const ROTATION_DEBOUNCE_MS = 2_000
export const ROTATION_GATHER_MS = 100
export const ROTATION_PERIOD_MS = 10 * 60_000
/** Bounded fallback for legacy peers, lost ACKs and stalled receivers. */
export const KEY_READY_TIMEOUT_MS = 1_000
const PENDING_KEY_LIMIT = 32

export type KeyStage = 'key_sent' | 'key_installed' | 'send_key_active' | 'key_ready_timeout'
interface SessionOptions {
  room: string; self: LocalDevice; transport: SenderKeyTransport; sink: SenderKeySink; directory: PublicKeyDirectory
  clock?: Clock; onError?: (error: unknown) => void; onStage?: (stage: KeyStage) => void
}
interface SendKey {
  keyId: number; gen: number; key: Uint8Array<ArrayBuffer>; nonce: string
  allowed: Set<string>; waiting: Set<string>; invalid: boolean
  activation: Promise<void> | null; timer: ReturnType<typeof setTimeout> | null
}
interface ReceiveKey {
  gen: number; keyId: number; fingerprint: string; installed: boolean; installation: Promise<void> | null
}

export class SenderKeySession {
  private readonly clock: Clock
  private members = new Map<string, RoomMember>()
  private latest: SendKey | null = null
  private initial: SendKey | null = null
  private membershipKnown = false
  private lastGen = 0
  private nextKeyId = 0
  private lastRotation = -Infinity
  private readonly received = new Map<string, ReceiveKey>()
  private rotationTimer: ReturnType<typeof setTimeout> | null = null
  private periodicTimer: ReturnType<typeof setTimeout> | null = null
  private readonly pending: Array<{ from: RoomMember; payload: string }> = []
  private closed = false

  constructor(private readonly options: SessionOptions) { this.clock = options.clock ?? systemClock }
  private get self(): RoomMember { return { userId: this.options.self.userId, deviceId: this.options.self.deviceId } }
  private context(sender: RoomMember, recipient: RoomMember): WrapContext { return { room: this.options.room, senderDevice: senderId(sender), recipientDevice: senderId(recipient) } }
  private report(error: unknown) { if (!this.closed) this.options.onError?.(error) }

  /** A fresh call can establish encrypted RTP before another member arrives. */
  start() {
    if (this.closed || this.latest) return
    this.initial = this.createKey()
    void this.activate(this.initial).catch((error: unknown) => this.report(error))
  }

  setMembers(list: RoomMember[]) {
    if (this.closed) return
    const next = new Map(list.filter((member) => senderId(member) !== senderId(this.self)).map((member) => [senderId(member), member]))
    const added = [...next.keys()].filter((id) => !this.members.has(id))
    const removed = [...this.members.keys()].filter((id) => !next.has(id))
    for (const id of removed) {
      this.options.sink.removeSender(id)
      const seen = this.received.get(id)
      if (seen) this.received.set(id, { ...seen, installed: false, installation: null })
      this.latest?.allowed.delete(id)
    }
    this.members = next
    if (removed.length && this.latest) {
      // Also cancel an activation queued for a later microtask. A departed
      // recipient may already know this pending key.
      this.latest.invalid = true
      this.clearDeadline(this.latest)
    }
    const firstSnapshot = !this.membershipKnown
    this.membershipKnown = true
    if (firstSnapshot && this.latest === this.initial && this.latest) {
      // Only the first membership snapshot can use this call's fresh key.
      // An empty first snapshot must not expose solo audio to a later joiner.
      const key = this.latest
      this.initial = null
      key.allowed = new Set(next.keys())
      key.waiting = new Set(next.keys())
      if (next.size) this.lastRotation = this.clock.now()
      for (const member of next.values()) this.deliver(key, member)
    } else if (added.length || removed.length) {
      const key = this.latest
      if (key && !key.invalid && !key.activation && !removed.length) {
        // A pending, unused key can include a burst of new members safely.
        for (const id of added) { key.allowed.add(id); key.waiting.add(id); this.deliver(key, next.get(id)!) }
      } else {
        if (key && !key.activation) { key.invalid = true; this.clearDeadline(key) }
        this.scheduleRotation()
      }
    }
    for (const item of this.pending.splice(0)) void this.receiveKey(item.from, item.payload)
  }

  private scheduleRotation() {
    if (this.rotationTimer !== null || this.closed) return
    const delay = Math.max(ROTATION_GATHER_MS, this.lastRotation + ROTATION_DEBOUNCE_MS - this.clock.now())
    this.rotationTimer = this.clock.setTimeout(() => { this.rotationTimer = null; this.rotate() }, delay)
  }

  private createKey(): SendKey {
    if (this.latest) this.clearDeadline(this.latest)
    const keyId = this.nextKeyId
    this.nextKeyId = (keyId + 1) % 8
    const gen = Math.max(this.clock.now(), this.lastGen + 1)
    this.lastGen = gen
    const key: SendKey = {
      keyId, gen, key: crypto.getRandomValues(new Uint8Array(32)), nonce: base64Encode(crypto.getRandomValues(new Uint8Array(16))),
      allowed: new Set(this.members.keys()), waiting: new Set(this.members.keys()), invalid: false, activation: null, timer: null,
    }
    this.latest = key
    if (this.periodicTimer !== null) this.clock.clearTimeout(this.periodicTimer)
    this.periodicTimer = this.clock.setTimeout(() => { this.periodicTimer = null; this.scheduleRotation() }, ROTATION_PERIOD_MS)
    return key
  }

  private rotate() {
    if (this.closed) return
    this.lastRotation = this.clock.now()
    const key = this.createKey()
    if (!key.waiting.size) { void this.activate(key).catch((error: unknown) => this.report(error)); return }
    key.timer = this.clock.setTimeout(() => {
      key.timer = null
      if (this.latest !== key || key.invalid || this.closed) return
      this.options.onStage?.('key_ready_timeout')
      void this.activate(key).catch((error: unknown) => this.report(error))
    }, KEY_READY_TIMEOUT_MS)
    for (const member of this.members.values()) this.deliver(key, member)
  }

  private clearDeadline(key: SendKey) {
    if (key.timer !== null) this.clock.clearTimeout(key.timer)
    key.timer = null
  }

  private activate(key: SendKey): Promise<void> {
    if (key.activation) return key.activation // Never reinstall a key/reset its IV counter.
    if (this.closed || key.invalid || this.latest !== key) return Promise.resolve()
    this.clearDeadline(key)
    key.activation = Promise.resolve().then(async () => {
      if (this.closed || key.invalid || this.latest !== key) return
      await this.options.sink.setSendKey(key.keyId, key.key)
      if (!this.closed) this.options.onStage?.('send_key_active')
    })
    return key.activation
  }

  private deliver(key: SendKey, member: RoomMember) { void this.sendKey(key, member).catch((error: unknown) => this.report(error)) }
  private async sendKey(key: SendKey, member: RoomMember) {
    const id = senderId(member)
    if (this.closed || key.invalid || this.latest !== key || !key.allowed.has(id) || !this.members.has(id)) return
    const publicKey = await this.options.directory.publicKey(member)
    const payload = await wrapSenderKey(this.options.self.privateKey, publicKey, this.context(this.self, member), key.keyId, key.gen, key.key, key.nonce)
    if (this.closed || key.invalid || this.latest !== key || !key.allowed.has(id) || !this.members.has(id)) return
    this.options.transport.sendKey(member, payload)
    this.options.onStage?.('key_sent')
  }

  async receiveKey(from: RoomMember, payload: string) {
    if (this.closed) return
    if (!this.members.has(senderId(from))) {
      if (this.pending.length >= PENDING_KEY_LIMIT) this.pending.shift()
      this.pending.push({ from, payload })
      return
    }
    try {
      const receipt = readKeyAcknowledgement(payload)
      if (receipt) {
        const key = this.latest, id = senderId(from)
        if (!key || key.invalid || !key.waiting.has(id) || receipt.keyId !== key.keyId || receipt.gen !== key.gen || receipt.nonce !== key.nonce) return
        const publicKey = await this.options.directory.publicKey(from)
        await verifyKeyAcknowledgement(this.options.self.privateKey, publicKey, this.context(this.self, from), receipt)
        if (this.closed || this.latest !== key || key.invalid || !this.members.has(id) || !key.allowed.has(id)) return
        key.waiting.delete(id)
        if (!key.waiting.size) await this.activate(key)
        return
      }
      const publicKey = await this.options.directory.publicKey(from)
      const unwrapped = await unwrapSenderKey(this.options.self.privateKey, publicKey, this.context(from, this.self), payload)
      const id = senderId(from)
      if (this.closed || !this.members.has(id)) return
      const seen = this.received.get(id)
      if (seen && unwrapped.gen < seen.gen) return
      const fingerprint = base64Encode(new Uint8Array(await crypto.subtle.digest('SHA-256', unwrapped.key)))
      if (this.closed || !this.members.has(id)) return
      // Recheck after hashing: a newer unwrap may have finished in parallel.
      const current = this.received.get(id)
      if (current && unwrapped.gen < current.gen) return
      let received = current
      if (current && unwrapped.gen === current.gen) {
        if (unwrapped.keyId !== current.keyId || fingerprint !== current.fingerprint) return
      }
      // A duplicate while installation is pending awaits that same RPC.
      if (!received || unwrapped.gen > received.gen || received.installation === null) {
        received = { gen: unwrapped.gen, keyId: unwrapped.keyId, fingerprint, installed: false, installation: null }
        this.received.set(id, received)
        const installing = received
        received.installation = Promise.resolve().then(() => {
          if (this.closed || !this.members.has(id) || this.received.get(id) !== installing) return
          return this.options.sink.addReceiveKey(id, unwrapped.keyId, unwrapped.key)
        }).catch((error: unknown) => {
          if (this.received.get(id) === installing) installing.installation = null
          throw error
        })
      }
      await received!.installation
      if (this.closed || !this.members.has(id) || this.received.get(id) !== received) return
      received!.installed = true
      this.options.onStage?.('key_installed')
      if (unwrapped.readyNonce) {
        const ack = await wrapKeyAcknowledgement(this.options.self.privateKey, publicKey, this.context(from, this.self), unwrapped.keyId, unwrapped.gen, unwrapped.readyNonce)
        if (!this.closed && this.members.has(id) && this.received.get(id) === received && received!.installed) this.options.transport.sendKey(from, ack)
      }
    } catch (error) { this.report(error) }
  }

  resendTo(member: RoomMember) {
    if (this.closed || !this.members.has(senderId(member))) return
    const key = this.latest
    // Never answer a newcomer's eager request with a pre-join audio key.
    if (!key || key.invalid || !key.allowed.has(senderId(member))) { this.scheduleRotation(); return }
    this.deliver(key, member)
  }
  requestKey(member: RoomMember) { if (!this.closed && this.members.has(senderId(member))) this.options.transport.requestKey(member) }
  memberBySender(id: string) { return this.members.get(id) }
  forceRotation() { this.scheduleRotation() }
  close() {
    this.closed = true
    if (this.rotationTimer !== null) this.clock.clearTimeout(this.rotationTimer)
    if (this.periodicTimer !== null) this.clock.clearTimeout(this.periodicTimer)
    if (this.latest) this.clearDeadline(this.latest)
    this.pending.length = 0
    this.latest = this.initial = null
    this.received.clear()
  }
}
