import { useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type RefObject } from 'react'
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

export function MemberVoiceMenu({ items }: { items: ContextMenuItem[] }) {
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  if (!items.length) return null
  return <div className="member-voice-menu">
    <button ref={trigger} className="button button--secondary button--small" type="button" aria-haspopup="menu" aria-expanded={open}
      onClick={() => setOpen((value) => !value)}><Icon name="mic" size={15}/>Голосовые действия</button>
    {open && <ContextMenu menu={{ x: 0, y: 0, items }} onClose={() => setOpen(false)} trigger={trigger}/>}
  </div>
}

export function ContextMenu({ menu, onClose, trigger }: { menu: ContextMenuState; onClose: () => void; trigger?: RefObject<HTMLElement | null> }) {
  const ref = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ x: menu.x, y: menu.y })
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useLayoutEffect(() => {
    if (trigger) return
    const element = ref.current
    if (!element) return
    const rect = element.getBoundingClientRect()
    setPosition({
      x: Math.max(8, Math.min(menu.x, window.innerWidth - rect.width - 8)),
      y: Math.max(8, Math.min(menu.y, window.innerHeight - rect.height - 8)),
    })
  }, [menu, trigger])

  useLayoutEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const root = ref.current
    root?.querySelector<HTMLElement>('button[role="menuitem"]:not(:disabled), button:not(:disabled), input:not(:disabled)')?.focus({ preventScroll: true })
    const closeOnPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (!root?.contains(target) && !trigger?.current?.contains(target)) onCloseRef.current()
    }
    const closeOnKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) onCloseRef.current()
    }
    const closeOnScroll = () => onCloseRef.current()
    window.addEventListener('pointerdown', closeOnPointerDown, true)
    window.addEventListener('keydown', closeOnKey)
    window.addEventListener('resize', closeOnScroll)
    window.addEventListener('blur', closeOnScroll)
    if (!trigger) document.addEventListener('scroll', closeOnScroll, true)
    return () => {
      if (root?.contains(document.activeElement) && previous?.isConnected) previous.focus({ preventScroll: true })
      window.removeEventListener('pointerdown', closeOnPointerDown, true)
      window.removeEventListener('keydown', closeOnKey)
      window.removeEventListener('resize', closeOnScroll)
      window.removeEventListener('blur', closeOnScroll)
      document.removeEventListener('scroll', closeOnScroll, true)
    }
  }, [trigger])

  return (
    <div ref={ref} className={trigger ? 'context-menu context-menu--anchored' : 'context-menu'} role="menu"
      style={trigger ? undefined : { left: position.x, top: position.y }} onContextMenu={(event) => event.preventDefault()} onKeyDown={(event) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onCloseRef.current(); return }
      if (event.target instanceof Element && event.target.closest('input, select, textarea')) return
      const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]:not(:disabled)')]
      if (!items.length || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
      event.preventDefault()
      const index = items.indexOf(document.activeElement as HTMLButtonElement)
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : event.key === 'ArrowDown' ? (index + 1) % items.length : (index - 1 + items.length) % items.length
      items[next]?.focus({ preventScroll: true })
    }}>
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
