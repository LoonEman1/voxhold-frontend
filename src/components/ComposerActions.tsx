import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { Icon, type IconName } from './Icon'
import '../styles/composer-tools.css'

interface Action { label: string; detail: string; icon: IconName; tone: string; run: () => void; disabled?: boolean }

function ActionMenu({ id, anchor, actions, onClose }: { id: string; anchor: RefObject<HTMLButtonElement | null>; actions: Action[]; onClose: () => void }) {
  const root = useRef<HTMLDivElement>(null), close = useRef(onClose)
  close.current = onClose
  const [position, setPosition] = useState({ left: 0, top: 0 })
  useLayoutEffect(() => {
    const button = anchor.current?.getBoundingClientRect(), menu = root.current?.getBoundingClientRect()
    const top = anchor.current?.closest('form')?.getBoundingClientRect().top ?? button?.top
    if (button && menu && top !== undefined) setPosition({ left: Math.max(8, Math.min(button.left, innerWidth - menu.width - 8)), top: Math.max(8, top - menu.height - 8) })
  }, [anchor])
  useEffect(() => {
    root.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true })
    const pointer = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node) && !anchor.current?.contains(event.target as Node)) close.current() }
    const dismiss = () => close.current()
    window.addEventListener('pointerdown', pointer, true); window.addEventListener('resize', dismiss); window.addEventListener('blur', dismiss)
    return () => { window.removeEventListener('pointerdown', pointer, true); window.removeEventListener('resize', dismiss); window.removeEventListener('blur', dismiss) }
  }, [anchor])
  return createPortal(<div id={id} ref={root} className="composer-menu" role="menu" aria-label="Действия с сообщением" style={position} onKeyDown={(event) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); anchor.current?.focus(); return }
    if (event.key === 'Tab') { onClose(); anchor.current?.focus(); return }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const buttons = [...root.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')], index = buttons.indexOf(document.activeElement as HTMLButtonElement)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
    buttons[next]?.focus()
  }}>{actions.map((action) => <button key={action.label} type="button" role="menuitem" aria-label={action.label} aria-description={action.detail} disabled={action.disabled} onClick={() => { onClose(); anchor.current?.focus({ preventScroll: true }); action.run() }}>
    <span className={`composer-menu__icon composer-menu__icon--${action.tone}`}><Icon name={action.icon} size={20}/></span>
    <span className="composer-menu__text"><b>{action.label}</b><small>{action.detail}</small></span>
  </button>)}</div>, document.fullscreenElement ?? document.body)
}

export function ComposerAttachmentButton({ onAttach, attachmentDisabled, onPoll, onSchedule, onScheduled, disabled = false }: {
  onAttach: () => void; attachmentDisabled?: boolean; onPoll: () => void; onSchedule: () => void; onScheduled: () => void; disabled?: boolean
}) {
  const [open, setOpen] = useState(false), anchor = useRef<HTMLButtonElement>(null), id = useId()
  return <><button ref={anchor} type="button" className="composer__attach" aria-label="Добавить к сообщению" title="Вложения и действия" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined} disabled={disabled} onClick={() => setOpen((value) => !value)} onKeyDown={(event) => { if (event.key === 'ArrowUp' || event.key === 'ArrowDown') { event.preventDefault(); setOpen(true) } }}><Icon name="paperclip" size={21}/></button>
    {open && <ActionMenu id={id} anchor={anchor} onClose={() => setOpen(false)} actions={[
      { label: 'Прикрепить файл', detail: 'Фото, видео и файлы · до 64 МБ', icon: 'paperclip', tone: 'blue', run: onAttach, disabled: attachmentDisabled },
      { label: 'Опрос', detail: 'Задать вопрос участникам', icon: 'poll', tone: 'purple', run: onPoll },
      { label: 'Отложить сообщение', detail: 'Выбрать дату и время отправки', icon: 'calendar', tone: 'green', run: onSchedule },
      { label: 'Отложенные', detail: 'Сообщения, ожидающие отправки', icon: 'clock', tone: 'amber', run: onScheduled },
    ]}/>}
  </>
}

export function ComposerSendButton({ disabled, label = 'Отправить', children, onSchedule }: { disabled: boolean; label?: string; children: ReactNode; onSchedule?: () => void }) {
  const [open, setOpen] = useState(false), anchor = useRef<HTMLButtonElement>(null), id = useId()
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined), held = useRef(false)
  const cancel = () => { clearTimeout(timer.current); timer.current = undefined }
  useEffect(() => { window.addEventListener('blur', cancel); return () => { cancel(); window.removeEventListener('blur', cancel) } }, [])
  return <><button ref={anchor} type="submit" className="composer__send" disabled={disabled} aria-label={label} title={onSchedule ? `${label} · удерживайте для отложенной отправки` : label} aria-haspopup={onSchedule ? 'menu' : undefined} aria-expanded={onSchedule ? open : undefined} aria-controls={open ? id : undefined}
    onPointerDown={(event) => { cancel(); held.current = false; if (event.button !== 0 || !onSchedule || disabled) return; timer.current = setTimeout(() => { held.current = true; setOpen(true) }, 450) }}
    onPointerUp={cancel} onPointerCancel={cancel} onPointerLeave={cancel}
    onClick={(event) => { if (held.current) { event.preventDefault(); held.current = false } }}
    onContextMenu={(event) => { if (onSchedule && !disabled) { event.preventDefault(); event.stopPropagation(); cancel(); setOpen(true) } }}
    onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') held.current = false; if (onSchedule && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) { event.preventDefault(); setOpen(true) } }}>{children}</button>
    {open && onSchedule && <ActionMenu id={id} anchor={anchor} onClose={() => setOpen(false)} actions={[{ label: 'Отложить сообщение', detail: 'Выбрать дату и время отправки', icon: 'calendar', tone: 'green', run: onSchedule }]}/>}
  </>
}
