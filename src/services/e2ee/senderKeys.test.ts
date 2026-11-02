import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDevice, ensureDevice, forgetDevice, type E2EEStore, type LocalDevice, type SeenKeys } from './deviceKeys'
import { base64Decode, importDevicePublicKey, readKeyAcknowledgement, unwrapSenderKey, wrapSenderKey } from './keyWrap'
import { rememberPeerKeys, safetyCode } from './safetyCode'
import { SenderKeySession, senderId, type RoomMember, type SenderKeySink } from './senderKeys'
import { createFrameProcessor, type WorkerEvent } from './frameProcessor'

class MemoryStore implements E2EEStore {
  devices = new Map<number, LocalDevice>()
  seen = new Map<number, SeenKeys>()
  async getDevice(userId: number) { return this.devices.get(userId) }
  async putDevice(device: LocalDevice) { this.devices.set(device.userId, device) }
  async deleteDevice(userId: number) { this.devices.delete(userId) }
  async getSeen(userId: number) { return this.seen.get(userId) }
  async putSeen(value: SeenKeys) { this.seen.set(value.userId, value) }
}

const member = (device: LocalDevice): RoomMember => ({ userId: device.userId, deviceId: device.deviceId })

class RecordingSink implements SenderKeySink {
  sendKeys: number[] = []
  received: Array<{ senderId: string; keyId: number; key: Uint8Array }> = []
  removed: string[] = []
  setSendKey(keyId: number) { this.sendKeys.push(keyId) }
  addReceiveKey(senderId: string, keyId: number, key: Uint8Array) { this.received.push({ senderId, keyId, key }) }
  removeSender(senderId: string) { this.removed.push(senderId) }
}

afterEach(() => { vi.useRealTimers() })
// Timers are fake, but WebCrypto finishes on the thread pool: keep setImmediate real.
const useClock = () => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
const realTurn = () => new Promise<void>((resolve) => (globalThis as unknown as { setImmediate: (callback: () => void) => void }).setImmediate(resolve))
// A fixed number of turns is not enough on a loaded CI runner: after the usual
// 40, keep turning until the expected state is reached (at most 10 s, real time).
async function turnUntil(check: () => boolean, between: () => Promise<unknown> = async () => undefined) {
  const deadline = performance.now() + 10_000
  for (let round = 0; round < 40 || (!check() && performance.now() < deadline); round++) {
    await realTurn(); await between(); await vi.advanceTimersByTimeAsync(0)
  }
}

describe('key wrapping', () => {
  it('lets only the intended device unwrap a sender key', async () => {
    const [alice, bob, eve] = await Promise.all([createDevice(1), createDevice(2), createDevice(3)])
    const key = crypto.getRandomValues(new Uint8Array(32))
    const context = { room: 'voice:5', senderDevice: `1:${alice.deviceId}`, recipientDevice: `2:${bob.deviceId}` }
    const alicePublic = await importDevicePublicKey(alice.publicKey)
    const payload = await wrapSenderKey(alice.privateKey, await importDevicePublicKey(bob.publicKey), context, 6, 1_000, key)
    const unwrapped = await unwrapSenderKey(bob.privateKey, alicePublic, context, payload)
    expect(unwrapped.keyId).toBe(6)
    expect(unwrapped.gen).toBe(1_000)
    expect(Array.from(unwrapped.key)).toEqual(Array.from(key))
    await expect(unwrapSenderKey(eve.privateKey, alicePublic, context, payload)).rejects.toThrow()
    await expect(unwrapSenderKey(bob.privateKey, alicePublic, { ...context, room: 'voice:6' }, payload)).rejects.toThrow()
    const tampered = JSON.parse(new TextDecoder().decode(base64Decode(payload)))
    tampered.key_id = 5
    await expect(unwrapSenderKey(bob.privateKey, alicePublic, context, btoa(JSON.stringify(tampered)))).rejects.toThrow()
    // The generation is authenticated: a relay cannot pass an old key for a newer one.
    tampered.key_id = 6
    tampered.gen = 2_000
    await expect(unwrapSenderKey(bob.privateKey, alicePublic, context, btoa(JSON.stringify(tampered)))).rejects.toThrow()
  })

  it('keeps the private device key non-extractable', async () => {
    const device = await createDevice(1)
    expect(device.privateKey.extractable).toBe(false)
    expect(device.publicKey.length).toBe(65)
    expect(device.deviceId).toMatch(/^[0-9a-f]{32}$/)
  })
})

