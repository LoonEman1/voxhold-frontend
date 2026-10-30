// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { MessageMentions } from './MessageMentions'
import { mentionDirectory, parseMentions } from '../lib/mentions'

afterEach(cleanup)
function show(content: string) { render(<MessageMentions content={content} mentions={parseMentions(content, mentionDirectory([]))} currentUserId={1}/>) }
it('only makes HTTP(S) URLs clickable, trims punctuation and preserves code', () => {
  show('javascript:alert(1) data:text/html,test https://a.b/c). `https://code.test` ```https://block.test``` https://en.wikipedia.org/wiki/Test_(example).')
  const links = screen.getAllByRole('link')
  expect(links.map((link) => link.getAttribute('href'))).toEqual(['https://a.b/c', 'https://en.wikipedia.org/wiki/Test_(example)'])
  expect(links[0]?.getAttribute('rel')).toBe('noopener noreferrer nofollow')
  expect(links[0]?.getAttribute('target')).toBe('_blank')
  expect(document.body.textContent).toContain('https://a.b/c).')
})
it('keeps mention offsets and shortens only the displayed long URL', () => {
  const url = `https://example.test/${'a'.repeat(120)}`
  show(`<@1> ${url} <@2>`)
  const link = screen.getByRole('link')
  expect(link.getAttribute('href')).toBe(url)
  expect(link.textContent?.length).toBeLessThanOrEqual(80)
  expect(document.body.textContent).toContain('@участник 1')
  expect(document.body.textContent).toContain('@участник 2')
})
it('leaves an unfinished code span inert', () => {
  show('`https://code.test')
  expect(screen.queryByRole('link')).toBeNull()
})
