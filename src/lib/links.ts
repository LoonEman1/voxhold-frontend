import { messageLinks } from './messageLinks'
export interface TextLink { start: number; end: number; text: string; href: string }
export function textLinks(text: string): TextLink[] {
  return messageLinks(text).flatMap((link) => {
    const url = new URL(link.href)
    return url.hostname && !url.username && !url.password
      ? [{ start: link.start, end: link.end, text: link.label, href: url.href }] : []
  })
}
