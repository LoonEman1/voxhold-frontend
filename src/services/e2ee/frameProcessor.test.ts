import { afterEach, expect, it, vi } from 'vitest'
import { createFrameProcessor } from './frameProcessor'

afterEach(() => vi.useRealTimers())

it('retains the superseded key for ten seconds from replacement, including reused slots', async () => {
  vi.useFakeTimers()
  const sender = createFrameProcessor(() => undefined)
  const receiver = createFrameProcessor(() => undefined)
  const frame = Uint8Array.of(0x78, 1, 2, 3)
  const incoming = { role: 'recv' as const, kind: 'audio' as const, receiverId: 'receiver' }
  await receiver.command({ type: 'mapReceiver', receiverId: 'receiver', senderId: 'peer' })
  try {
    let delayed: Uint8Array<ArrayBuffer> | null = null
    for (let generation = 0; generation <= 9; generation++) {
      const keyId = generation % 8, key = crypto.getRandomValues(new Uint8Array(32))
      await sender.command({ type: 'sendKey', keyId, key })
      await receiver.command({ type: 'receiveKey', senderId: 'peer', keyId, key })
      if (generation === 1 || generation === 8) delayed = await sender.process({ role: 'send', kind: 'audio' }, frame)
      if (generation === 5 || generation === 9) {
        expect(await receiver.process(incoming, delayed!)).toEqual(frame)
      }
      await vi.advanceTimersByTimeAsync(2_000)
    }
  } finally { sender.close(); receiver.close() }
})

it('retires old receive keys and clears retirement timers when closed', async () => {
  vi.useFakeTimers()
  const sender = createFrameProcessor(() => undefined)
  const receiver = createFrameProcessor(() => undefined)
  const incoming = { role: 'recv' as const, kind: 'audio' as const, receiverId: 'receiver' }
  await receiver.command({ type: 'mapReceiver', receiverId: 'receiver', senderId: 'peer' })
  const key = crypto.getRandomValues(new Uint8Array(32))
  await sender.command({ type: 'sendKey', keyId: 0, key })
  await receiver.command({ type: 'receiveKey', senderId: 'peer', keyId: 0, key })
  const delayed = (await sender.process({ role: 'send', kind: 'audio' }, Uint8Array.of(0x78, 1)))!
  await receiver.command({ type: 'receiveKey', senderId: 'peer', keyId: 1, key: crypto.getRandomValues(new Uint8Array(32)) })
  await vi.advanceTimersByTimeAsync(10_001)
  expect(await receiver.process(incoming, delayed)).toBeNull()
  sender.close(); receiver.close()
  expect(vi.getTimerCount()).toBe(0)
})
