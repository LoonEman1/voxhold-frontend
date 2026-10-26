import type { Message } from '../domain/types'

/** HTTP responses and WebSocket events may arrive in a different order. */
export function newerMessage(current: Message | undefined, incoming: Message): Message {
  if (!current) return incoming
  if (current.revision !== undefined && (incoming.revision === undefined || incoming.revision < current.revision)) return current
  return incoming
}

export function messageSnapshot(current: Message[], incoming: Message[]): Message[] {
  const known = new Map(current.map((message) => [message.id, message]))
  return incoming.map((message) => newerMessage(known.get(message.id), message))
}
