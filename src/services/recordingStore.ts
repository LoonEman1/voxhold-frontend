import type { ChannelRecording } from '../domain/types'

export interface LocalRecording {
  key: string
  scope: string
  record: ChannelRecording
  bytes: number
  chunks: number
  duration: number
  finished: boolean
  error?: string
}
const request = <T>(value: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
  value.onsuccess = () => resolve(value.result)
  value.onerror = () => reject(value.error ?? new Error('Хранилище записей недоступно'))
})
const completed = (transaction: IDBTransaction) => new Promise<void>((resolve, reject) => {
  transaction.oncomplete = () => resolve()
  transaction.onabort = transaction.onerror = () => reject(transaction.error ?? new Error('Не удалось сохранить запись'))
})
export class RecordingStore {
  private constructor(private db: IDBDatabase, readonly scope: string) {}
  static async open(scope: string) {
    if (!globalThis.indexedDB) throw new Error('Браузер не поддерживает локальное хранилище записей')
    const opening = indexedDB.open('voxhold-recordings-v1', 1)
    opening.onupgradeneeded = () => {
      opening.result.createObjectStore('recordings', { keyPath: 'key' }).createIndex('scope', 'scope')
      opening.result.createObjectStore('chunks')
    }
    const db = await request(opening)
    db.onversionchange = () => db.close()
    return new RecordingStore(db, scope)
  }
  key(id: string) { return `${this.scope}:${id}` }
  async save(local: LocalRecording, chunk?: Blob) {
    const tx = this.db.transaction(['recordings', 'chunks'], 'readwrite')
    const done = completed(tx)
    tx.objectStore('recordings').put(local)
    if (chunk) tx.objectStore('chunks').put(chunk, [this.scope, local.record.id, local.chunks - 1])
    await done
  }
  async list() {
    return request(this.db.transaction('recordings').objectStore('recordings').index('scope').getAll(this.scope)) as Promise<LocalRecording[]>
  }
  async blob(local: LocalRecording, tail: Blob[] = []) {
    const chunks = await request(this.db.transaction('chunks').objectStore('chunks').getAll(IDBKeyRange.bound([this.scope, local.record.id, 0], [this.scope, local.record.id, Number.MAX_SAFE_INTEGER]))) as Blob[]
    return new Blob([...chunks, ...tail], { type: local.record.mime_type })
  }
  async remove(id: string) {
    const tx = this.db.transaction(['recordings', 'chunks'], 'readwrite')
    const done = completed(tx)
    tx.objectStore('recordings').delete(this.key(id))
    tx.objectStore('chunks').delete(IDBKeyRange.bound([this.scope, id, 0], [this.scope, id, Number.MAX_SAFE_INTEGER]))
    await done
  }
  close() { this.db.close() }
}

export function recordingFilename(record: ChannelRecording) {
  return `voxhold-${new Date(record.created_at * 1000).toISOString().replace(/[:.]/g, '-')}-${record.id.slice(0, 8)}.${record.mime_type === 'video/mp4' ? 'mp4' : 'webm'}`
}
export function downloadFile(url: string, filename: string) {
  const anchor = document.createElement('a')
  anchor.href = url; anchor.download = filename; anchor.rel = 'noopener'
  document.body.append(anchor); anchor.click(); anchor.remove()
}
export function downloadBlob(blob: Blob, record: ChannelRecording) {
  const url = URL.createObjectURL(blob)
  downloadFile(url, recordingFilename(record))
  // Leave ample time for the browser to acquire the Blob before releasing it.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
