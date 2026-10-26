import { useEffect, useState } from 'react'
import type { Channel, ChannelRecording } from '../domain/types'
import { formatDuration, humanError } from '../lib/format'
import type { LocalRecording } from '../services/recordingStore'
import { Modal } from './Modal'
import { Icon } from './Icon'
import { RecordingPreview, type PreviewLoader } from './RecordingPreview'

function recordState(record: ChannelRecording, local: LocalRecording | undefined, size: number, progress: number | string | undefined) {
  const now = Date.now()
  if (record.status === 'deleted') return 'В этом браузере · серверная копия недоступна'
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

export function RecordingsDialog({ open, onClose, records, locals, serverId, progress, voiceActive, onDownload, onRemoveLocal, onRetry, onRemoveServer, currentUserId, loadPreview, channels = [] }: {
  open: boolean; onClose: () => void; records: ChannelRecording[]; locals: LocalRecording[]; serverId: number | null
  progress: Record<string, number | string>; voiceActive: boolean
  onDownload: (record: ChannelRecording) => Promise<void>; onRemoveLocal: (id: string) => Promise<void>; onRetry: () => void
  channels?: Channel[]
  loadPreview?: PreviewLoader
  currentUserId?: number
  onRemoveServer?: (record: ChannelRecording) => Promise<void>
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null)
  const [confirmServerRemove, setConfirmServerRemove] = useState<string | null>(null)
  const [error, setError] = useState('')
  useEffect(() => { if (!open) { setConfirmRemove(null); setConfirmServerRemove(null) } }, [open])
  const run = async (id: string, action: () => Promise<void>) => {
    setBusy(id); setError('')
    try { await action() } catch (caught) { setError(humanError(caught)) } finally { setBusy(null) }
  }
  const localById = new Map(locals.filter((local) => local.record.server_id === serverId).map((local) => [local.record.id, local]))
  // Other members' failed/local-only records have nothing to download here.
  const byId = new Map(records.filter((record) => record.server_id === serverId && (localById.has(record.id) || record.status === 'ready' || record.status === 'recording' || record.status === 'uploading')).map((record) => [record.id, record]))
  localById.forEach((local, id) => { if (!byId.has(id)) byId.set(id, local.record) })
  const sorted = Array.from(byId.values()).sort((a, b) => b.created_at - a.created_at)
  return <Modal open={open} onClose={onClose} title="Записи сервера" eyebrow="ЗАПИСИ ЗВОНКОВ" size="medium">
    <div className="recordings-dialog">
    <p className="recordings-hint">Файл скачивается после остановки записи. Копия на сервере до 2 ГБ доступна участникам 24 часа. Копия в этом браузере хранится до удаления.</p>
    {voiceActive && <p className="recordings-notice"><Icon name="inbox" size={16}/>Загрузка копий на сервер продолжится после выхода из звонка.</p>}
    <div className="recordings-list">{sorted.length ? sorted.map((record) => {
      const local = localById.get(record.id)
      const size = local?.bytes ?? record.size_bytes
      const live = record.status === 'recording' && record.expires_at * 1000 > Date.now()
      const serverReady = record.status === 'ready' && record.expires_at * 1000 > Date.now()
      const partial = !!local && !local.finished && local.bytes > 0 && !live
      const available = local?.finished || partial || serverReady
      // Interrupted entries without data must stay removable too.
      const removable = !!local && (local.finished || !live)
      const percent = progress[record.id]
      const canRemoveServer = !!onRemoveServer && record.owner_user_id === currentUserId && !live && (record.status === 'ready' || record.status === 'uploading') && record.expires_at * 1000 > Date.now()
      return <article key={record.id} className="recordings-row">
        <RecordingPreview record={record} load={loadPreview} localReady={!!local?.finished}/>
        <div className="recordings-row__details">
        <div className="recordings-row__heading"><span className="recordings-row__icon"><Icon name="inbox" size={19}/></span><div><b>{channels.find((channel) => channel.id === record.channel_id)?.name ?? `Канал #${record.channel_id}`}</b><time dateTime={new Date(record.created_at * 1000).toISOString()}>{new Date(record.created_at * 1000).toLocaleString()}</time></div></div>
        <div className="recordings-row__meta"><span>{record.owner_username}</span><span>{formatDuration(local?.duration ?? record.duration_ms)}</span><span>{(size / 2 ** 20).toFixed(1)} МБ</span></div>
        <small className={`recordings-row__status${live ? ' is-live' : ''}`}>{live && <i className="record-dot is-active"/>}{recordState(record, local, size, percent)}</small>
        {typeof percent === 'number' && !serverReady && <progress className="recordings-row__progress" max={100} value={percent} aria-label="Загрузка записи на сервер"/>}
        <div className="recordings-row__actions"><button className="button button--secondary button--small" disabled={!available || busy !== null} onClick={() => void run(record.id, () => onDownload(record))}>{busy === record.id ? 'Подождите…' : partial ? 'Скачать часть' : 'Скачать'}</button>{removable && <button className="button button--ghost button--small" disabled={busy !== null} title="Удалить только копию в этом браузере" onClick={() => { if (!serverReady && confirmRemove !== record.id) { setConfirmRemove(record.id); return } setConfirmRemove(null); void run(record.id, () => onRemoveLocal(record.id)) }}>{confirmRemove === record.id ? 'Удалить единственную копию?' : 'Удалить локальную'}</button>}{confirmRemove === record.id && <button className="button button--ghost button--small" onClick={() => setConfirmRemove(null)}>Отмена</button>}</div>
        {canRemoveServer && (confirmServerRemove === record.id ? <div className="recordings-row__delete-confirm"><p>Удалить видео и превью с сервера для всех участников? Локальные копии в браузерах останутся.</p><div><button className="button button--danger-outline button--small" disabled={busy !== null} onClick={() => void run(record.id, async () => { await onRemoveServer!(record); setConfirmServerRemove(null) })}>Удалить запись с сервера</button><button className="button button--ghost button--small" disabled={busy !== null} onClick={() => setConfirmServerRemove(null)}>Отмена</button></div></div> : <button className="recordings-row__remove-server" disabled={busy !== null} onClick={() => { setConfirmRemove(null); setConfirmServerRemove(record.id) }}><Icon name="trash" size={13}/>Удалить с сервера</button>)}
        </div>
      </article>
    }) : <div className="recordings-empty"><Icon name="inbox" size={28}/><b>Записей пока нет</b><p>Начните запись кнопкой с кружком в панели звонка.</p></div>}</div>
    {error && <div className="form-error" role="alert">{error}</div>}
    <div className="dialog-actions recordings-dialog__actions"><button className="button button--secondary button--small" onClick={onRetry} disabled={busy !== null || !locals.some((local) => local.record.server_id === serverId && local.finished)}>Повторить загрузку копий</button><button className="button button--ghost button--small" onClick={onClose}>Закрыть</button></div>
    </div>
  </Modal>
}
