export function downloadFile(url: string, filename: string) {
  const anchor = document.createElement('a')
  anchor.href = url; anchor.download = filename; anchor.rel = 'noopener'
  document.body.append(anchor)
  try { anchor.click() } finally { anchor.remove() }
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  try { downloadFile(url, filename) }
  finally { window.setTimeout(() => URL.revokeObjectURL(url), 60_000) }
}
