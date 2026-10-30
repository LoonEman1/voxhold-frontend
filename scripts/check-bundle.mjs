import { readFile, readdir, stat } from 'node:fs/promises'
import assert from 'node:assert/strict'
const files = await readdir('dist/assets')
const workspace = files.find((name) => /^WorkspacePage-.*\.js$/.test(name))
assert(workspace, 'WorkspacePage chunk missing')
const size = (await stat(`dist/assets/${workspace}`)).size
assert(size < 300_000, `WorkspacePage is ${size} bytes; budget is 300,000`)
const manifest = JSON.parse(await readFile('dist/.vite/manifest.json', 'utf8'))
const entry = Object.keys(manifest).find((key) => manifest[key].file === `assets/${workspace}`)
const seen = new Set()
function visit(key) {
  if (seen.has(key)) return
  seen.add(key)
  const chunk = manifest[key]
  assert(!/(?:^|\/)(?:stream|hdrPipeline|recording|PersistentStreamPlayer)-[^/]+\.js$/.test(chunk.file), `Media is eagerly imported: ${chunk.file}`)
  for (const dependency of chunk.imports ?? []) visit(dependency)
}
visit(entry)
console.log(`WorkspacePage: ${size} bytes; media modules are loaded dynamically`)