describe('device registration', () => {
  it('does not register or persist a device if the join was canceled during the store read', async () => {
    const store = new MemoryStore(), controller = new AbortController()
    let complete!: (device: LocalDevice | undefined) => void
    vi.spyOn(store, 'getDevice').mockImplementationOnce(() => new Promise((resolve) => { complete = resolve }))
    const registry = { register: vi.fn(async () => undefined), revoke: vi.fn(async () => undefined) }
    const joining = ensureDevice(store, registry, 9, undefined, controller.signal)
    controller.abort()
    complete(undefined)
    await expect(joining).rejects.toMatchObject({ name: 'AbortError' })
    expect(registry.register).not.toHaveBeenCalled()
    expect(store.devices.size).toBe(0)
  })

  it('registers before every call, replaces a refused device and forgets it on logout', async () => {
    const store = new MemoryStore()
    const registered: string[] = []
    const revoked: string[] = []
    let refuse = true
    const registry = {
      register: async (deviceId: string) => { if (refuse) { refuse = false; throw Object.assign(new Error('conflict'), { status: 409 }) } registered.push(deviceId) },
      revoke: async (deviceId: string) => { revoked.push(deviceId) },
    }
    await store.putDevice(await createDevice(9))
    const stale = (await store.getDevice(9))!.deviceId
    const device = await ensureDevice(store, registry, 9)
    expect(device.deviceId).not.toBe(stale)
    expect(registered).toEqual([device.deviceId])
    // Registering again is how the server learns the device is in use (and how
    // an evicted device finds out it must be replaced).
    expect((await ensureDevice(store, registry, 9)).deviceId).toBe(device.deviceId)
    expect(registered).toEqual([device.deviceId, device.deviceId])
    await forgetDevice(store, registry, 9)
    expect(await store.getDevice(9)).toBeUndefined()
    expect(revoked).toEqual([device.deviceId])
  })
})

