export interface TextLink { start: number; end: number; text: string; href: string }
export function textLinks(text: string): TextLink[] {
  const result: TextLink[] = []
  for (const match of text.matchAll(/https?:\/\/[^\s<>"'\p{Cc}]+/giu)) {
    let value = match[0].replace(/[.,!?;:»”]+$/u, '')
    for (const [open, close] of [['(', ')'], ['[', ']'], ['{', '}']] as const) {
      while (value.endsWith(close) && value.split(close).length > value.split(open).length) value = value.slice(0, -1)
    }
    try {
      const url = new URL(value)
      if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) continue
      result.push({ start: match.index, end: match.index + value.length, text: value, href: url.href })
    } catch { /* Malformed URLs remain ordinary text. */ }
  }
  return result
}
