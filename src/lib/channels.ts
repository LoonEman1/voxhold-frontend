import type { Channel } from '../domain/types'

export function pickDefaultChannel(channels: readonly Channel[]): Channel | null {
  return channels.find((channel) => channel.kind !== 'voice') ?? channels[0] ?? null
}
