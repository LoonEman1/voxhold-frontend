import { afterEach, describe, expect, it, vi } from 'vitest'
import type { E2EEDevice } from '../../domain/types'
import { createDevice, type E2EEStore, type LocalDevice, type SeenKeys } from './deviceKeys'
import type { WorkerEvent } from './frameProcessor'
import { base64Encode } from './keyWrap'
import type { RoomMember } from './senderKeys'
import { CallE2EE, createKeyDirectory } from './voiceE2EE'

// There is no Worker in tests: record what CallE2EE asks of the media worker and the session.
const media = vi.hoisted(() => ({ mapped: [] as Array<[string, string | null]>, emit: null as ((event: WorkerEvent) => void) | null, closed: 0 }))
const session = vi.hoisted(() => ({ members: [] as unknown[][], requested: [] as unknown[], rotations: 0, closed: 0 }))

vi.mock('./mediaTransform', () => ({
  E2EEMediaTransform: class {
    constructor(_mode: string, onEvent: (event: WorkerEvent) => void) { media.emit = onEvent }
    mapReceiver(receiverId: string, sender: string | null) { media.mapped.push([receiverId, sender]) }
    setSendKey() {}
    addReceiveKey() {}
    removeSender() {}
    close() { media.closed++ }
  },
}))

vi.mock('./senderKeys', async (original) => {
  const actual = await original<typeof import('./senderKeys')>()
  return {
    ...actual,
    SenderKeySession: class {
      private list: RoomMember[] = []
      start() {}
      setMembers(list: RoomMember[]) { this.list = list; session.members.push(list) }
      memberBySender(id: string) { return this.list.find((member) => actual.senderId(member) === id) }
      requestKey(member: RoomMember) { session.requested.push(member) }
      forceRotation() { session.rotations++ }
      receiveKey() { return Promise.resolve() }
      resendTo() {}
      close() { session.closed++ }
    },
  }
})

class MemoryStore implements E2EEStore {
  seen = new Map<number, SeenKeys>()
  async getDevice() { return undefined }
  async putDevice() {}
  async deleteDevice() {}
  async getSeen(userId: number) { return this.seen.get(userId) }
  async putSeen(value: SeenKeys) { this.seen.set(value.userId, value) }
}

const device = (value: LocalDevice): E2EEDevice => ({ device_id: value.deviceId, public_key: base64Encode(value.publicKey), created_at: 1 })
const transport = { sendKey: vi.fn(), requestKey: vi.fn() }

afterEach(() => {
  media.mapped = []; media.emit = null; media.closed = 0
  session.members = []; session.requested = []; session.rotations = 0; session.closed = 0
})

describe('CallE2EE', () => {
  it('maps every receiver to the device of the connection that owns it', async () => {
    const self = await createDevice(1)
    const call = new CallE2EE({ room: 'voice:8', mode: 'script', device: self, directory: { publicKey: vi.fn() }, transport })
    call.setParticipants([
      { connectionId: 'c1', userId: 1, deviceId: self.deviceId },
      { connectionId: 'c2', userId: 2, deviceId: 'b'.repeat(32) },
      { connectionId: 'c3', userId: 3 },
    ])
    // A participant without a device cannot take part in the key exchange.
    expect(session.members.at(-1)).toEqual([{ userId: 1, deviceId: self.deviceId }, { userId: 2, deviceId: 'b'.repeat(32) }])

    call.setReceiverOwners(new Map([['0', 'c2'], ['1', 'c3']]))
    expect(media.mapped).toEqual([['0', `2:${'b'.repeat(32)}`], ['1', null]])

    // Unchanged owners are not posted to the worker again; a receiver that moves or disappears is.
    call.setReceiverOwners(new Map([['0', 'c2']]))
    call.setParticipants([{ connectionId: 'c1', userId: 1, deviceId: self.deviceId }, { connectionId: 'c2', userId: 2, deviceId: 'c'.repeat(32) }])
    expect(media.mapped.slice(2)).toEqual([['0', `2:${'c'.repeat(32)}`]])
    call.setReceiverOwners(new Map())
    expect(media.mapped.slice(3)).toEqual([['0', null]])

    call.close()
    expect(session.closed).toBe(1)
    expect(media.closed).toBe(1)
  })

  it('asks the sender for a key after missing frames and rotates when the counter runs out', async () => {
    const self = await createDevice(1)
    const call = new CallE2EE({ room: 'voice:8', mode: 'streams', device: self, directory: { publicKey: vi.fn() }, transport })
    call.setParticipants([{ connectionId: 'c1', userId: 1, deviceId: self.deviceId }, { connectionId: 'c2', userId: 2, deviceId: 'b'.repeat(32) }])
    media.emit?.({ type: 'missingKey', senderId: `2:${'b'.repeat(32)}` })
    media.emit?.({ type: 'missingKey', senderId: `9:${'d'.repeat(32)}` })
    expect(session.requested).toEqual([{ userId: 2, deviceId: 'b'.repeat(32) }])
    media.emit?.({ type: 'exhausted' })
    expect(session.rotations).toBe(1)
    call.close()
  })
})

describe('key directory', () => {
  it('trusts the first key, warns when it changes and refetches an unknown device once', async () => {
    const [first, second, third] = await Promise.all([createDevice(2), createDevice(2), createDevice(2)])
    const store = new MemoryStore()
    const onKeyChanged = vi.fn()
    let current = [device(first)]
    const fetchDevices = vi.fn(async () => current)
    const directory = createKeyDirectory(fetchDevices, store, onKeyChanged)

    const key = await directory.publicKey({ userId: 2, deviceId: first.deviceId })
    expect(key.type).toBe('public')
    await directory.publicKey({ userId: 2, deviceId: first.deviceId })
    expect(fetchDevices).toHaveBeenCalledTimes(1)
    expect(onKeyChanged).not.toHaveBeenCalled()

    // A device registered after the cached fetch is picked up with one refresh, and reported.
    current = [device(first), device(second)]
    await directory.publicKey({ userId: 2, deviceId: second.deviceId })
    expect(fetchDevices).toHaveBeenCalledTimes(2)
    expect(onKeyChanged).toHaveBeenCalledWith(2)

    await expect(directory.publicKey({ userId: 2, deviceId: third.deviceId })).rejects.toThrow('unknown e2ee device')
    expect(fetchDevices).toHaveBeenCalledTimes(3)
  })
})
