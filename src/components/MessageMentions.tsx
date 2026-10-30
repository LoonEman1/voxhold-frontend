import { Fragment } from 'react'
import { messageLinks } from '../lib/messageLinks'
import { parseMentions, mentionsMe, type Mention, type MentionDirectory } from '../lib/mentions'
import type { ServerRole } from '../domain/types'

export function MessageMentions({ content, mentions, currentUserId, currentRole, onOpenProfile, canOpenProfile, links: linkify = true }: {
  content: string; mentions: Mention[]; currentUserId: number; currentRole?: ServerRole; onOpenProfile?: (id: number) => void; canOpenProfile?: (id: number) => boolean; links?: boolean
}) {
  let offset = 0
  const links = linkify ? messageLinks(content) : []
  const visibleMentions = mentions.filter((mention) => !links.some((link) => mention.start < link.end && mention.end > link.start))
  const tokens = [...visibleMentions.map((mention) => ({ ...mention, kind: 'mention' as const })), ...links.map((link) => ({ ...link, kind: 'link' as const }))].sort((a, b) => a.start - b.start)
  const parts = tokens.map((mention) => {
    const before = content.slice(offset, mention.start); offset = mention.end
    if (mention.kind === 'link') return <Fragment key={mention.start}>{before}<a className="message-link" href={mention.href} title={mention.href} target="_blank" rel="noopener noreferrer nofollow">{mention.label}</a></Fragment>
    const mine = mention.userId === currentUserId || !!currentRole && mention.role === currentRole
    const label = `@${mention.label}`
    return <Fragment key={mention.start}>{before}{mention.userId && onOpenProfile && (!canOpenProfile || canOpenProfile(mention.userId)) ? <button type="button" className={`message-mention ${mine ? 'message-mention--me' : ''}`} title={mine ? 'Вас упомянули' : `Профиль ${mention.label}`} onClick={() => onOpenProfile(mention.userId!)}>{label}</button> : <span className={`message-mention ${mine ? 'message-mention--me' : ''}`} title={mention.role ? `Упоминание роли «${mention.label}»` : 'Упоминание участника'}>{label}</span>}</Fragment>
  })
  return <>{parts}{content.slice(offset)}</>
}

export function MentionPreview({ content, directory, currentUserId, currentRole }: { content: string; directory: MentionDirectory; currentUserId: number; currentRole?: ServerRole }) {
  const mentions = parseMentions(content, directory)
  return <p className={mentionsMe(mentions, currentUserId, currentRole) ? 'message-preview--mentioned' : undefined}><MessageMentions links={false} content={content} mentions={mentions} currentUserId={currentUserId} currentRole={currentRole}/></p>
}
