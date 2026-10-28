import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent } from 'react'
import type { Attachment } from '../domain/community'
import type { Channel } from '../domain/types'
import { useCommunity, communityChanged } from './Community'
import { Modal } from './Modal'
import { bytes } from './CommunitySettings'

export function MessageAttachments({ attachments }: { attachments?: Attachment[] }) {
  return <div className="message-attachments">{attachments?.map((attachment) => <AttachmentView key={attachment.id} attachment={attachment}/>)}</div>
}
function AttachmentView({ attachment }: { attachment: Attachment }) {
  const context = useCommunity(), [url, setURL] = useState(''), [error, setError] = useState(''), [removed, setRemoved] = useState(attachment.deleted), [expanded, setExpanded] = useState(false), [requested, setRequested] = useState(false), [revision, setRevision] = useState(0)
  const image = attachment.mime_type.startsWith('image/'), video = attachment.mime_type.startsWith('video/')
  const api = context?.api, token = context?.token
  useEffect(() => { const changed = () => { setURL(''); setRevision((v) => v + 1) }; window.addEventListener('voxhold:attachments', changed); return () => window.removeEventListener('voxhold:attachments', changed) }, [])
  useEffect(() => {
    if (!api || !token || attachment.deleted || (!image && !requested)) return
    const controller = new AbortController(); let objectURL = ''
    setError('')
    void api.community.content(token, attachment.id, controller.signal).then((blob) => { if (!controller.signal.aborted) { objectURL = URL.createObjectURL(blob); setURL(objectURL); setRemoved(false) } }).catch((caught) => { if (!controller.signal.aborted) { if (caught && typeof caught === 'object' && 'status' in caught && caught.status === 410) setRemoved(true); else setError(caught instanceof Error ? caught.message : 'Не удалось загрузить вложение') } })
    return () => { controller.abort(); if (objectURL) URL.revokeObjectURL(objectURL) }
  }, [api, token, attachment.id, attachment.deleted, image, requested, revision])
  if (attachment.deleted || removed) return <div className="attachment-deleted">Вложение удалено сервером · {attachment.filename}</div>
  return <figure className="attachment-card">{image && url ? <button type="button" className="attachment-image" onClick={() => setExpanded(true)} aria-label={`Открыть изображение ${attachment.filename}`}><img src={url} alt={attachment.filename} loading="lazy"/></button> : video && url ? <video controls preload="metadata" src={url}/> : <button type="button" onClick={() => setRequested(true)}>{image ? 'Загрузка изображения…' : video ? 'Посмотреть видео' : 'Загрузить файл'} · {attachment.filename}</button>}<figcaption>{attachment.filename} · {bytes(attachment.size_bytes)}{url && <a href={url} download={attachment.filename}>Скачать</a>}</figcaption>{error && <p role="alert">{error}<button type="button" onClick={() => { setRequested(true); setRevision((v) => v + 1) }}>Повторить</button></p>}<Modal open={expanded} title={attachment.filename} onClose={() => setExpanded(false)} size="medium">{url && <img className="attachment-lightbox" src={url} alt={attachment.filename}/>}</Modal></figure>
}
interface Upload { id: string; key: string; file: File; progress: number; state: 'uploading' | 'sending' | 'failed'; error?: string }
export function useAttachmentUpload(channel: Channel | null, enabled: boolean, threadRootId?: number, conversationId?: number) {
  const context = useCommunity(), [items, setItems] = useState<Upload[]>([]), controllers = useRef(new Map<string, AbortController>()), queued = useRef(0), sequence = useRef(Promise.resolve()), cancelled = useRef(new Set<string>()), mounted = useRef(true)
  useEffect(() => { mounted.current = true; const active = controllers.current; return () => { mounted.current = false; active.forEach((v) => v.abort()); active.clear() } }, [channel?.id])
  const run = async (item: Upload) => {
    if (!context || !channel || !mounted.current || cancelled.current.has(item.id)) return
    const controller = new AbortController(); controllers.current.set(item.id, controller)
    const update = (patch: Partial<Upload>) => { if (!controller.signal.aborted) setItems((v) => v.map((value) => value.id === item.id ? { ...value, ...patch } : value)) }
    try {
      update({ state: 'uploading', error: undefined })
      const attachment = await context.api.community.upload(context.token, channel.id, item.id, item.file, (progress) => update({ progress }), controller.signal, conversationId)
      update({ progress: 1, state: 'sending' })
      const message = conversationId ? await context.api.community.request<import('../domain/community').DirectMessage>(context.token, `/conversations/${conversationId}/messages`, 'POST', { content: '', client_message_id: item.key, attachment_ids: [attachment.id] }, controller.signal) : await context.api.messages.create(context.token, channel.server_id, channel.id, '', item.key, controller.signal, threadRootId, threadRootId, [attachment.id])
      if (!controller.signal.aborted) { if (!conversationId) context.onMessage(message as import('../domain/types').Message); setItems((v) => v.filter((value) => value.id !== item.id)); queued.current--; communityChanged() }
    } catch (caught) { if (!controller.signal.aborted) update({ state: 'failed', error: caught instanceof Error ? caught.message : 'Соединение прервано' }) } finally { controllers.current.delete(item.id) }
  }
  const enqueue = (item: Upload) => { sequence.current = sequence.current.then(() => run(item)) }
  const add = (files: FileList | File[]) => {
    if (!context || !channel || !enabled) return
    const values = [...files].slice(0, Math.max(0, 10 - queued.current)).map((file) => ({ id: crypto.randomUUID().replaceAll('-', ''), key: crypto.randomUUID(), file, progress: 0, state: 'uploading' as const }))
    queued.current += values.length; setItems((v) => [...v, ...values]); values.forEach((v) => { if (v.file.size > 64 * 1024 ** 2) setItems((items) => items.map((item) => item.id === v.id ? { ...item, state: 'failed', error: 'Файл больше 64 МБ' } : item)); else enqueue(v) })
  }
  const onPaste = (event: ClipboardEvent<HTMLElement>) => { if (event.clipboardData.files.length) { event.preventDefault(); event.stopPropagation(); if (enabled) add(event.clipboardData.files) } }
  const onDrop = (event: DragEvent<HTMLElement>) => { if (event.dataTransfer.files.length) { event.preventDefault(); event.stopPropagation(); if (enabled) add(event.dataTransfer.files) } }
  const onDragOver = (event: DragEvent<HTMLElement>) => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = enabled ? 'copy' : 'none' } }
  const control = context && enabled ? <div className="attachment-upload"><label className="attachment-picker">Прикрепить файл<input type="file" multiple onChange={(e) => { if (e.target.files) add(e.target.files); e.target.value = '' }}/></label><small>Перетащите файл или вставьте картинку · до 64 МБ</small>{items.map((item) => <div className="upload-progress" key={item.id}><span>{item.file.name}</span>{item.state !== 'failed' ? <><progress max={1} value={item.progress} aria-label={`Загрузка ${item.file.name}`}/><small>{item.state === 'sending' ? 'Сохраняем сообщение…' : `${Math.round(item.progress * 100)}%`}</small></> : <><small role="alert">{item.error}</small><button type="button" onClick={() => enqueue(item)}>Повторить</button></>}<button type="button" onClick={() => { cancelled.current.add(item.id); controllers.current.get(item.id)?.abort(); setItems((v) => v.filter((value) => value.id !== item.id)); queued.current-- }}>Убрать</button></div>)}</div> : null
  return { onPaste, onDrop, onDragOver, control }
}
