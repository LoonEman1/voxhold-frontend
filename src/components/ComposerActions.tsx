import { Suspense, lazy, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Icon } from './Icon'
import type { ComposerAttachmentActions } from './ComposerActionMenu'
import '../styles/composer-tools.css'

const ActionMenu = lazy(() => import('./ComposerActionMenu'))

export function ComposerAttachmentButton({ onAttach, attachmentDisabled, onPoll, onSchedule, onScheduled, disabled = false }: ComposerAttachmentActions & { disabled?: boolean }) {
  const [open, setOpen] = useState(false), anchor = useRef<HTMLButtonElement>(null), id = useId()
  return <><button ref={anchor} type="button" className="composer__attach" aria-label="Добавить к сообщению" title="Вложения и действия" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined} disabled={disabled} onClick={() => setOpen((value) => !value)} onKeyDown={(event) => { if (event.key === 'ArrowUp' || event.key === 'ArrowDown') { event.preventDefault(); setOpen(true) } }}><Icon name="paperclip" size={21}/></button>
    {open && <Suspense fallback={null}><ActionMenu mode="attachment" id={id} anchor={anchor} onClose={() => setOpen(false)} onAttach={onAttach} attachmentDisabled={attachmentDisabled} onPoll={onPoll} onSchedule={onSchedule} onScheduled={onScheduled}/></Suspense>}
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
    {open && onSchedule && <Suspense fallback={null}><ActionMenu mode="send" id={id} anchor={anchor} onClose={() => setOpen(false)} onSchedule={onSchedule}/></Suspense>}
  </>
}
