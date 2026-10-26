import { useState } from 'react'
import type { Channel, ChannelRecording } from '../domain/types'
import type { LocalRecording } from '../services/recordingStore'
import { Modal } from './Modal'

export function RecordingsDialog({ open, onClose, records, locals, serverId, progress, voiceActive, onDownload, onRemoveLocal, onRetry, channels = [] }: {
  open: boolean; onClose: () => void; records: ChannelRecording[]; locals: LocalRecording[]; serverId: number | null
  progress: Record<string, number | string>; voiceActive: boolean
  onDownload: (record: ChannelRecording) => Promise<void>; onRemoveLocal: (id: string) => Promise<void>; onRetry: () => void
  channels?: Channel[]
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null)
  const byId = new Map(records.filter((record) => record.server_id === serverId).map((record) => [record.id, record]))
  locals.filter((local) => local.record.server_id === serverId).forEach((local) => { if (!byId.has(local.record.id)) byId.set(local.record.id, local.record) })
  const sorted = Array.from(byId.values()).sort((a, b) => b.created_at - a.created_at)
  return <Modal open={open} onClose={onClose} title="Записи сервера" eyebrow="СКАЧАТЬ ФАЙЛ" size="medium">
    <p className="recordings-hint">После остановки файл скачивается автоматически. Серверная копия до 2 ГБ хранится 24 часа и доступна участникам сервера. Локальная копия остаётся в этом браузере, пока вы её не удалите.</p>
    {voiceActive && <p className="recordings-hint">Загрузка копий на сервер продолжится после выхода из звонка.</p>}
    <div className="recordings-list">{sorted.length ? sorted.map((record) => {
      const local = locals.find((item) => item.record.id === record.id)
      const size = local?.bytes ?? record.size_bytes
      const state = record.status === 'recording' && record.expires_at * 1000 > Date.now() && !local?.finished ? 'Идёт запись' : record.status === 'ready' ? `На сервере до ${new Date(record.expires_at * 1000).toLocaleString()}` : size > 2 ** 31 ? 'Больше 2 ГБ · только в этом браузере' : (record.expires_at * 1000 <= Date.now() ? 'Срок серверной копии истёк · в этом браузере' : local?.error) ?? (typeof progress[record.id] === 'number' ? `Загрузка: ${progress[record.id]}%` : progress[record.id]) ?? (local?.finished ? 'В этом браузере · ожидает загрузки' : 'Серверная копия недоступна')
      const partial = !!local && !local.finished && local.bytes > 0 && (record.status !== 'recording' || record.expires_at * 1000 <= Date.now())
      const available = local?.finished || partial || record.status === 'ready'
      return <article key={record.id} className="recordings-row"><div><b>{new Date(record.created_at * 1000).toLocaleString()}</b><small>{channels.find((channel) => channel.id === record.channel_id)?.name ?? `Канал #${record.channel_id}`} · {record.owner_username} · {Math.round((local?.duration ?? record.duration_ms) / 60_000)} мин · {(size / 2 ** 20).toFixed(1)} МБ</small><small>{state}</small></div><div><button className="button button--secondary button--small" disabled={!available || busy === record.id} onClick={() => { setBusy(record.id); void onDownload(record).finally(() => setBusy(null)) }}>{partial ? 'Скачать часть' : 'Скачать'}</button>{(local?.finished || partial) && <button className="button button--ghost button--small" title="Удалить только копию в этом браузере" onClick={() => { if (record.status !== 'ready' && confirmRemove !== record.id) { setConfirmRemove(record.id); return } setConfirmRemove(null); void onRemoveLocal(record.id) }}>{confirmRemove === record.id ? 'Удалить единственную копию?' : 'Удалить локальную'}</button>}</div></article>
    }) : <p>Здесь появятся завершённые записи.</p>}</div>
    <div className="dialog-actions"><button className="button button--secondary" onClick={onRetry}>Повторить загрузку копий</button><button className="button button--ghost" onClick={onClose}>Закрыть</button></div>
  </Modal>
}
