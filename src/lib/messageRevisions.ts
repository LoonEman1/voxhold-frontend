import type { Message, MessageReactions } from '../domain/types'

/** Text and personalized reaction snapshots have independent arrival order. */
export function newerMessage(current: Message | undefined, incoming: Message): Message {
  if (!current) return incoming
  const body = current.revision !== undefined && (incoming.revision === undefined || incoming.revision < current.revision) ? current : incoming
  const oldReactionVersion = current.reactions_revision ?? 0
  const newReactionVersion = incoming.reactions_revision ?? 0
  const reactions = incoming.reactions !== undefined && newReactionVersion >= oldReactionVersion ? incoming : current
  let reply = body.reply ?? current.reply
  if (current.reply?.deleted && reply?.message_id === current.reply.message_id) reply = current.reply
  const forward = body.forward ?? current.forward
  if (body.reactions === reactions.reactions && body.reactions_revision === reactions.reactions_revision && body.reply === reply && body.forward === forward) return body
  return { ...body, reactions: reactions.reactions, reactions_revision: reactions.reactions_revision, reply, forward }
}

export function withReactions(current: Message, incoming: MessageReactions): Message {
  if (incoming.revision <= (current.reactions_revision ?? 0)) return current
  return { ...current, reactions: incoming.reactions, reactions_revision: incoming.revision }
}

/** Quotes follow edits/deletions, even when their target is outside the window. */
export function resolveReplyReferences(values: Message[], updates: Message[], deleted: ReadonlySet<number> = new Set()): Message[] {
  const targets = new Map<number, Message>()
  updates.forEach((value) => targets.set(value.id, newerMessage(targets.get(value.id), value)))
  return values.map((value) => {
    const reply = value.reply
    if (!reply) return value
    if (deleted.has(reply.message_id)) {
      return reply.deleted ? value : { ...value, reply: { ...reply, deleted: true, content: '', author: { user_id: 0, username: '' } } }
    }
    const target = targets.get(reply.message_id)
    if (reply.deleted || !target || (target.revision ?? 0) < reply.revision) return value
    if (reply.content === target.content && reply.author.username === target.author.username && reply.revision === (target.revision ?? 0)) return value
    return { ...value, reply: { ...reply, author: target.author, content: target.content, revision: target.revision ?? 0 } }
  })
}

export function messageSnapshot(current: Message[], incoming: Message[]): Message[] {
  const known = new Map(current.map((message) => [message.id, message]))
  const values = incoming.map((message) => newerMessage(known.get(message.id), message))
  return resolveReplyReferences(values, values)
}
