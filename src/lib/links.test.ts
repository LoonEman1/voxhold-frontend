import { expect, it } from 'vitest'
import { textLinks } from './links'
it('links HTTP(S), preserves balanced URL parentheses, and leaves punctuation outside', () => {
  const text = 'Читайте (https://example.com/a_(b)). И https://домен.рф/статья, http://example.org/x?q=1&n=2!'
  expect(textLinks(text).map((l) => l.text)).toEqual(['https://example.com/a_(b)', 'https://домен.рф/статья', 'http://example.org/x?q=1&n=2'])
})
it('never links executable schemes, markup or credential-disguised URLs', () => {
  expect(textLinks('javascript:alert(1) data:text/html,hi <script>x</script> https://trusted@evil.example')).toEqual([])
  expect(textLinks('https://example.com\u0000javascript:alert(1)')[0]?.text).toBe('https://example.com')
})
