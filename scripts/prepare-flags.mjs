import { cp, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

const source = resolve('node_modules/flag-icons/flags/4x3')
const destination = resolve('public/flags')

await mkdir(destination, { recursive: true })
await cp(source, destination, { recursive: true, force: true })
