import type { ChannelActivity } from './realtime'

export interface ChannelActivityUpdate {
  serverId: number
  channelId: number
  messageId: number
  ownMessageId: number
}

/** One update per channel every 250 ms; preserve your read cursor separately. */
export class ChannelActivityBatch {
  private readonly pending = new Map<string, ChannelActivityUpdate>()
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly userId: number, private readonly apply: (updates: ChannelActivityUpdate[]) => void) {}

  add(event: ChannelActivity) {
    const id = `${event.server_id}:${event.channel_id}`
    const current = this.pending.get(id)
    this.pending.set(id, {
      serverId: event.server_id, channelId: event.channel_id,
      messageId: Math.max(current?.messageId ?? 0, event.message_id),
      ownMessageId: Math.max(current?.ownMessageId ?? 0, event.author_user_id === this.userId ? event.message_id : 0),
    })
    this.timer ??= setTimeout(() => {
      this.timer = null
      const updates = [...this.pending.values()]
      this.pending.clear()
      this.apply(updates)
    }, 250)
  }

  close() {
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
    this.pending.clear()
  }
}
