import { Fragment, useState, type ReactNode } from 'react'
import { parseFormatting, type FormatNode } from '../lib/messageFormat'
import { messageLinks } from '../lib/messageLinks'
import type { Mention } from '../lib/mentions'

function Spoiler({ children }: { children: ReactNode }) {
  const [shown, setShown] = useState(false)
  return (
    <span
      className={`message-spoiler ${shown ? 'is-shown' : ''}`}
      role="button"
      tabIndex={0}
      aria-label={shown ? undefined : 'Скрытый текст, нажмите чтобы показать'}
      onClick={() => setShown(true)}
      onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setShown(true) } }}
    >{children}</span>
  )
}

/** Renders formatted text; plain segments are delegated so mentions and links keep working. */
export function FormattedMessage({ content, mentions, renderText }: {
  content: string
  mentions: Mention[]
  renderText(segment: string, segmentMentions: Mention[]): ReactNode
}) {
  const text = (node: Extract<FormatNode, { type: 'text' }>, key: number) => {
    const segment = content.slice(node.start, node.end)
    const local = mentions
      .filter((mention) => mention.start >= node.start && mention.end <= node.end)
      .map((mention) => ({ ...mention, start: mention.start - node.start, end: mention.end - node.start }))
    return <Fragment key={key}>{renderText(segment, local)}</Fragment>
  }
  const render = (nodes: FormatNode[]): ReactNode => nodes.map((node, index) => {
    switch (node.type) {
      case 'text': return text(node, index)
      case 'bold': return <strong key={index}>{render(node.children)}</strong>
      case 'italic': return <em key={index}>{render(node.children)}</em>
      case 'strike': return <s key={index}>{render(node.children)}</s>
      case 'spoiler': return <Spoiler key={index}>{render(node.children)}</Spoiler>
      case 'code': return <code key={index} className="message-code">{node.text}</code>
      case 'codeblock': return <code key={index} className="message-codeblock">{node.text}</code>
      case 'quote': return <span key={index} className="message-quote">{node.lines.map((line, lineIndex) => <Fragment key={lineIndex}>{lineIndex > 0 && <br/>}{render(line)}</Fragment>)}</span>
    }
  })
  // Links keep their markers literal, so a URL is never split across nodes.
  return <>{render(parseFormatting(content, messageLinks(content)))}</>
}
