import type { ClientDiagnosticsCursor, ClientDiagnosticsPayload } from '../domain/types'

const MAX_EXPORT_BYTES = 100_000_000

export async function exportClientDiagnostics(list: (before?: ClientDiagnosticsCursor) => Promise<ClientDiagnosticsPayload>) {
  const encoder = new TextEncoder()
  const first = await list()
  const header = `{"retention_seconds":${first.retention_seconds},"events":[`
  const parts: BlobPart[] = [header]
  let remaining = MAX_EXPORT_BYTES - header.length - 2
  let count = 0
  let page = first
  for (;;) {
    const events: string[] = []
    for (const event of page.events) {
      const entry = JSON.stringify(event)
      const bytes = encoder.encode(entry).byteLength + (count ? 1 : 0)
      if (bytes > remaining) break
      events.push(count ? `,${entry}` : entry)
      remaining -= bytes
      count++
    }
    parts.push(events.join(''))
    if (!page.next_cursor || events.length < page.events.length) break
    page = await list(page.next_cursor)
  }
  parts.push(']}')
  return { count, blob: new Blob(parts, { type: 'application/json' }) }
}
