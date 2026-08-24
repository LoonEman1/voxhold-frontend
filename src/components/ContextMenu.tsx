import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { Icon, type IconName } from './Icon'

export interface ContextMenuAction {
  key: string
  kind: 'action'
  label: string
  icon?: IconName
  danger?: boolean
  disabled?: boolean
  onSelect: () => void
}

export interface ContextMenuVolume {
  key: string
  kind: 'volume'
  value: number
  onChange: (value: number) => void
}

export interface ContextMenuRolePicker {
  key: string
  kind: 'roles'
  currentRole: 'member' | 'admin'
  pending?: boolean
  onChange: (role: 'member' | 'admin') => void
}

export type ContextMenuItem = ContextMenuAction | { key: string; kind: 'separator' } | ContextMenuVolume | ContextMenuRolePicker

export interface ContextMenuState {
  x: number
  y: number
  title?: string
  items: ContextMenuItem[]
}

export function ContextMenu({ menu, onClose }: { menu: ContextMenuState; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ x: menu.x, y: menu.y })
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const rect = element.getBoundingClientRect()
    setPosition({
      x: Math.max(8, Math.min(menu.x, window.innerWidth - rect.width - 8)),
      y: Math.max(8, Math.min(menu.y, window.innerHeight - rect.height - 8)),
    })
  }, [menu])

  useEffect(() => {
    const closeOnPointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) onCloseRef.current()
    }
    const closeOnKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current()
    }
    const closeOnScroll = () => onCloseRef.current()
    window.addEventListener('pointerdown', closeOnPointerDown, true)
    window.addEventListener('keydown', closeOnKey)
    window.addEventListener('resize', closeOnScroll)
    window.addEventListener('blur', closeOnScroll)
    document.addEventListener('scroll', closeOnScroll, true)
    return () => {
      window.removeEventListener('pointerdown', closeOnPointerDown, true)
      window.removeEventListener('keydown', closeOnKey)
      window.removeEventListener('resize', closeOnScroll)
      window.removeEventListener('blur', closeOnScroll)
      document.removeEventListener('scroll', closeOnScroll, true)
    }
  }, [])

  return (
    <div ref={ref} className="context-menu" role="menu" style={{ left: position.x, top: position.y }} onContextMenu={(event) => event.preventDefault()}>
      {menu.title && <div className="context-menu__title">{menu.title}</div>}
      {menu.items.map((item) => {
        if (item.kind === 'separator') return <div className="context-menu__separator" key={item.key} role="separator"/>
        if (item.kind === 'volume') return <VolumeRow key={item.key} item={item}/>
        if (item.kind === 'roles') return <RolePickerRow key={item.key} item={item}/>
        if (item.kind === 'action')
        return (
          <button
            className={`context-menu__item ${item.danger ? 'is-danger' : ''}`}
            type="button"
            role="menuitem"
            key={item.key}
            disabled={item.disabled}
            onClick={() => { item.onSelect(); onClose() }}
          >
            {item.icon && <Icon name={item.icon} size={14}/>}
            <span>{item.label}</span>
          </button>
        )
        return null
      })}
    </div>
  )
}

function VolumeRow({ item }: { item: ContextMenuVolume }) {
  const stop = (event: ReactMouseEvent) => event.stopPropagation()
  return (
    <label className="context-menu__volume" onClick={stop}>
      <Icon name="volume" size={14}/>
      <input type="range" min={0} max={200} step={5} value={item.value} onChange={(event) => item.onChange(Number(event.target.value))} aria-label="Громкость пользователя"/>
      <em>{item.value}%</em>
    </label>
  )
}

function RolePickerRow({ item }: { item: ContextMenuRolePicker }) {
  const stop = (event: ReactMouseEvent) => event.stopPropagation()
  return (
    <div className="context-menu__roles" onClick={stop}>
      <span>Роль</span>
      <div>
        <button type="button" className={item.currentRole === 'member' ? 'is-active' : ''} disabled={item.pending} onClick={() => item.onChange('member')}>Участник</button>
        <button type="button" className={item.currentRole === 'admin' ? 'is-active' : ''} disabled={item.pending} onClick={() => item.onChange('admin')}>Админ</button>
      </div>
    </div>
  )
}
