const INLINE_MEDIA = new Set([
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif',
  'video/mp4', 'video/webm', 'video/ogg',
  'audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/webm', 'audio/mp4',
])

export function inlineMediaType(type: string): string | null {
  const value = type.split(';')[0]?.trim().toLowerCase() ?? ''
  return INLINE_MEDIA.has(value) ? value : null
}

/** Object URLs inherit our origin, so active document types must never render. */
export function safeObjectBlob(blob: Blob, declaredType: string): Blob {
  const type = inlineMediaType(declaredType) ?? 'application/octet-stream'
  return blob.type === type ? blob : new Blob([blob], { type })
}

export function safeImageBlob(blob: Blob): Blob {
  const type = inlineMediaType(blob.type)
  return safeObjectBlob(blob, type?.startsWith('image/') ? type : '')
}
