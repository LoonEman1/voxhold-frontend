import { describe, expect, it } from 'vitest'
import type { VoxholdApi } from '../api'
import { createDevice, type E2EEStore, type LocalDevice, type SeenKeys } from './deviceKeys'
import { base64Encode } from './keyWrap'
import { userSafetyCode } from './runtime'

class MemoryStore implements E2EEStore {
  devices = new Map<number, LocalDevice>()
  seen = new Map<number, SeenKeys>()
  async getDevice(userId: number) { return this.devices.get(userId) }
  async putDevice(device: LocalDevice) { this.devices.set(device.userId, device) }
  async deleteDevice(userId: number) { this.devices.delete(userId) }
  async getSeen(userId: number) { return this.seen.get(userId) }
  async putSeen(value: SeenKeys) { this.seen.set(value.userId, value) }
}

const listing = (devices: LocalDevice[]) => devices.map((device) => ({ device_id: device.deviceId, public_key: base64Encode(device.publicKey), created_at: 1 }))
const serving = (lists: Record<number, LocalDevice[]>) => ({ e2ee: { devices: async (_token: string, userId: number) => listing(lists[userId] ?? []) } }) as unknown as VoxholdApi

describe('safety code', () => {
  it('refuses a code whose own key list lacks this device', async () => {
    const [mine, substitute, theirs] = await Promise.all([createDevice(1), createDevice(1), createDevice(2)])
    const store = new MemoryStore()
    await store.putDevice(mine)
    // A server that substitutes keys on both sides shows each user a fake own key.
    await expect(userSafetyCode(serving({ 1: [substitute], 2: [theirs] }), 'token', 1, 2, store)).rejects.toThrow('Ключа этого устройства нет')
    const result = await userSafetyCode(serving({ 1: [mine], 2: [theirs] }), 'token', 1, 2, store)
    expect(result).toMatchObject({ myDevices: 1, theirDevices: 1, keyChanged: false })
    expect(result.code).toMatch(/^(\d{5} ){11}\d{5}$/)
  })

  it('shares the trust record with calls', async () => {
    const [mine, theirs, other] = await Promise.all([createDevice(1), createDevice(2), createDevice(2)])
    const store = new MemoryStore()
    await store.putDevice(mine)
    // A call saw one key of user 2; the dialog is served another.
    await store.putSeen({ userId: 2, keys: Object.fromEntries(listing([theirs]).map((device) => [device.device_id, device.public_key])) })
    const result = await userSafetyCode(serving({ 1: [mine], 2: [other] }), 'token', 1, 2, store)
    expect(result.keyChanged).toBe(true)
    expect(Object.keys((await store.getSeen(2))!.keys)).toEqual([other.deviceId])
  })

  it('needs a device that took part in an encrypted call', async () => {
    const theirs = await createDevice(2)
    await expect(userSafetyCode(serving({ 2: [theirs] }), 'token', 1, 2, new MemoryStore())).rejects.toThrow('уже подключалось')
  })
})
