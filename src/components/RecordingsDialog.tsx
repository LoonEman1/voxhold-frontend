import { useState } from 'react'
import type { Channel, ChannelRecording } from '../domain/types'
import { formatDuration } from '../lib/format'
import type { LocalRecording } from '../services/recordingStore'
import { Modal } from './Modal'

function recordState(record: ChannelRecording, local: LocalRecording | undefined, size: number, progress: number | string | undefined) {
  const now = Date.now()
  if (record.status === 'recording' && record.expires_at * 1000 > now && !local?.finished) return 'Идёт запись'
  if (record.status === 'ready' && record.expires_at * 1000 > now) return `На сервере до ${new Date(record.expires_at * 1000).toLocaleString()}`
  if (!local) return record.status === 'uploading' ? 'Загружается на сервер' : 'Серверная копия недоступна'
  if (local.error) return local.error
  if (!local.finished) return local.bytes ? 'Запись прервана · доступна сохранённая часть' : 'Запись прервана до появления данных'
  if (size > 2 ** 31) return 'Больше 2 ГБ · только в этом браузере'
  if (record.expires_at * 1000 <= now) return 'Срок серверной копии истёк · в этом браузере'
  if (typeof progress === 'number') return `Загрузка: ${progress}%`
  return progress ?? 'В этом браузере · ожидает загрузки'
}

export function RecordingsDialog({ open, onClose, records, locals, serverId, progress, voiceActive, onDownload, onRemoveLocal, onRetry, channels = [] }: {
  open: boolean; onClose: () => void; records: ChannelRecording[]; locals: LocalRecording[]; serverId: number | null
  progress: Record<string, number | string>; voiceActive: boolean
  onDownload: (record: ChannelRecording) => Promise<void>; onRemoveLocal: (id: string) => Promise<void>; onRetry: () => void
  channels?: Channel[]
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null)
  const localById = new Map(locals.filter((local) => local.record.server_id === serverId).map((local) => [local.record.id, local]))
  // Other members' failed/local-only records have nothing to download here.
  const byId = new Map(records.filter((record) => record.server_id === serverId && (localById.has(record.id) || record.status === 'ready' || record.status === 'recording' || record.status === 'uploading')).map((record) => [record.id, record]))
  localById.forEach((local, id) => { if (!byId.has(id)) byId.set(id, local.record) })
  const sorted = Array.from(byId.values()).sort((a, b) => b.created_at - a.created_at)
  return <Modal open={open} onClose={onClose} title="Записи сервера" eyebrow="СКАЧАТЬ ФАЙЛ" size="medium">
    <p className="recordings-hint">После остановки файл скачивается автоматически. Серверная копия до 2 ГБ хранится 24 часа и доступна участникам сервера. Локальная копия остаётся в этом браузере, пока вы её не удалите.</p>
    {voiceActive && <p className="recordings-hint">Загрузка копий на сервер продолжится после выхода из звонка.</p>}
    <div className="recordings-list">{sorted.length ? sorted.map((record) => {
      const local = localById.get(record.id)
      const size = local?.bytes ?? record.size_bytes
      const live = record.status === 'recording' && record.expires_at * 1000 > Date.now()
      const serverReady = record.status === 'ready' && record.expires_at * 1000 > Date.now()
      const partial = !!local && !local.finished && local.bytes > 0 && !live
      const available = local?.finished || partial || serverReady
      // Interrupted entries without data must stay removable too.
      const removable = !!local && (local.finished || !live)
      return <article key={record.id} className="recordings-row"><div><b>{new Date(record.created_at * 1000).toLocaleString()}</b><small>{channels.find((channel) => channel.id === record.channel_id)?.name ?? `Канал #${record.channel_id}`} · {record.owner_username} · {formatDuration(local?.duration ?? record.duration_ms)} · {(size / 2 ** 20).toFixed(1)} МБ</small><small>{recordState(record, local, size, progress[record.id])}</small></div><div><button className="button button--secondary button--small" disabled={!available || busy === record.id} onClick={() => { setBusy(record.id); void onDownload(record).finally(() => setBusy(null)) }}>{partial ? 'Скачать часть' : 'Скачать'}</button>{removable && <button className="button button--ghost button--small" title="Удалить только копию в этом браузере" onClick={() => { if (!serverReady && confirmRemove !== record.id) { setConfirmRemove(record.id); return } setConfirmRemove(null); void onRemoveLocal(record.id) }}>{confirmRemove === record.id ? 'Удалить единственную копию?' : 'Удалить локальную'}</button>}</div></article>
    }) : <p>Здесь появятся завершённые записи.</p>}</div>
    <div className="dialog-actions"><button className="button button--secondary" onClick={onRetry}>Повторить загрузку копий</button><button className="button button--ghost" onClick={onClose}>Закрыть</button></div>
  </Modal>
}
