import { useEffect, useId, useRef, useState, type ChangeEvent, type PointerEvent, type ReactNode } from 'react'
import { avatarCrop, clamp, type AvatarCrop, type CropPosition, type ImageDimensions } from '../lib/avatarCrop'
import { humanError } from '../lib/format'
import { Avatar } from './Avatar'
import { Icon } from './Icon'

interface Selection extends ImageDimensions { file: File; url: string }
interface Props {
  userId?: number
  name: string
  hasAvatar: boolean
  disabled?: boolean
  onSave(file: File | null, crop?: AvatarCrop): Promise<void>
  onBusyChange(busy: boolean): void
  children?: ReactNode
}

export function AvatarEditor({ userId, name, hasAvatar, disabled, onSave, onBusyChange, children }: Props) {
  const [menu, setMenu] = useState(false)
  const [selection, setSelection] = useState<Selection | null>(null)
  const [zoom, setZoom] = useState(1)
  const [position, setPosition] = useState<CropPosition>({ x: 0, y: 0 })
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const root = useRef<HTMLDivElement>(null)
  const previewURL = useRef<string | null>(null)
  const generation = useRef(0)
  const drag = useRef<{ id: number; x: number; y: number; position: CropPosition } | null>(null)
  const menuId = useId()
  const crop = selection ? avatarCrop(selection, zoom, position) : null
  const blocked = pending || disabled

  useEffect(() => () => {
    generation.current++
    if (previewURL.current) URL.revokeObjectURL(previewURL.current)
  }, [])
  useEffect(() => {
    if (!menu) return
    const dismiss = (event: globalThis.PointerEvent) => { if (!root.current?.contains(event.target as Node)) setMenu(false) }
    document.addEventListener('pointerdown', dismiss)
    return () => document.removeEventListener('pointerdown', dismiss)
  }, [menu])

  const clearSelection = () => {
    generation.current++
    if (previewURL.current) URL.revokeObjectURL(previewURL.current)
    previewURL.current = null
    setSelection(null)
  }
  const choose = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setMenu(false); setError('')
    if (file.size > 5 * 1024 * 1024) { setError('Максимальный размер аватара — 5 МБ'); return }
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type)) { setError('Выберите JPEG, PNG, WebP или GIF'); return }
    clearSelection()
    const current = generation.current
    const url = URL.createObjectURL(file)
    previewURL.current = url
    const image = new Image()
    image.src = url
    try {
      await image.decode()
      if (current !== generation.current) return
      if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 16_000_000) throw new Error('Выберите изображение до 16 мегапикселей')
      setSelection({ file, url, width: image.naturalWidth, height: image.naturalHeight })
      setZoom(1); setPosition({ x: 0, y: 0 })
    } catch (caught) {
      if (current !== generation.current) return
      clearSelection(); setError(caught instanceof Error && caught.message.includes('мегапикселей') ? caught.message : 'Не удалось открыть изображение. Выберите другой файл.')
    }
  }
  const save = async (file: File | null, area?: AvatarCrop) => {
    if (blocked) return
    setPending(true); onBusyChange(true); setError('')
    try { await onSave(file, area); clearSelection(); setMenu(false) }
    catch (caught) { setError(humanError(caught)) }
    finally { setPending(false); onBusyChange(false) }
  }
  const move = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current || !selection || !crop || drag.current.id !== event.pointerId) return
    const scale = crop.size / event.currentTarget.getBoundingClientRect().width
    const rangeX = selection.width - crop.size, rangeY = selection.height - crop.size
    setPosition({
      x: rangeX ? clamp(drag.current.position.x - 2 * (event.clientX - drag.current.x) * scale / rangeX) : 0,
      y: rangeY ? clamp(drag.current.position.y - 2 * (event.clientY - drag.current.y) * scale / rangeY) : 0,
    })
  }
  return <div className="avatar-editor" ref={root}>
    <button type="button" className="avatar-editor__trigger" disabled={blocked} onClick={() => setMenu((value) => !value)} aria-label="Изменить аватар" aria-expanded={menu} aria-controls={menu ? menuId : undefined}>
      <Avatar userId={userId} name={name} size="large"/>
      <span className="avatar-editor__camera"><Icon name="camera" size={23}/></span>
    </button>
    <div className="avatar-editor__details">{children}<span className="avatar-editor__hint">Нажмите на фото, чтобы изменить аватар</span></div>
    <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,image/gif" aria-label="Файл аватара" disabled={blocked} onChange={(event) => void choose(event)} hidden/>
    {menu && <div id={menuId} className="avatar-editor__menu">
      <button type="button" disabled={blocked} onClick={() => input.current?.click()}><Icon name="camera" size={16}/>Выбрать изображение</button>
      {hasAvatar && <button type="button" className="avatar-editor__remove" disabled={blocked} onClick={() => void save(null)}><Icon name="trash" size={16}/>Удалить аватар</button>}
    </div>}
    {selection && crop && <section className="avatar-crop" aria-label="Область аватара">
      <div className="avatar-crop__heading"><b>Выберите область фото</b><small>Перетащите фото или используйте ползунки</small></div>
      <div className="avatar-crop__viewport" onPointerDown={(event) => {
        if (blocked || event.button !== 0) return
        event.currentTarget.setPointerCapture(event.pointerId)
        drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, position }
      }} onPointerMove={move} onPointerUp={() => { drag.current = null }} onPointerCancel={() => { drag.current = null }}>
        <img src={selection.url} alt="Предпросмотр круглого аватара" draggable={false} style={{ width: `${selection.width / crop.size * 100}%`, height: `${selection.height / crop.size * 100}%`, left: `${-crop.x / crop.size * 100}%`, top: `${-crop.y / crop.size * 100}%` }}/>
      </div>
      <label><span>Масштаб <output>{zoom.toFixed(1)}×</output></span><input type="range" aria-label="Масштаб" min="1" max="4" step="0.01" value={zoom} disabled={blocked} onChange={(event) => setZoom(Number(event.target.value))}/></label>
      <label><span>По горизонтали</span><input type="range" min="-1" max="1" step="0.01" value={position.x} disabled={blocked || selection.width === crop.size} onChange={(event) => setPosition((value) => ({ ...value, x: Number(event.target.value) }))}/></label>
      <label><span>По вертикали</span><input type="range" min="-1" max="1" step="0.01" value={position.y} disabled={blocked || selection.height === crop.size} onChange={(event) => setPosition((value) => ({ ...value, y: Number(event.target.value) }))}/></label>
      <p>Сохранится только круглая область. Всё за её пределами удаляется на сервере.</p>
      <div className="dialog-actions"><button type="button" className="button button--ghost button--small" disabled={blocked} onClick={clearSelection}>Отменить выбор</button><button type="button" className="button button--primary button--small" disabled={blocked} onClick={() => void save(selection.file, crop)}>{pending ? 'Сохраняем…' : 'Сохранить аватар'}</button></div>
    </section>}
    {error && <div className="form-error" role="alert">{error}</div>}
  </div>
}