describe('sender key session', () => {
  async function room(count: number) {
    const devices = await Promise.all(Array.from({ length: count }, (_, index) => createDevice(index + 1)))
    const publicKeys = new Map(await Promise.all(devices.map(async (device) => [senderId(member(device)), await importDevicePublicKey(device.publicKey)] as const)))
    const sinks = devices.map(() => new RecordingSink())
    const sessions: SenderKeySession[] = []
    const deliveries: Array<Promise<void>> = []
    const sent: Array<{ from: number; payload: string }> = []
    devices.forEach((device, index) => {
      sessions.push(new SenderKeySession({
        room: 'voice:1',
        self: device,
        sink: sinks[index]!,
        directory: { publicKey: async (target) => publicKeys.get(senderId(target))! },
        transport: {
          sendKey: (to, payload) => { sent.push({ from: index, payload }); const target = devices.findIndex((d) => d.deviceId === to.deviceId); deliveries.push(sessions[target]!.receiveKey(member(device), payload)) },
          requestKey: (to) => { const target = devices.findIndex((d) => d.deviceId === to.deviceId); sessions[target]!.resendTo(member(device)) },
        },
      }))
    })
    const settle = (check: () => boolean = () => true) => turnUntil(check, () => Promise.all(deliveries.splice(0)))
    return { devices, sinks, sessions, settle, sent }
  }

  it('distributes the first key immediately and activates later keys as soon as peers ACK', async () => {
    useClock()
    const { devices, sinks, sessions, settle } = await room(3)
    const [alice, bob, carol] = devices as [LocalDevice, LocalDevice, LocalDevice]
    sessions.forEach((session) => session.start())
    await settle()
    expect(sinks[0]!.sendKeys).toEqual([0])
    const fromAlice = (sink: RecordingSink) => sink.received.filter((entry) => entry.senderId === senderId(member(alice)))
    sessions[0]!.setMembers([member(bob)])
    sessions[1]!.setMembers([member(alice)])
    await settle(() => fromAlice(sinks[1]!).length >= 1)
    expect(fromAlice(sinks[1]!).map((entry) => entry.keyId)).toEqual([0])
    // Bootstrap distribution must never reinstall/reset this already active key.
    expect(sinks[0]!.sendKeys).toEqual([0])

    // Carol joins: Alice rotates and Carol gets only the new key.
    sessions[0]!.setMembers([member(bob), member(carol)])
    sessions[1]!.setMembers([member(alice), member(carol)])
    sessions[2]!.setMembers([member(alice), member(bob)])
    await vi.advanceTimersByTimeAsync(2_000)
    await settle(() => sinks[0]!.sendKeys.length === 2)
    expect(fromAlice(sinks[2]!).map((entry) => entry.keyId)).toEqual([1])
    expect(sinks[0]!.sendKeys).toEqual([0, 1])

    // Bob leaves: Alice forgets his keys and he never sees her next key.
    const bobKnows = fromAlice(sinks[1]!).length
    sessions[0]!.setMembers([member(carol)])
    sessions[2]!.setMembers([member(alice)])
    sessions[1]!.setMembers([])
    await vi.advanceTimersByTimeAsync(2_000)
    await settle(() => fromAlice(sinks[2]!).length >= 2)
    expect(sinks[0]!.removed).toContain(senderId(member(bob)))
    expect(fromAlice(sinks[1]!)).toHaveLength(bobKnows)
    expect(fromAlice(sinks[2]!).map((entry) => entry.keyId)).toEqual([1, 2])
    sessions.forEach((session) => session.close())
  })

  it('folds ten joins within a second into one rotation', async () => {
    useClock()
    const { devices, sessions, settle } = await room(11)
    const sent: string[] = []
    const alice = new SenderKeySession({
      room: 'voice:1', self: devices[0]!, sink: new RecordingSink(),
      directory: { publicKey: (target) => importDevicePublicKey(devices.find((device) => device.deviceId === target.deviceId)!.publicKey) },
      transport: { sendKey: (to) => sent.push(to.deviceId), requestKey: () => undefined },
    })
    alice.start()
    alice.setMembers([]) // Already in a room alone: a newcomer needs a new key.
    await settle()
    const others = devices.slice(1).map(member)
    for (let count = 1; count <= 10; count++) {
      alice.setMembers(others.slice(0, count))
      await vi.advanceTimersByTimeAsync(90)
    }
    await vi.advanceTimersByTimeAsync(2_000)
    await settle(() => sent.length >= 10)
    expect(sent).toHaveLength(10)
    expect(new Set(sent).size).toBe(10)
    alice.close()
    sessions.forEach((session) => session.close())
  })

  it('installs only newer keys of a sender, and its current key again after it left', async () => {
    useClock()
    const [alice, bob] = await Promise.all([createDevice(1), createDevice(2)])
    const keys = new Map([[alice.deviceId, await importDevicePublicKey(alice.publicKey)], [bob.deviceId, await importDevicePublicKey(bob.publicKey)]])
    const directory = { publicKey: async (target: RoomMember) => keys.get(target.deviceId)! }
    const payloads: string[] = []
    const sender = new SenderKeySession({ room: 'voice:1', self: alice, sink: new RecordingSink(), directory, transport: { sendKey: (_to, payload) => payloads.push(payload), requestKey: () => undefined } })
    const sink = new RecordingSink()
    const receiver = new SenderKeySession({ room: 'voice:1', self: bob, sink, directory, transport: { sendKey: () => undefined, requestKey: () => undefined } })
    sender.start()
    sender.setMembers([member(bob)])
    receiver.setMembers([member(alice)])
    await vi.advanceTimersByTimeAsync(2_000)
    await turnUntil(() => payloads.length >= 1)
    sender.forceRotation()
    await vi.advanceTimersByTimeAsync(2_000)
    await turnUntil(() => payloads.length >= 2)
    const [older, newer] = payloads as [string, string]
    expect(payloads).toHaveLength(2)

    await receiver.receiveKey(member(alice), newer)
    await receiver.receiveKey(member(alice), older) // rollback by the relay
    await receiver.receiveKey(member(alice), newer) // replay: would reset the replay window
    expect(sink.received.map((entry) => entry.keyId)).toEqual([1])

    // Alice left and came back: her keys were dropped, so the current one is needed again.
    receiver.setMembers([])
    receiver.setMembers([member(alice)])
    await receiver.receiveKey(member(alice), older)
    await receiver.receiveKey(member(alice), newer)
    expect(sink.received.map((entry) => entry.keyId)).toEqual([1, 1])
    sender.close()
    receiver.close()
  })

  it('resends its key without reinstalling it or resetting the replay window', async () => {
    useClock()
    const { devices, sinks, sessions, settle, sent } = await room(2)
    sessions[0]!.start()
    sessions[0]!.setMembers([member(devices[1]!)])
    sessions[1]!.setMembers([member(devices[0]!)])
    await vi.advanceTimersByTimeAsync(1_000)
    await settle()
    const before = sent.filter((item) => item.from === 0 && !readKeyAcknowledgement(item.payload)).length
    const installed = sinks[1]!.received.length
    sessions[1]!.requestKey(member(devices[0]!))
    await settle(() => sent.filter((item) => item.from === 0 && !readKeyAcknowledgement(item.payload)).length > before)
    expect(sinks[1]!.received.length).toBe(installed)
    sessions.forEach((session) => session.close())
  })
})

