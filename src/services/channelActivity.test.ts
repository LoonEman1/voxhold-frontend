import { afterEach, expect, it, vi } from 'vitest'
import { ChannelActivityBatch } from './channelActivity'

afterEach(() => vi.useRealTimers())

it('coalesces a burst while preserving monotonic activity and your own read cursor', async () => {
  vi.useFakeTimers()
  const apply = vi.fn(), batch = new ChannelActivityBatch(1, apply)
  for (let id = 1; id <= 200; id++) batch.add({ server_id: 1, channel_id: 2, message_id: id, author_user_id: id === 150 ? 1 : 2 })
  batch.add({ server_id: 2, channel_id: 2, message_id: 300, author_user_id: 3 })
  batch.add({ server_id: 1, channel_id: 2, message_id: 50, author_user_id: 2 })
  expect(apply).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(250)
  expect(apply).toHaveBeenCalledExactlyOnceWith([
    { serverId: 1, channelId: 2, messageId: 200, ownMessageId: 150 },
    { serverId: 2, channelId: 2, messageId: 300, ownMessageId: 0 },
  ])
  batch.close()
})

it('bounds continuous activity to four applications per second and cancels pending work', async () => {
  vi.useFakeTimers()
  const apply = vi.fn(), batch = new ChannelActivityBatch(1, apply)
  for (let id = 1; id <= 20; id++) {
    batch.add({ server_id: 1, channel_id: 2, message_id: id, author_user_id: 2 })
    await vi.advanceTimersByTimeAsync(50)
  }
  expect(apply).toHaveBeenCalledTimes(4)
  batch.add({ server_id: 1, channel_id: 2, message_id: 21, author_user_id: 2 })
  batch.close()
  await vi.advanceTimersByTimeAsync(1_000)
  expect(apply).toHaveBeenCalledTimes(4)
})
