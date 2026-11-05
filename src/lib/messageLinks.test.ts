import { expect, it } from 'vitest'
import { messageLinks } from './messageLinks'

it('recognizes bare domains, www and HTTP links without linking emails or code', () => {
  const text = 'gosuslugi.ru https://www.gosuslugi.ru/ http://x.com/elonmusk ivan.ru/path?q=1. почта@example.ru `hidden.ru`'
  expect(messageLinks(text).map((link) => [link.href, text.slice(link.start, link.end)])).toEqual([
    ['https://gosuslugi.ru', 'gosuslugi.ru'],
    ['https://www.gosuslugi.ru/', 'https://www.gosuslugi.ru/'],
    ['http://x.com/elonmusk', 'http://x.com/elonmusk'],
    ['https://ivan.ru/path?q=1', 'ivan.ru/path?q=1'],
  ])
})
