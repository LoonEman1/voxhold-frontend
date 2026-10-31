import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent } from 'react'
import type { Attachment } from '../domain/community'
import type { Channel } from '../domain/types'
import { useCommunity } from './Community'
import { Icon } from './Icon'
import { Modal } from './Modal'
import { bytes } from '../lib/bytes'
import { inlineMediaType, safeObjectBlob } from '../lib/safeBlob'
import { attachmentRequest } from '../lib/attachmentRequests'
import { retryBusy } from '../lib/retryBusy'
import { acquireThumbnail, storeThumbnail, releaseThumbnail, dropThumbnail } from '../lib/thumbnailCache'
import './attachment-drafts.css'

interface AttachmentScope { channelId?: number; conversationId?: number }
interface AttachmentChange { channel_id?: number; conversation_id?: number; attachment_ids?: string[] }
export function MessageAttachments({ attachments, ...scope }: { attachments?: Attachment[] } & AttachmentScope) {
  return <div className="message-attachments">{attachments?.map((attachment) => <AttachmentView key={attachment.id} attachment={attachment} {...scope}/>)}</div>
}
function AttachmentView({ attachment, channelId, conversationId }: { attachment: Attachment } & AttachmentScope) {
  const context = useCommunity()
  const api = context?.api, userId = context?.userId
  const thumbnailKey = `${api?.storageScope ?? ''}:${userId ?? 0}:${attachment.id}`
  const tokenRef = useRef(context?.token ?? '')
  useEffect(() => { tokenRef.current = context?.token ?? '' }, [context?.token])
  const figure = useRef<HTMLElement>(null)
  const [visible, setVisible] = useState(false), [previewURL, setPreviewURL] = useState(''), [url, setURL] = useState('')
  const [error, setError] = useState(''), [removed, setRemoved] = useState(attachment.deleted), [expanded, setExpanded] = useState(false)
  const [requested, setRequested] = useState(false), [revision, setRevision] = useState(0)
  const media = inlineMediaType(attachment.mime_type)
  const image = media?.startsWith('image/') ?? false, video = media?.startsWith('video/') ?? false
  useEffect(() => {
    if (!image || !figure.current) return
    if (!globalThis.IntersectionObserver) { setVisible(true); return }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) { setVisible(true); observer.disconnect() }
    }, { rootMargin: '200px' })
    observer.observe(figure.current)
    return () => observer.disconnect()
  }, [image])
  useEffect(() => {
    if (!api || attachment.deleted || removed) return
    let controller: AbortController | null = null
    const changed = (event: Event) => {
      const value = (event as CustomEvent<AttachmentChange>).detail
      if (!value || value.channel_id && value.channel_id !== channelId || value.conversation_id && value.conversation_id !== conversationId) return
      if (Array.isArray(value.attachment_ids)) {
        if (value.attachment_ids.includes(attachment.id)) { dropThumbnail(thumbnailKey); setRemoved(true) }
        return
      }
      // Compatibility with older servers: revalidate metadata, preserving media URLs.
      if (!(channelId && value.channel_id === channelId || conversationId && value.conversation_id === conversationId)) return
      controller?.abort(); controller = new AbortController()
      const signal = controller.signal
      void api.community.attachmentStatus(tokenRef.current, attachment.id, signal).catch((caught: unknown) => {
        if (!signal.aborted && caught && typeof caught === 'object' && 'status' in caught && (caught.status === 410 || caught.status === 404)) { dropThumbnail(thumbnailKey); setRemoved(true) }
      })
    }
    window.addEventListener('voxhold:attachments', changed)
    return () => { controller?.abort(); window.removeEventListener('voxhold:attachments', changed) }
  }, [api, userId, attachment.id, attachment.deleted, removed, channelId, conversationId, thumbnailKey])
  useEffect(() => {
    if (!api || !image || !visible || attachment.deleted || removed) return
    const controller = new AbortController(); let leased = false
    const cached = acquireThumbnail(thumbnailKey)
    if (cached) { leased = true; setPreviewURL(cached) }
    else void attachmentRequest(controller.signal, () => retryBusy(controller.signal, () => api.community.thumbnail(tokenRef.current, attachment.id, controller.signal))).then((blob) => {
      if (!controller.signal.aborted) { const objectURL = storeThumbnail(thumbnailKey, safeObjectBlob(blob, 'image/jpeg')); leased = true; setPreviewURL(objectURL) }
    }).catch((caught: unknown) => { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : 'Не удалось загрузить превью') })
    return () => { controller.abort(); if (leased) releaseThumbnail(thumbnailKey) }
  }, [api, userId, attachment.id, attachment.deleted, removed, image, visible, revision, thumbnailKey])
  useEffect(() => {
    if (!api || !requested || attachment.deleted || removed) return
    const controller = new AbortController(); let objectURL = ''
    setError('')
    void attachmentRequest(controller.signal, () => retryBusy(controller.signal, () => api.community.content(tokenRef.current, attachment.id, controller.signal))).then((blob) => {
      if (!controller.signal.aborted) { objectURL = URL.createObjectURL(safeObjectBlob(blob, attachment.mime_type)); setURL(objectURL) }
    }).catch((caught: unknown) => {
      if (!controller.signal.aborted) {
        if (caught && typeof caught === 'object' && 'status' in caught && caught.status === 410) setRemoved(true)
        else setError(caught instanceof Error ? caught.message : 'Не удалось загрузить вложение')
      }
    })
    return () => { controller.abort(); if (objectURL) URL.revokeObjectURL(objectURL) }
  }, [api, userId, attachment.id, attachment.mime_type, attachment.deleted, removed, requested, revision])
  if (attachment.deleted || removed) return <div className="attachment-deleted">Вложение удалено сервером · {attachment.filename}</div>
  return <figure ref={figure} className="attachment-card">
    {image && (previewURL || url) ? <button type="button" className="attachment-image" onClick={() => { setExpanded(true); setRequested(true) }} aria-label={`Открыть изображение ${attachment.filename}`}><img src={previewURL || url} alt={attachment.filename} loading="lazy"/></button>
      : video && url ? <video controls preload="metadata" src={url}/>
      : <button type="button" onClick={() => setRequested(true)}>{image ? 'Загрузка изображения…' : video ? 'Посмотреть видео' : 'Загрузить файл'} · {attachment.filename}</button>}
    <figcaption>{attachment.filename} · {bytes(attachment.size_bytes)}{url ? <a href={url} download={attachment.filename}>Скачать</a> : image && <button type="button" onClick={() => setRequested(true)}>Скачать оригинал</button>}</figcaption>
    {error && <p role="alert">{error}<button type="button" onClick={() => { setError(''); setRevision((v) => v + 1) }}>Повторить</button></p>}
    <Modal open={expanded} title={attachment.filename} onClose={() => setExpanded(false)} size="medium">{url ? <img className="attachment-lightbox" src={url} alt={attachment.filename}/> : <p role="status">Загружаем оригинал…</p>}</Modal>
  </figure>
}
interface Upload {
  id: string; file: File; progress: number; preview?: string
  state: 'uploading' | 'ready' | 'failed'; attachment?: Attachment; error?: string; note?: string
}
/** Files are staged until the composer submits one message with all ready IDs. */
export function useAttachmentUpload(channel: Channel | null, enabled: boolean, threadRootId?: number, conversationId?: number) {
  const context = useCommunity(), [items, setItems] = useState<Upload[]>([]), [preparing, setPreparing] = useState(false)
  const tokenRef = useRef(context?.token ?? '')
  useEffect(() => { tokenRef.current = context?.token ?? '' }, [context?.token])
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
      patch({ state: 'uploading', error: undefined, note: undefined })
      const attachment = await retryBusy(controller.signal, () => { patch({ note: undefined, progress: 0 }); return context.api.community.upload(tokenRef.current, channel.id, id, item.file, (progress) => patch({ progress }), controller.signal, conversationId) }, 5, () => patch({ note: 'Сервер занят, повторяем…' }))
      patch({ state: 'ready', progress: 1, attachment, note: undefined })
    } catch (caught) {
      patch({ state: 'failed', note: undefined, error: caught instanceof Error ? caught.message : 'Соединение прервано' })
    } finally { if (controllers.current.get(id) === controller) controllers.current.delete(id) }
  }
  const enqueue = (id: string) => { const expected = generation.current; sequence.current = sequence.current.then(() => run(id, expected)) }
  const add = (files: FileList | File[]) => {
    if (!context || !channel || !enabled) return
    const values: Upload[] = [...files].slice(0, Math.max(0, 10 - current.current.length)).map((file) => {
      let preview: string | undefined
      if (inlineMediaType(file.type)?.startsWith('image/') && typeof URL.createObjectURL === 'function') preview = URL.createObjectURL(safeObjectBlob(file, file.type))
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
  const control = context && enabled ? <div className="attachment-upload"><label className={`attachment-picker ${preparing ? 'is-disabled' : ''}`}>Прикрепить файл<input type="file" multiple disabled={preparing || items.length >= 10} onChange={(e) => { if (e.target.files) add(e.target.files); e.target.value = '' }}/></label><small>{items.length ? `${items.length} из 10 · отправятся вместе с текстом` : 'Картинки и файлы вместе с текстом · до 64 МБ на файл'}</small>{items.length > 0 && <div className="attachment-drafts" role="list" aria-label="Вложения к сообщению">{items.map((item) => <div className={`attachment-draft ${item.state === 'failed' ? 'is-failed' : ''}`} key={item.id} role="listitem">{item.preview ? <img src={item.preview} alt={item.file.name}/> : <span className="attachment-draft__icon"><Icon name={item.file.type.startsWith('video/') ? 'monitor' : 'copy'} size={24}/></span>}<div><b title={item.file.name}>{item.file.name}</b><small>{bytes(item.file.size)} · {item.state === 'ready' ? 'Готово к отправке' : item.state === 'failed' ? 'Ошибка загрузки' : `${Math.round(item.progress * 100)}%`}</small>{item.state === 'uploading' && item.note && <small role="status">{item.note}</small>}{item.state === 'uploading' && <progress max={1} value={item.progress} aria-label={`Загрузка ${item.file.name}`}/>} {item.state === 'failed' && <><small role="alert">{item.error}</small>{item.file.size <= 64 * 1024 ** 2 && <button type="button" disabled={preparing} onClick={() => enqueue(item.id)}>Повторить</button>}</>}</div><button className="attachment-draft__remove" type="button" disabled={preparing} aria-label={`Убрать ${item.file.name}`} title="Убрать вложение" onClick={() => remove(item.id)}><Icon name="close" size={14}/></button></div>)}</div>}</div> : null
  return { onPaste, onDrop, onDragOver, control, hasItems: items.length > 0, preparing, prepare, commit, release }
}
