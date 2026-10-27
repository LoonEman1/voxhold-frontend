import { parseMentions, type MentionDirectory } from '../lib/mentions'
interface Tag { start: number; end: number; token: string }
/** Textarea-friendly display, with stable IDs retained outside editable text. */
export class MentionDraft {
  text = ''
  private source = ''
  private tags: Tag[] = []
  sync(source: string, directory: MentionDirectory) {
    if (source === this.source) return
    this.source = source; this.text = ''; this.tags = []
    let offset = 0
    for (const mention of parseMentions(source, directory)) {
      this.text += source.slice(offset, mention.start)
      const start = this.text.length
      this.text += `@${mention.label}`
      this.tags.push({ start, end: this.text.length, token: mention.role ? `<@&${mention.role}>` : `<@${mention.userId}>` })
      offset = mention.end
    }
    this.text += source.slice(offset)
  }
  change(next: string) {
    const previous = this.text
    let start = 0, suffix = 0
    while (start < previous.length && start < next.length && previous[start] === next[start]) start++
    while (suffix < previous.length - start && suffix < next.length - start && previous[previous.length - 1 - suffix] === next[next.length - 1 - suffix]) suffix++
    const end = previous.length - suffix, delta = next.length - previous.length
    this.tags = this.tags.flatMap((tag) => tag.end <= start ? [tag] : tag.start >= end ? [{ ...tag, start: tag.start + delta, end: tag.end + delta }] : [])
    this.source = next; this.text = next
  }
  insert(start: number, end: number, label: string, token: string) {
    this.change(`${this.text.slice(0, start)}${label} ${this.text.slice(end)}`)
    this.tags.push({ start, end: start + label.length, token }); this.tags.sort((a, b) => a.start - b.start)
  }
  encode() {
    let result = '', offset = 0
    for (const tag of this.tags) { result += this.text.slice(offset, tag.start) + tag.token; offset = tag.end }
    return result + this.text.slice(offset)
  }
}
