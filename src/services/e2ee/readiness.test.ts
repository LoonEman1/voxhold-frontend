import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDevice, type LocalDevice } from './deviceKeys'
import { base64Decode, importDevicePublicKey, readKeyAcknowledgement, wrapKeyAcknowledgement } from './keyWrap'
import { KEY_READY_TIMEOUT_MS, ROTATION_GATHER_MS, SenderKeySession, senderId, type RoomMember, type SenderKeySink } from './senderKeys'

const member = (device: LocalDevice): RoomMember => ({ userId: device.userId, deviceId: device.deviceId })
const alive: SenderKeySession[] = []
afterEach(() => { alive.splice(0).forEach((session) => session.close()); vi.useRealTimers() })
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>((done) => { resolve = done }); return { promise, resolve } }
async function flush(check: () => boolean = () => true) {
  const deadline = performance.now() + 3_000
  for (let n = 0; n < 40 || !check() && performance.now() < deadline; n++) {
    await new Promise<void>((done) => (globalThis as unknown as { setImmediate: (done: () => void) => void }).setImmediate(done))
    await vi.advanceTimersByTimeAsync(0)
  }
}
class Sink implements SenderKeySink {
  sent: number[] = []
  installed: Array<{ from: string; keyId: number }> = []
  gate: Promise<void> | null = null
  setSendKey(keyId: number) { this.sent.push(keyId) }
  async addReceiveKey(from: string, keyId: number) { if (this.gate) await this.gate; this.installed.push({ from, keyId }) }
  removeSender() {}
}
async function room(count = 3) {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  const devices = await Promise.all(Array.from({ length: count }, (_, n) => createDevice(n + 1)))
  const publicKeys = await Promise.all(devices.map((device) => importDevicePublicKey(device.publicKey)))
  const sinks = devices.map(() => new Sink())
  const messages: Array<{ from: number; to: number; payload: string }> = []
  const errors: unknown[] = []
  let route = (_from: number, _to: number, _payload: string) => true
  const sessions: SenderKeySession[] = []
  devices.forEach((device, from) => sessions.push(new SenderKeySession({
    room: 'voice:1', self: device, sink: sinks[from]!, onError: (error) => errors.push(error),
    directory: { publicKey: async (peer) => publicKeys[devices.findIndex((item) => item.deviceId === peer.deviceId)]! },
    transport: {
      sendKey: (peer, payload) => {
        const to = devices.findIndex((item) => item.deviceId === peer.deviceId)
        messages.push({ from, to, payload })
        if (route(from, to, payload)) void sessions[to]!.receiveKey(member(device), payload)
      },
      requestKey: (peer) => sessions[devices.findIndex((item) => item.deviceId === peer.deviceId)]!.resendTo(member(device)),
    },
  })))
  alive.push(...sessions)
  sessions.forEach((session) => session.start())
  await flush()
  return { devices, publicKeys, sinks, sessions, messages, errors, route: (handler: typeof route) => { route = handler } }
}

