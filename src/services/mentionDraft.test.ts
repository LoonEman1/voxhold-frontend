import { expect, it } from 'vitest'
import type { ServerMember } from '../domain/types'
import { mentionDirectory } from '../lib/mentions'
import { MentionDraft } from './mentionDraft'
const directory = mentionDirectory([{ user_id: 2, username: 'Nikita', role: 'member' }, { user_id: 3, username: 'Name With Spaces', role: 'admin' }] as ServerMember[])
it('shows names while preserving stable IDs through edits before and after a mention', () => {
  const draft = new MentionDraft(); draft.sync('Привет <@3> и <@&admin>', directory)
  expect(draft.text).toBe('Привет @Name With Spaces и @Админ')
  draft.change(`Ещё: ${draft.text}`); draft.change(`${draft.text}!`)
  expect(draft.encode()).toBe('Ещё: Привет <@3> и <@&admin>!')
  draft.change(draft.text.replace('@Name With Spaces', 'команда'))
  expect(draft.encode()).toBe('Ещё: Привет команда и <@&admin>!')
})
it('inserts a selected user without displaying an ID, and clears stale tags on reset', () => {
  const draft = new MentionDraft(); draft.sync('hello @Ni', directory)
  draft.insert(6, 9, '@Nikita', '<@2>')
  draft.sync(draft.text, directory)
  expect(draft.text).toBe('hello @Nikita '); expect(draft.encode()).toBe('hello <@2> ')
  draft.sync('', directory); draft.change('ordinary')
  expect(draft.encode()).toBe('ordinary')
})
