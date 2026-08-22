import type { Channel, ChannelRead } from '../domain/types'

export function channelHasUnreadMessages(channel: Channel, read?: ChannelRead): boolean {
  return channel.kind === 'text' &&
    (channel.last_message_id ?? 0) > (read?.last_read_message_id ?? 0)
}