describe('key installation readiness', () => {
  it('ACKs only after the receive worker installed the key, without the old one-second sleep', async () => {
    const r = await room(2), gate = deferred()
    r.sinks[1]!.gate = gate.promise
    r.sessions[0]!.setMembers([])
    r.sessions[1]!.setMembers([member(r.devices[0]!)])
    r.sessions[0]!.setMembers([member(r.devices[1]!)])
    await vi.advanceTimersByTimeAsync(ROTATION_GATHER_MS)
    await flush(() => r.messages.some((message) => message.from === 0))
    expect(r.sinks[0]!.sent).toEqual([0])
    expect(r.messages.filter((message) => message.from === 1 && readKeyAcknowledgement(message.payload))).toHaveLength(0)
    gate.resolve()
    await flush(() => r.sinks[0]!.sent.length === 2)
    expect(r.sinks[0]!.sent).toEqual([0, 1])
    expect(r.errors).toEqual([])
  })

  it('uses a bounded fallback for an old peer or a lost ACK', async () => {
    const r = await room(2)
    r.route((_from, to, payload) => to !== 0 || !readKeyAcknowledgement(payload))
    r.sessions[0]!.setMembers([])
    r.sessions[1]!.setMembers([member(r.devices[0]!)])
    r.sessions[0]!.setMembers([member(r.devices[1]!)])
    await vi.advanceTimersByTimeAsync(ROTATION_GATHER_MS)
    await flush(() => r.sinks[1]!.installed.length > 0)
    expect(r.sinks[0]!.sent).toEqual([0])
    await vi.advanceTimersByTimeAsync(KEY_READY_TIMEOUT_MS - 1)
    expect(r.sinks[0]!.sent).toEqual([0])
    await vi.advanceTimersByTimeAsync(1)
    expect(r.sinks[0]!.sent).toEqual([0, 1])
  })

  it('authenticates the recipient, room, generation and nonce before accepting an ACK', async () => {
    const r = await room()
    r.route((_from, to, payload) => to !== 0 || !readKeyAcknowledgement(payload))
    r.sessions[0]!.setMembers([])
    r.sessions[1]!.setMembers([member(r.devices[0]!)])
    r.sessions[0]!.setMembers([member(r.devices[1]!)])
    await vi.advanceTimersByTimeAsync(ROTATION_GATHER_MS)
    await flush(() => r.messages.some((message) => message.from === 1 && readKeyAcknowledgement(message.payload)))
    const acknowledgement = r.messages.find((message) => message.from === 1 && readKeyAcknowledgement(message.payload))!.payload
    const receipt = readKeyAcknowledgement(acknowledgement)!
    const context = { room: 'voice:1', senderDevice: senderId(member(r.devices[0]!)), recipientDevice: senderId(member(r.devices[1]!)) }
    const forged = await wrapKeyAcknowledgement(r.devices[2]!.privateKey, r.publicKeys[0]!, context, receipt.keyId, receipt.gen, receipt.nonce)
    await r.sessions[0]!.receiveKey(member(r.devices[1]!), forged)
    const wrongRoom = await wrapKeyAcknowledgement(r.devices[1]!.privateKey, r.publicKeys[0]!, { ...context, room: 'voice:2' }, receipt.keyId, receipt.gen, receipt.nonce)
    await r.sessions[0]!.receiveKey(member(r.devices[1]!), wrongRoom)
    const changed = JSON.parse(new TextDecoder().decode(base64Decode(acknowledgement)))
    changed.gen++
    await r.sessions[0]!.receiveKey(member(r.devices[1]!), btoa(JSON.stringify(changed)))
    expect(r.sinks[0]!.sent).toEqual([0])
    await r.sessions[0]!.receiveKey(member(r.devices[1]!), acknowledgement)
    expect(r.sinks[0]!.sent).toEqual([0, 1])
    expect(r.errors).toHaveLength(2)
  })

  it('does not give a new entrant the key used for earlier solo audio, even on an eager key request', async () => {
    const r = await room(2)
    r.sessions[0]!.setMembers([])
    r.sessions[1]!.setMembers([member(r.devices[0]!)])
    r.sessions[0]!.setMembers([member(r.devices[1]!)])
    r.sessions[0]!.resendTo(member(r.devices[1]!))
    await flush()
    expect(r.messages.filter((message) => message.from === 0 && !readKeyAcknowledgement(message.payload))).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(ROTATION_GATHER_MS)
    await flush(() => r.sinks[0]!.sent.length === 2)
    expect(r.sinks[1]!.installed.filter((key) => key.from === senderId(member(r.devices[0]!))).map((key) => key.keyId)).toEqual([1])
  })

  it('never activates an abandoned key after a departure or a late worker completion', async () => {
    const r = await room(), gate = deferred()
    r.sinks[2]!.gate = gate.promise
    r.sessions[0]!.setMembers([])
    r.sessions[1]!.setMembers([member(r.devices[0]!)])
    r.sessions[2]!.setMembers([member(r.devices[0]!)])
    r.sessions[0]!.setMembers([member(r.devices[1]!), member(r.devices[2]!)])
    await vi.advanceTimersByTimeAsync(ROTATION_GATHER_MS)
    await flush(() => r.sinks[1]!.installed.length > 0)
    r.sessions[0]!.setMembers([member(r.devices[1]!)])
    gate.resolve()
    await flush()
    expect(r.sinks[0]!.sent).toEqual([0])
    await vi.advanceTimersByTimeAsync(2_000)
    await flush(() => r.sinks[0]!.sent.length === 2)
    expect(r.sinks[0]!.sent).toEqual([0, 2])
  })

  it('does not let one stalled recipient block the rest of the room indefinitely', async () => {
    const r = await room(), gate = deferred()
    r.sinks[2]!.gate = gate.promise
    r.sessions[0]!.setMembers([])
    r.sessions[1]!.setMembers([member(r.devices[0]!)])
    r.sessions[2]!.setMembers([member(r.devices[0]!)])
    r.sessions[0]!.setMembers([member(r.devices[1]!), member(r.devices[2]!)])
    await vi.advanceTimersByTimeAsync(ROTATION_GATHER_MS)
    await flush(() => r.sinks[1]!.installed.length > 0)
    expect(r.sinks[0]!.sent).toEqual([0])
    await vi.advanceTimersByTimeAsync(KEY_READY_TIMEOUT_MS)
    expect(r.sinks[0]!.sent).toEqual([0, 1])
    r.sessions[0]!.close()
    gate.resolve()
    await flush()
    expect(r.sinks[0]!.sent).toEqual([0, 1])
  })
})
