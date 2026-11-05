import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { Icon, type IconName } from './Icon'

export interface ComposerAttachmentActions {
  onAttach: () => void; attachmentDisabled?: boolean; onPoll: () => void
  onSchedule: () => void; onScheduled: () => void
}
interface Action { label: string; detail: string; icon: IconName; tone: string; run: () => void; disabled?: boolean }
type Props = { id: string; anchor: RefObject<HTMLButtonElement | null>; onClose: () => void } & (
  { mode: 'attachment' } & ComposerAttachmentActions | { mode: 'send'; onSchedule: () => void }
)

export default function ComposerActionMenu({ id, anchor, onClose, ...controls }: Props) {
  const schedule: Action = { label: 'Отложить сообщение', detail: 'Выбрать дату и время отправки', icon: 'calendar', tone: 'green', run: controls.onSchedule }
  const actions: Action[] = controls.mode === 'attachment' ? [
    { label: 'Прикрепить файл', detail: 'Фото, видео и файлы · до 64 МБ', icon: 'paperclip', tone: 'blue', run: controls.onAttach, disabled: controls.attachmentDisabled },
    { label: 'Опрос', detail: 'Задать вопрос участникам', icon: 'poll', tone: 'purple', run: controls.onPoll },
    schedule,
    { label: 'Отложенные', detail: 'Сообщения, ожидающие отправки', icon: 'clock', tone: 'amber', run: controls.onScheduled },
  ] : [schedule]
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
