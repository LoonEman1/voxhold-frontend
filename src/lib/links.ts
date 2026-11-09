import { messageLinks } from './messageLinks'
export interface TextLink { start: number; end: number; text: string; href: string }
/** Keep initial placeholders, fetched cards and virtual row estimates in sync. */
export function previewLinks(text: string): string[] {
  return [...new Set(textLinks(text).map((link) => {
    const url = new URL(link.href)
    url.protocol = 'https:'
    return url.href
  }))].slice(0, 2)
}
export function textLinks(text: string): TextLink[] {
  return messageLinks(text).flatMap((link) => {
    const url = new URL(link.href)
    return url.hostname && !url.username && !url.password
      ? [{ start: link.start, end: link.end, text: link.label, href: url.href }] : []
  })
}
