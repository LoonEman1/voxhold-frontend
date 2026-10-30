import { useVisible } from '../hooks/useVisible'
import { attachmentDownload } from '../services/attachmentDownloads'
import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent } from 'react'
import type { Attachment } from '../domain/community'
import type { Channel } from '../domain/types'
import { useCommunity } from './Community'
import { Icon } from './Icon'
import { Modal } from './Modal'
import { bytes } from './CommunitySettings'
import './attachment-drafts.css'

export function MessageAttachments({ attachments }: { attachments?: Attachment[] }) {
  return <div className="message-attachments">{attachments?.map((attachment) => <AttachmentView key={attachment.id} attachment={attachment}/>)}</div>
}
function AttachmentView({ attachment }: { attachment: Attachment }) {
  const context = useCommunity(), [url, setURL] = useState(''), [error, setError] = useState(''), [removed, setRemoved] = useState(attachment.deleted), [expanded, setExpanded] = useState(false), [requested, setRequested] = useState(false), [revision, setRevision] = useState(0)
  const { ref, visible } = useVisible<HTMLElement>()
  const image = attachment.mime_type.startsWith('image/'), video = attachment.mime_type.startsWith('video/')
  const api = context?.api, token = context?.token
  useEffect(() => { const changed = () => { setURL(''); setRevision((v) => v + 1) }; window.addEventListener('voxhold:attachments', changed); return () => window.removeEventListener('voxhold:attachments', changed) }, [])
  useEffect(() => {
    if (!api || !token || attachment.deleted || (!requested && (!image || !visible))) return
    const controller = new AbortController(); let objectURL = ''
    setError('')
    void attachmentDownload(controller.signal, () => api.community.content(token, attachment.id, controller.signal)).then((blob) => { if (!controller.signal.aborted) { objectURL = URL.createObjectURL(blob); setURL(objectURL); setRemoved(false) } }).catch((caught) => { if (!controller.signal.aborted) { if (caught && typeof caught === 'object' && 'status' in caught && caught.status === 410) setRemoved(true); else setError(caught instanceof Error ? caught.message : 'Не удалось загрузить вложение') } })
    return () => { controller.abort(); if (objectURL) URL.revokeObjectURL(objectURL) }
  }, [api, token, attachment.id, attachment.deleted, image, visible, requested, revision])
  if (attachment.deleted || removed) return <div className="attachment-deleted">Вложение удалено сервером · {attachment.filename}</div>
  return <figure ref={ref} className="attachment-card">{image && url ? <button type="button" className="attachment-image" onClick={() => setExpanded(true)} aria-label={`Открыть изображение ${attachment.filename}`}><img src={url} alt={attachment.filename} loading="lazy"/></button> : video && url ? <video controls preload="metadata" src={url}/> : <button type="button" onClick={() => setRequested(true)}>{image ? 'Загрузка изображения…' : video ? 'Посмотреть видео' : 'Загрузить файл'} · {attachment.filename}</button>}<figcaption>{attachment.filename} · {bytes(attachment.size_bytes)}{url && <a href={url} download={attachment.filename}>Скачать</a>}</figcaption>{error && <p role="alert">{error}<button type="button" onClick={() => { setRequested(true); setRevision((v) => v + 1) }}>Повторить</button></p>}<Modal open={expanded} title={attachment.filename} onClose={() => setExpanded(false)} size="medium">{url && <img className="attachment-lightbox" src={url} alt={attachment.filename}/>}</Modal></figure>
}
interface Upload {
  id: string; file: File; progress: number; preview?: string
  state: 'uploading' | 'ready' | 'failed'; attachment?: Attachment; error?: string
}
/** Files are staged until the composer submits one message with all ready IDs. */
export function useAttachmentUpload(channel: Channel | null, enabled: boolean, threadRootId?: number, conversationId?: number) {
  const context = useCommunity(), [items, setItems] = useState<Upload[]>([]), [preparing, setPreparing] = useState(false)
  const current = useRef<Upload[]>([]), controllers = useRef(new Map<string, AbortController>())
  const sequence = useRef(Promise.resolve()), generation = useRef(0), locked = useRef(false)
  const update = (fn: (values: Upload[]) => Upload[]) => { current.current = fn(current.current); setItems(current.current) }
  useEffect(() => {
    const currentGeneration = ++generation.current
    const active = controllers.current
    current.current = []; setItems([]); locked.current = false; setPreparing(false); sequence.current = Promise.resolve()
    return () => {
      generation.current = currentGeneration + 1; active.forEach((controller) => controller.abort()); active.clear()
      current.current.forEach((item) => { if (item.preview) URL.revokeObjectURL(item.preview) })
      current.current = []
    }
  }, [channel?.id, threadRootId, conversationId])
  const run = async (id: string, expected: number) => {
    const item = current.current.find((value) => value.id === id)
    if (!context || !channel || !item || generation.current !== expected || item.state === 'ready') return
    if (item.file.size > 64 * 1024 ** 2) return
    const controller = new AbortController(); controllers.current.set(id, controller)
    const patch = (value: Partial<Upload>) => { if (!controller.signal.aborted && generation.current === expected) update((items) => items.map((item) => item.id === id ? { ...item, ...value } : item)) }
    try {
      patch({ state: 'uploading', error: undefined })
      const attachment = await context.api.community.upload(context.token, channel.id, id, item.file, (progress) => patch({ progress }), controller.signal, conversationId)
      patch({ state: 'ready', progress: 1, attachment })
    } catch (caught) {
      patch({ state: 'failed', error: caught instanceof Error ? caught.message : 'Соединение прервано' })
    } finally { if (controllers.current.get(id) === controller) controllers.current.delete(id) }
  }
  const enqueue = (id: string) => { const expected = generation.current; sequence.current = sequence.current.then(() => run(id, expected)) }
  const add = (files: FileList | File[]) => {
    if (!context || !channel || !enabled) return
    const values: Upload[] = [...files].slice(0, Math.max(0, 10 - current.current.length)).map((file) => {
      let preview: string | undefined
      if (file.type.startsWith('image/') && typeof URL.createObjectURL === 'function') preview = URL.createObjectURL(file)
      return { id: crypto.randomUUID().replaceAll('-', ''), file, preview, progress: 0, state: file.size > 64 * 1024 ** 2 ? 'failed' : 'uploading', error: file.size > 64 * 1024 ** 2 ? 'Файл больше 64 МБ' : undefined }
    })
    update((items) => [...items, ...values]); values.forEach((item) => { if (item.state !== 'failed') enqueue(item.id) })
  }
  const release = () => { locked.current = false; setPreparing(false) }
  const prepare = async () => {
    locked.current = true; setPreparing(true)
    const expected = generation.current, batch = new Set(current.current.map((item) => item.id))
    // Later pastes belong to the next draft, even while this batch is sending.
    const queued = sequence.current
    await queued
    if (expected !== generation.current) throw new Error('Вы переключились на другой разговор')
    const selected = current.current.filter((item) => batch.has(item.id))
    const failed = selected.find((item) => item.state !== 'ready' || !item.attachment)
    if (failed) { release(); throw new Error(failed.error || 'Дождитесь загрузки всех вложений') }
    return selected.map((item) => item.attachment!.id)
  }
  const commit = (ids: string[]) => {
    const sent = new Set(ids)
    update((items) => items.filter((item) => { if (!item.attachment || !sent.has(item.attachment.id)) return true; if (item.preview) URL.revokeObjectURL(item.preview); return false }))
    release()
  }
  const remove = (id: string) => {
    if (locked.current) return
    controllers.current.get(id)?.abort()
    update((items) => items.filter((item) => { if (item.id !== id) return true; if (item.preview) URL.revokeObjectURL(item.preview); return false }))
  }
  const onPaste = (event: ClipboardEvent<HTMLElement>) => { if (event.clipboardData.files.length) { event.preventDefault(); event.stopPropagation(); add(event.clipboardData.files) } }
  const onDrop = (event: DragEvent<HTMLElement>) => { if (event.dataTransfer.files.length) { event.preventDefault(); event.stopPropagation(); add(event.dataTransfer.files) } }
  const onDragOver = (event: DragEvent<HTMLElement>) => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = enabled ? 'copy' : 'none' } }
  const control = context && enabled ? <div className="attachment-upload"><label className={`attachment-picker ${preparing ? 'is-disabled' : ''}`}>Прикрепить файл<input type="file" multiple disabled={preparing || items.length >= 10} onChange={(e) => { if (e.target.files) add(e.target.files); e.target.value = '' }}/></label><small>{items.length ? `${items.length} из 10 · отправятся вместе с текстом` : 'Картинки и файлы вместе с текстом · до 64 МБ на файл'}</small>{items.length > 0 && <div className="attachment-drafts" role="list" aria-label="Вложения к сообщению">{items.map((item) => <div className={`attachment-draft ${item.state === 'failed' ? 'is-failed' : ''}`} key={item.id} role="listitem">{item.preview ? <img src={item.preview} alt={item.file.name}/> : <span className="attachment-draft__icon"><Icon name={item.file.type.startsWith('video/') ? 'monitor' : 'copy'} size={24}/></span>}<div><b title={item.file.name}>{item.file.name}</b><small>{bytes(item.file.size)} · {item.state === 'ready' ? 'Готово к отправке' : item.state === 'failed' ? 'Ошибка загрузки' : `${Math.round(item.progress * 100)}%`}</small>{item.state === 'uploading' && <progress max={1} value={item.progress} aria-label={`Загрузка ${item.file.name}`}/>} {item.state === 'failed' && <><small role="alert">{item.error}</small>{item.file.size <= 64 * 1024 ** 2 && <button type="button" disabled={preparing} onClick={() => enqueue(item.id)}>Повторить</button>}</>}</div><button className="attachment-draft__remove" type="button" disabled={preparing} aria-label={`Убрать ${item.file.name}`} title="Убрать вложение" onClick={() => remove(item.id)}><Icon name="close" size={14}/></button></div>)}</div>}</div> : null
  return { onPaste, onDrop, onDragOver, control, hasItems: items.length > 0, preparing, prepare, commit, release }
}
