import { readFile, readdir, stat } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { gzipSync, brotliCompressSync } from 'node:zlib'
const files = await readdir('dist/assets')
const workspace = files.find((name) => /^WorkspacePage-.*\.js$/.test(name))
assert(workspace, 'WorkspacePage chunk missing')
const size = (await stat(`dist/assets/${workspace}`)).size
assert(size < 250_000, `WorkspacePage is ${size} bytes; budget is 250,000`)
const manifest = JSON.parse(await readFile('dist/.vite/manifest.json', 'utf8'))
const entry = Object.keys(manifest).find((key) => manifest[key].file === `assets/${workspace}`)
const seen = new Set()
function visit(key) {
  if (seen.has(key)) return
  seen.add(key)
  const chunk = manifest[key]
  assert(!/(?:^|\/)(?:stream|voice|voiceInput|hdrPipeline|recording|PersistentStreamPlayer|DirectChat|NewsComments|NewsChannelSettings|ConversationCreator|ComposerActionMenu|AuditView|ScheduledMessages|CommunityFeatures)-[^/]+\.js$/.test(chunk.file), `An optional feature is eagerly imported: ${chunk.file}`)
  for (const dependency of chunk.imports ?? []) visit(dependency)
}
visit(entry)
for (const key of Object.keys(manifest).filter((key) => manifest[key].isEntry)) visit(key)
const chunks = await Promise.all([...seen].map(async (key) => {
  const file = manifest[key].file
  const bytes = await readFile(`dist/${file}`)
  return { file, raw: bytes.length, gzip: gzipSync(bytes).length, brotli: brotliCompressSync(bytes).length }
}))
const total = chunks.reduce((sum, chunk) => ({ raw: sum.raw + chunk.raw, gzip: sum.gzip + chunk.gzip, brotli: sum.brotli + chunk.brotli }), { raw: 0, gzip: 0, brotli: 0 })
assert(total.raw < 620_000, `Initial JavaScript is ${total.raw} bytes; budget is 620,000`)
assert(total.gzip < 200_000, `Initial JavaScript gzip is ${total.gzip} bytes; budget is 200,000`)
console.log(`WorkspacePage: ${size} bytes; initial JavaScript: ${total.raw} raw / ${total.gzip} gzip / ${total.brotli} Brotli; optional features load on demand`)
