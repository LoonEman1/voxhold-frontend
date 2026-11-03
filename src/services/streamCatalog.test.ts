import { expect, it } from 'vitest'
import type { ActiveStream } from '../domain/types'
import { indexStreams, streamInChannel, streamsInChannel, withoutStoppedStream } from './streamCatalog'

const stream = (publisher: string, channel = 1, started = 10): ActiveStream => ({ server_id: 1, channel_id: channel, publisher_user_id: 2, publisher_connection_id: publisher, mode: 'server', codec: 'vp8', has_audio: false, viewer_count: 0, started_at_ms: started })
it('retains multiple publishers in one channel and selects identities without fallback', () => {
  const first = stream('a'), second = stream('b', 1, 20), foreign = stream('c', 2)
  const catalog = indexStreams([second, foreign, first])
  expect(streamsInChannel(catalog, 1)).toEqual([first, second])
  expect(streamInChannel(catalog, 1)).toBe(first)
  expect(streamInChannel(catalog, 1, 'b')).toBe(second)
  expect(streamInChannel(catalog, 1, 'c')).toBeNull()
  expect(streamInChannel(catalog, 1, 'missing')).toBeNull()
})
it('removes only the stopped publisher and supports old channel-only notifications', () => {
  const catalog = indexStreams([stream('a'), stream('b'), stream('c', 2)])
  expect(Object.keys(withoutStoppedStream(catalog, { channel_id: 1, publisher_connection_id: 'a' }))).toEqual(['b', 'c'])
  expect(Object.keys(withoutStoppedStream(catalog, { channel_id: 1 }))).toEqual(['c'])
  expect(withoutStoppedStream(catalog, { channel_id: 2, publisher_connection_id: 'a' })).toBe(catalog)
})
