/**
 * Linear message formatting parser. It never uses backtracking regular
 * expressions; nodes reference source ranges so mentions and links, which are
 * computed against the original text, can be rebased onto text nodes.
 */
export type FormatNode =
  | { type: 'text'; start: number; end: number }
  | { type: 'bold' | 'italic' | 'strike' | 'spoiler'; children: FormatNode[] }
  | { type: 'code'; text: string }
  | { type: 'codeblock'; text: string }
  | { type: 'quote'; lines: FormatNode[][] }

export const MAX_FORMAT_LENGTH = 5120
const MAX_DEPTH = 4
const BACKSLASH = String.fromCharCode(92)
const ESCAPABLE = new Set(['*', '~', '|', '`', BACKSLASH, '>'])

function pushText(out: FormatNode[], start: number, end: number) {
  if (end <= start) return
  const last = out[out.length - 1]
  if (last?.type === 'text' && last.end === start) last.end = end
  else out.push({ type: 'text', start, end })
}

function findSingleStar(src: string, from: number, to: number): number {
  for (let j = from; j < to; j++) {
    if (src[j] === BACKSLASH) { j++; continue }
    if (src[j] === '*' && src[j - 1] !== '*' && src[j + 1] !== '*') return j
  }
  return -1
}

function parseInline(src: string, from: number, to: number, depth: number): FormatNode[] {
  const out: FormatNode[] = []
  let textStart = from
  let i = from
  const flush = (upTo: number) => pushText(out, textStart, upTo)
  while (i < to) {
    const ch = src[i]
    if (ch === BACKSLASH && i + 1 < to && ESCAPABLE.has(src[i + 1] as string)) {
      flush(i); pushText(out, i + 1, i + 2); i += 2; textStart = i; continue
    }
    if (ch === '`') {
      let run = i
      while (run < to && src[run] === '`') run++
      const fence = src.slice(i, run)
      const close = src.indexOf(fence, run)
      if (close > run && close + fence.length <= to) {
        flush(i); out.push({ type: 'code', text: src.slice(run, close) }); i = close + fence.length; textStart = i; continue
      }
      i = run; continue
    }
    if (depth < MAX_DEPTH) {
      const pair = ch === '*' && src[i + 1] === '*' ? '**' : ch === '~' && src[i + 1] === '~' ? '~~' : ch === '|' && src[i + 1] === '|' ? '||' : ''
      if (pair) {
        const close = src.indexOf(pair, i + 2)
        if (close > i + 2 && close + 2 <= to) {
          flush(i)
          const type = pair === '**' ? 'bold' : pair === '~~' ? 'strike' : 'spoiler'
          out.push({ type, children: parseInline(src, i + 2, close, depth + 1) })
          i = close + 2; textStart = i; continue
        }
        i += 2; continue
      }
      if (ch === '*' && src[i + 1] !== '*' && src[i + 1] !== ' ' && src[i + 1] !== '\n') {
        const close = findSingleStar(src, i + 1, to)
        if (close > i + 1 && src[close - 1] !== ' ') {
          flush(i); out.push({ type: 'italic', children: parseInline(src, i + 1, close, depth + 1) }); i = close + 1; textStart = i; continue
        }
      }
    }
    i++
  }
  flush(to)
  return out
}

export function parseFormatting(content: string): FormatNode[] {
  if (content.length === 0 || content.length > MAX_FORMAT_LENGTH) return content ? [{ type: 'text', start: 0, end: content.length }] : []
  const out: FormatNode[] = []
  let paragraphStart = 0
  let pos = 0
  const flushParagraph = (end: number) => { if (end > paragraphStart) out.push(...parseInline(content, paragraphStart, end, 0)) }
  while (pos < content.length) {
    const lineEnd = content.indexOf('\n', pos) < 0 ? content.length : content.indexOf('\n', pos)
    if (content.startsWith('```', pos)) {
      const closing = content.indexOf('```', pos + 3)
      if (closing > pos + 3) {
        flushParagraph(pos)
        out.push({ type: 'codeblock', text: content.slice(pos + 3, closing).replace(/^\n/, '').replace(/\n$/, '') })
        pos = closing + 3
        if (content[pos] === '\n') pos++
        paragraphStart = pos
        continue
      }
    }
    if (content.startsWith('> ', pos)) {
      flushParagraph(pos)
      const lines: FormatNode[][] = []
      while (pos < content.length && content.startsWith('> ', pos)) {
        const end = content.indexOf('\n', pos) < 0 ? content.length : content.indexOf('\n', pos)
        lines.push(parseInline(content, pos + 2, end, 0))
        pos = end < content.length ? end + 1 : end
      }
      out.push({ type: 'quote', lines })
      paragraphStart = pos
      continue
    }
    pos = lineEnd < content.length ? lineEnd + 1 : lineEnd
  }
  flushParagraph(content.length)
  return out
}
