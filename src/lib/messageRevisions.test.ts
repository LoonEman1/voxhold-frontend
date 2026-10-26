import { describe, expect, it } from 'vitest'
import type { Message } from '../domain/types'
import { messageSnapshot, newerMessage } from './messageRevisions'

describe('message revisions', () => {
  const message: Message = { id: 1, channel_id: 1, author: { user_id: 1, username: 'member' }, content: 'new', created_at: 1, edited_at: 2, revision: 3 }
  it('retains the newer edit when events share a timestamp', () => {
    expect(newerMessage(message, { ...message, content: 'old', revision: 2 })).toBe(message)
  })
  it('keeps versioned state when a legacy snapshot arrives late', () => {
    expect(newerMessage(message, { ...message, revision: undefined })).toBe(message)
  })
  it('accepts a newer revision and supports older backends', () => {
    const incoming = { ...message, revision: 4 }
    expect(newerMessage(message, incoming)).toBe(incoming)
    expect(newerMessage({ ...message, revision: undefined }, incoming)).toBe(incoming)
  })
  it('does not let a late history response overwrite a newer live edit', () => {
    expect(messageSnapshot([message], [{ ...message, content: 'old', revision: 1 }])).toEqual([message])
  })
})
