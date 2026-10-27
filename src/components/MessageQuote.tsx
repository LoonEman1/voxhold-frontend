import type { Message, MessageReply, ServerMember } from '../domain/types'
import { mentionDirectory, parseMentions } from '../lib/mentions'
import { Icon } from './Icon'

export function readableMessage(content: string, members: ServerMember[], names?: Record<string, string>) {
  const directory = mentionDirectory(members)
  const mentions = parseMentions(content, directory)
  let offset = 0, text = ''
  for (const mention of mentions) { text += content.slice(offset, mention.start) + `@${mention.userId && names?.[mention.userId] || mention.label}`; offset = mention.end }
  return text + content.slice(offset)
}

export function MessageQuote({ reference, members, onOpen }: { reference: MessageReply; members: ServerMember[]; onOpen?: (id: number) => void }) {
  return <button type="button" className={`message-quote ${reference.deleted ? 'is-deleted' : ''}`} disabled={reference.deleted || !onOpen} onClick={() => onOpen?.(reference.message_id)} aria-label={reference.deleted ? 'Исходное сообщение удалено' : `Перейти к сообщению ${reference.author.username}`}><Icon name="reply" size={15}/><span><b>{reference.deleted ? 'Сообщение удалено' : reference.author.username}</b><small>{reference.deleted ? 'Исходное сообщение больше недоступно' : readableMessage(reference.content, members)}</small></span></button>
}

export function ForwardAttribution({ message }: { message: Message }) {
  return message.forward ? <div className="message-forward"><Icon name="forward" size={14}/><span>Переслано от <b>{message.forward.author.username}</b></span></div> : null
}
