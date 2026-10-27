import { Fragment } from 'react'
import { parseMentions, mentionsMe, type Mention, type MentionDirectory } from '../lib/mentions'
import type { ServerRole } from '../domain/types'

export function MessageMentions({ content, mentions, currentUserId, currentRole, onOpenProfile }: {
  content: string; mentions: Mention[]; currentUserId: number; currentRole?: ServerRole; onOpenProfile?: (id: number) => void
}) {
  let offset = 0
  const parts = mentions.map((mention) => {
    const before = content.slice(offset, mention.start); offset = mention.end
    const mine = mention.userId === currentUserId || !!currentRole && mention.role === currentRole
    const label = `@${mention.label}`
    return <Fragment key={mention.start}>{before}{mention.userId && onOpenProfile ? <button type="button" className={`message-mention ${mine ? 'message-mention--me' : ''}`} title={mine ? 'Вас упомянули' : `Профиль ${mention.label}`} onClick={() => onOpenProfile(mention.userId!)}>{label}</button> : <span className={`message-mention ${mine ? 'message-mention--me' : ''}`} title={mention.role ? `Упоминание роли «${mention.label}»` : 'Упоминание участника'}>{label}</span>}</Fragment>
  })
  return <>{parts}{content.slice(offset)}</>
}

export function MentionPreview({ content, directory, currentUserId, currentRole }: { content: string; directory: MentionDirectory; currentUserId: number; currentRole?: ServerRole }) {
  const mentions = parseMentions(content, directory)
  return <p className={mentionsMe(mentions, currentUserId, currentRole) ? 'message-preview--mentioned' : undefined}><MessageMentions content={content} mentions={mentions} currentUserId={currentUserId} currentRole={currentRole}/></p>
}