describe('security code and key trust', () => {
  it('is symmetric, 60 digits and changes with any key', async () => {
    const one = { userId: 1, publicKeys: ['AAA', 'BBB'] }
    const two = { userId: 2, publicKeys: ['CCC'] }
    const code = await safetyCode(one, two)
    expect(code).toMatch(/^(\d{5} ){11}\d{5}$/)
    expect(await safetyCode(two, { userId: 1, publicKeys: ['BBB', 'AAA'] })).toBe(code)
    expect(await safetyCode(one, { userId: 2, publicKeys: ['CCD'] })).not.toBe(code)
  })

  it('warns when a peer key changes but not when a device logs out', async () => {
    const store = new MemoryStore()
    expect(await rememberPeerKeys(store, 5, { a: 'k1', b: 'k2' })).toBe('first_seen')
    expect(await rememberPeerKeys(store, 5, { a: 'k1', b: 'k2' })).toBe('unchanged')
    expect(await rememberPeerKeys(store, 5, { a: 'k1' })).toBe('unchanged')
    expect(await rememberPeerKeys(store, 5, { a: 'k9' })).toBe('changed')
    expect(await rememberPeerKeys(store, 5, { a: 'k9', c: 'k3' })).toBe('changed')
  })
})

describe('frame processor', () => {
  it('requests a missing key immediately and rate-limits retries', async () => {
    let clock = 0
    const events: WorkerEvent[] = []
    const sender = createFrameProcessor(() => undefined, () => clock)
    const receiver = createFrameProcessor((event) => events.push(event), () => clock)
    const key = crypto.getRandomValues(new Uint8Array(32))
    await sender.command({ type: 'sendKey', keyId: 2, key })
    const frame = Uint8Array.of(0x78, 1, 2, 3, 4)
    const sealed = (await sender.process({ role: 'send', kind: 'audio' }, frame))!
    const options = { role: 'recv' as const, kind: 'audio' as const, receiverId: 'mid-1' }
    expect(await receiver.process(options, sealed)).toBeNull() // not mapped yet
    await receiver.command({ type: 'mapReceiver', receiverId: 'mid-1', senderId: '7:dev' })
    expect(await receiver.process(options, sealed)).toBeNull()
    expect(events.filter((event) => event.type === 'missingKey')).toHaveLength(1)
    clock = 1_000
    expect(await receiver.process(options, sealed)).toBeNull()
    expect(events.filter((event) => event.type === 'missingKey')).toHaveLength(1)
    clock = 2_500
    expect(await receiver.process(options, (await sender.process({ role: 'send', kind: 'audio' }, frame))!)).toBeNull()
    expect(events).toContainEqual({ type: 'missingKey', senderId: '7:dev' })
    expect(events.filter((event) => event.type === 'missingKey')).toHaveLength(2)
    await receiver.command({ type: 'receiveKey', senderId: '7:dev', keyId: 2, key })
    const plain = await receiver.process(options, (await sender.process({ role: 'send', kind: 'audio' }, frame))!)
    expect(Array.from(plain!)).toEqual(Array.from(frame))
    sender.close()
    receiver.close()
  })

  it('applies commands in order although key derivation is asynchronous', async () => {
    const sender = createFrameProcessor(() => undefined, () => 0)
    const receiver = createFrameProcessor(() => undefined, () => 0)
    const key = crypto.getRandomValues(new Uint8Array(32))
    await sender.command({ type: 'sendKey', keyId: 1, key })
    const sealed = (await sender.process({ role: 'send', kind: 'audio' }, Uint8Array.of(0x78, 1, 2, 3)))!
    void receiver.command({ type: 'mapReceiver', receiverId: 'mid-1', senderId: '7:dev' })
    void receiver.command({ type: 'receiveKey', senderId: '7:dev', keyId: 1, key })
    // Sent last, so it must also apply last: no key of the departed sender stays.
    await receiver.command({ type: 'removeSender', senderId: '7:dev' })
    await new Promise((resolve) => setTimeout(resolve, 50)) // let any late key derivation land
    expect(await receiver.process({ role: 'recv', kind: 'audio', receiverId: 'mid-1' }, sealed)).toBeNull()
    sender.close()
    receiver.close()
  })
})
