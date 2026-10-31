interface Entry { url: string; refs: number; stale?: boolean }
const entries = new Map<string, Entry>(), maxUnused = 80

function touch(key: string, entry: Entry) { entries.delete(key); entries.set(key, entry) }
function remove(key: string, entry: Entry) { URL.revokeObjectURL(entry.url); entries.delete(key) }
function trim() {
  let unused = 0
  for (const entry of entries.values()) if (!entry.refs) unused++
  for (const [key, entry] of entries) {
    if (unused <= maxUnused) break
    if (!entry.refs) { remove(key, entry); unused-- }
  }
}
export function acquireThumbnail(key: string): string | null {
  const entry = entries.get(key)
  if (!entry || entry.stale) return null
  entry.refs++; touch(key, entry); return entry.url
}
export function storeThumbnail(key: string, blob: Blob): string {
  const entry = entries.get(key)
  if (entry?.stale) throw new Error('Вложение удалено сервером')
  if (entry) { entry.refs++; touch(key, entry); return entry.url }
  const url = URL.createObjectURL(blob)
  entries.set(key, { url, refs: 1 }); trim(); return url
}
export function releaseThumbnail(key: string) {
  const entry = entries.get(key)
  if (!entry) return
  entry.refs = Math.max(0, entry.refs - 1)
  if (!entry.refs && entry.stale) remove(key, entry)
  trim()
}
export function dropThumbnail(key: string) {
  const entry = entries.get(key)
  if (!entry) return
  if (entry.refs) entry.stale = true
  else remove(key, entry)
}
export function clearThumbnails() { for (const [key, entry] of entries) remove(key, entry) }
