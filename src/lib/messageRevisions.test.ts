import { describe, expect, it } from 'vitest'
import type { Message } from '../domain/types'
import { messageSnapshot, newerMessage, withReactions, resolveReplyReferences } from './messageRevisions'

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

it('preserves both a late text edit and the newer personalized reaction snapshot', () => {
  const original: Message = { id: 1, channel_id: 2, author: { user_id: 1, username: 'Alice' }, content: 'before', created_at: 1, edited_at: null, revision: 1 }
  const reacted = withReactions(original, { message_id: 1, channel_id: 2, revision: 3, reactions: [{ emoji: '❤️', count: 2, me: true }] })
  expect(reacted.revision).toBe(1)
  const edited = newerMessage(reacted, { ...original, content: 'after', revision: 2, reactions_revision: 2, reactions: [] })
  expect(edited.content).toBe('after')
  expect(edited.reactions).toEqual([{ emoji: '❤️', count: 2, me: true }])
  expect(edited.reactions_revision).toBe(3)
  expect(withReactions(edited, { message_id: 1, channel_id: 2, revision: 2, reactions: [] })).toBe(edited)
})

it('follows quote edits and never resurrects a deleted target from an older snapshot', () => {
  const target: Message = { id: 1, channel_id: 2, author: { user_id: 1, username: 'Alice' }, content: 'edited', created_at: 1, edited_at: 2, revision: 3 }
  const answer: Message = { ...target, id: 2, content: 'answer', revision: 1, reply: { message_id: 1, author: target.author, content: 'old', revision: 1, deleted: false } }
  const [updated] = resolveReplyReferences([answer], [target])
  expect(updated!.reply!.content).toBe('edited')
  const [deleted] = resolveReplyReferences([updated!], [], new Set([1]))
  expect(deleted!.reply!.deleted).toBe(true)
  expect(deleted!.reply!.content).toBe('')
  expect(newerMessage(deleted, { ...answer, revision: 4 }).reply!.deleted).toBe(true)
})
