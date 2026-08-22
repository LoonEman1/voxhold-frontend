import { describe, expect, it } from 'vitest'
import type { Channel, ChannelRead } from '../domain/types'
import { channelHasUnreadMessages } from './channelUnread'

const channel: Channel = {
  id: 10,
  server_id: 1,
  name: 'general',
  kind: 'text',
  position: 0,
  created_by: 1,
  created_at: 100,
  last_message_id: 105,
}

const read: ChannelRead = {
  server_id: 1,
  channel_id: 10,
  user_id: 7,
  last_read_message_id: 100,
  updated_at: 101,
}

describe('channelHasUnreadMessages', () => {
  it('detects messages newer than the read cursor', () => {
    expect(channelHasUnreadMessages(channel, read)).toBe(true)
  })

  it('treats an equal read cursor as read', () => {
    expect(channelHasUnreadMessages(channel, {
      ...read,
      last_read_message_id: channel.last_message_id ?? 0,
    })).toBe(false)
  })

  it('uses zero when a read cursor is absent', () => {
    expect(channelHasUnreadMessages(channel)).toBe(true)
  })

  it('does not mark voice channels or legacy channel events as unread', () => {
    expect(channelHasUnreadMessages({ ...channel, kind: 'voice' }, read)).toBe(false)
    expect(channelHasUnreadMessages({ ...channel, last_message_id: undefined }, read)).toBe(false)
  })
})
