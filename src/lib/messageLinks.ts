import { codeRanges } from './mentions'

export interface MessageLink { start: number; end: number; href: string; label: string }
export function messageLinks(content: string): MessageLink[] {
  const ignored = codeRanges(content)
  const links: MessageLink[] = []
  for (const match of content.matchAll(/\bhttps?:\/\/[^\s<>`"'\p{Cc}]+/giu)) {
    const start = match.index
    if (ignored.some(([a, b]) => start >= a && start < b)) continue
    let href = match[0]
    // Preserve balanced parentheses used by e.g. Wikipedia, but exclude prose punctuation.
    while (href) {
      if (/[.,!?:;»”]$/u.test(href)) { href = href.slice(0, -1); continue }
      const close = href.at(-1)!, open = ({ ')': '(', ']': '[', '}': '{' } as Record<string, string>)[close]
      if (open && href.split(close).length > href.split(open).length) { href = href.slice(0, -1); continue }
      break
    }
    try {
      const parsed = new URL(href)
      if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || parsed.username || parsed.password) continue
      links.push({ start, end: start + href.length, href, label: href.length > 80 ? `${href.slice(0, 77)}…` : href })
    } catch { /* Invalid URL remains ordinary text. */ }
  }
  return links
}
