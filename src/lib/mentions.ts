import type { ServerMember, ServerRole } from '../domain/types'
import { roleMeta } from './roles'

export interface Mention { start: number; end: number; label: string; userId?: number; role?: ServerRole }
export interface MentionDirectory { users: Map<number, ServerMember>; names: Map<string, ServerMember> }
export function mentionDirectory(members: ServerMember[]): MentionDirectory {
  return { users: new Map(members.map((member) => [member.user_id, member])), names: new Map(members.map((member) => [member.username, member])) }
}
export function codeRanges(content: string): [number, number][] {
  const ignored: [number, number][] = []
  for (let i = 0; i < content.length;) {
    if (content[i] !== '`') { i++; continue }
    const start = i; while (content[i] === '`') i++
    const delimiter = content.slice(start, i), end = content.indexOf(delimiter, i)
    if (end < 0) { ignored.push([start, content.length]); break }
    ignored.push([start, end + delimiter.length]); i = end + delimiter.length
  }
  return ignored
}
export function parseMentions(content: string, directory: MentionDirectory): Mention[] {
  const ignored = codeRanges(content)
  const result: Mention[] = []
  for (const match of content.matchAll(/<@([0-9]{1,19})>|<@&(owner|admin|member)>|@([\p{L}\p{N}_-]+)/gu)) {
    const start = match.index
    if (ignored.some(([a, b]) => start >= a && start < b)) continue
    const previous = [...content.slice(Math.max(0, start - 2), start)].at(-1) ?? ''
    if (/[\p{L}\p{N}_\-\\/.@]/u.test(previous)) continue
    if (match[1]) {
      const id = Number(match[1]); if (!Number.isSafeInteger(id) || id <= 0) continue
      result.push({ start, end: start + match[0].length, userId: id, label: directory.users.get(id)?.username ?? `участник ${id}` })
    } else if (match[2]) {
      const role = match[2] as ServerRole
      result.push({ start, end: start + match[0].length, role, label: roleMeta[role].shortLabel })
    } else if (match[3] && [...match[3]].length <= 32) {
      const member = directory.names.get(match[3])
      if (member) result.push({ start, end: start + match[0].length, userId: member.user_id, label: member.username })
    }
  }
  return result
}
export const mentionsMe = (mentions: Mention[], userId: number, role?: ServerRole) => mentions.some((mention) => mention.userId === userId || !!role && mention.role === role)
export function previewMentions(content: string, userId: number): string {
  return content.replace(/<@([0-9]+)>/g, (_token, id: string) => Number(id) === userId ? '@вы' : '@участник')
    .replace(/<@&(owner|admin|member)>/g, (_token, role: ServerRole) => `@${roleMeta[role].shortLabel}`)
}
