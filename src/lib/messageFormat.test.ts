import { describe, expect, it } from 'vitest'
import { parseFormatting, MAX_FORMAT_LENGTH, type FormatNode } from './messageFormat'

const text = (src: string, nodes: FormatNode[]): string =>
  nodes.map((node) => node.type === 'text' ? src.slice(node.start, node.end) : node.type === 'code' || node.type === 'codeblock' ? `[${node.type}:${node.text}]`
    : node.type === 'quote' ? `[quote:${node.lines.map((line) => text(src, line)).join('|')}]` : `[${node.type}:${text(src, node.children)}]`).join('')

const render = (src: string) => text(src, parseFormatting(src))

describe('parseFormatting', () => {
  it('parses bold, italic, strike, spoiler and code', () => {
    expect(render('a **b** *c* ~~d~~ ||e|| `f`')).toBe('a [bold:b] [italic:c] [strike:d] [spoiler:e] [code:f]')
  })
  it('supports nesting', () => {
    expect(render('**a *b* c**')).toBe('[bold:a [italic:b] c]')
  })
  it('keeps unclosed markers as plain text', () => {
    expect(render('**oops and *this')).toBe('**oops and *this')
    expect(render('a ~~b')).toBe('a ~~b')
  })
  it('honours escapes', () => {
    const slash = String.fromCharCode(92)
    expect(render(`${slash}*not italic${slash}*`)).toBe('*not italic*')
  })
  it('does not format inside code', () => {
    expect(render('`**x**`')).toBe('[code:**x**]')
    expect(render('```\n**x**\n```')).toBe('[codeblock:**x**]')
  })
  it('parses quotes line by line', () => {
    expect(render('> one\n> **two**\nrest')).toBe('[quote:one|[bold:two]]rest')
  })
  it('does not treat a lone star or a spaced star as emphasis', () => {
    expect(render('2 * 3 * 4')).toBe('2 * 3 * 4')
  })
  it('falls back to plain text for oversized input and stays linear', () => {
    const big = '*'.repeat(MAX_FORMAT_LENGTH + 1)
    expect(parseFormatting(big)).toEqual([{ type: 'text', start: 0, end: big.length }])
    const started = performance.now()
    parseFormatting('*a'.repeat(2500))
    parseFormatting('**'.repeat(2500))
    expect(performance.now() - started).toBeLessThan(500)
  })
})
