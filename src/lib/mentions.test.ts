import { describe, expect, it } from 'vitest'
import type { ServerMember } from '../domain/types'
import { mentionDirectory, mentionsMe, parseMentions } from './mentions'
const directory = mentionDirectory([{ user_id: 42, username: 'Nikita', role: 'member' }, { user_id: 43, username: 'Name With Spaces', role: 'admin' }, { user_id: 44, username: 'Никита', role: 'member' }] as ServerMember[])
describe('mention grammar', () => {
  it.each(['Привет @Nikita!', 'Привет <@42>', '😀 @Nikita'])('recognizes an exact user in %s', (content) => expect(mentionsMe(parseMentions(content, directory), 42, 'owner')).toBe(true))
  it.each(['@NikitaLong', 'mail@Nikita', 'https://site/@Nikita', '\\@Nikita', '`@Nikita`', '```\n<@42>\n```', '@nikita', '<@0>', '<@9999999999999999999>'])('does not ping from %s', (content) => expect(mentionsMe(parseMentions(content, directory), 42, 'member')).toBe(false))
  it('resolves role mentions and names with spaces to readable chips', () => {
    const tokens = parseMentions('<@43> <@&admin> @Никита', directory)
    expect(tokens.map((token) => token.label)).toEqual(['Name With Spaces', 'Админ', 'Никита'])
    expect(mentionsMe(tokens, 50, 'admin')).toBe(true)
    expect(mentionsMe(tokens, 50, 'member')).toBe(false)
  })
})
