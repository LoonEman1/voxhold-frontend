import { expect, it } from 'vitest'
import { inlineMediaType, safeObjectBlob, safeImageBlob } from './safeBlob'

it.each(['text/html', 'image/svg+xml', 'application/xhtml+xml'])('neutralizes %s object documents', (type) => {
  expect(safeObjectBlob(new Blob(['<script>'], { type }), type).type).toBe('application/octet-stream')
  expect(inlineMediaType(type)).toBeNull()
})
it.each(['image/png', 'video/mp4'])('keeps allow-listed %s media', (type) => {
  const blob = new Blob(['media'], { type })
  expect(safeObjectBlob(blob, `${type}; charset=utf-8`)).toBe(blob)
})
it('normalizes types and prevents a video or SVG from being used as a preview image', () => {
  expect(inlineMediaType(' IMAGE/PNG ; charset=utf-8')).toBe('image/png')
  expect(safeImageBlob(new Blob(['x'], { type: 'video/mp4' })).type).toBe('application/octet-stream')
  expect(safeImageBlob(new Blob(['x'], { type: 'image/svg+xml' })).type).toBe('application/octet-stream')
})
