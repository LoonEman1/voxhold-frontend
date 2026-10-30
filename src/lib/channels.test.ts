import { expect, it } from 'vitest'
import type { Channel } from '../domain/types'
import { pickDefaultChannel } from './channels'

const channel = (id: number, kind: Channel['kind']): Channel => ({ id, kind, server_id: 1, name: String(id), position: id, created_by: 1, created_at: 1 })
it('prefers the first readable text/news channel while preserving server order', () => {
  const channels = [channel(1, 'voice'), channel(2, 'news'), channel(3, 'text')]
  expect(pickDefaultChannel(channels)).toBe(channels[1])
  expect(channels.map((value) => value.id)).toEqual([1, 2, 3])
})
it('supports voice-only servers and an empty post-deletion list', () => {
  const voice = channel(1, 'voice')
  expect(pickDefaultChannel([voice])).toBe(voice)
  expect(pickDefaultChannel([])).toBeNull()
})
