import type { ActiveStream, StreamStopped } from '../domain/types'

export type StreamCatalog = Record<string, ActiveStream>
export function indexStreams(streams: ActiveStream[]): StreamCatalog {
  return Object.fromEntries(streams.map((stream) => [stream.publisher_connection_id, stream]))
}
export function streamsInChannel(catalog: StreamCatalog, channelId: number) {
  return Object.values(catalog).filter((stream) => stream.channel_id === channelId)
    .sort((a, b) => (a.started_at_ms ?? 0) - (b.started_at_ms ?? 0) || a.publisher_connection_id.localeCompare(b.publisher_connection_id))
}
export function streamInChannel(catalog: StreamCatalog, channelId: number, publisherId?: string) {
  if (publisherId !== undefined) return catalog[publisherId]?.channel_id === channelId ? catalog[publisherId]! : null
  return streamsInChannel(catalog, channelId)[0] ?? null
}
export function withoutStoppedStream(catalog: StreamCatalog, event: Pick<StreamStopped, 'channel_id' | 'publisher_connection_id'>): StreamCatalog {
  const entries = Object.entries(catalog).filter(([id, stream]) => stream.channel_id !== event.channel_id || event.publisher_connection_id && id !== event.publisher_connection_id)
  return entries.length === Object.keys(catalog).length ? catalog : Object.fromEntries(entries)
}
