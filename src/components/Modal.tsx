import { useEffect, useId, useRef, type ReactNode } from 'react'
import { Icon } from './Icon'

interface ModalProps {
  open: boolean
  title: string
  eyebrow?: string
  children: ReactNode
  onClose: () => void
  size?: 'small' | 'medium'
}

const stack: { token: symbol; card: HTMLElement }[] = []
function focusable(card: HTMLElement) {
  return [...card.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]')].filter((element) => {
    if (element.tabIndex < 0 || element.matches(':disabled, input[type="hidden"]') || element.closest('[hidden], [inert], [aria-hidden="true"]') || element.closest('[role="dialog"]') !== card) return false
    for (let node: HTMLElement | null = element; node && node !== card.parentElement; node = node.parentElement) {
      const style = getComputedStyle(node)
      if (style.display === 'none' || style.visibility === 'hidden') return false
    }
    return true
  })
}

export function Modal({ open, title, eyebrow, children, onClose, size = 'small' }: ModalProps) {
  const titleId = useId()
  const cardRef = useRef<HTMLElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (!open) return
    const card = cardRef.current!
    const previous = document.activeElement as HTMLElement | null
    const token = Symbol()
    // Child effects mount before their parents; insert ancestors below descendants.
    const descendant = stack.findIndex((entry) => card.contains(entry.card))
    stack.splice(descendant < 0 ? stack.length : descendant, 0, { token, card })
    const isTop = () => stack.at(-1)?.token === token
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isTop() || event.defaultPrevented) return
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); onCloseRef.current(); return }
      if (event.key !== 'Tab') return
      const items = focusable(card), first = items[0], last = items.at(-1)
      const active = document.activeElement
      if (!first) { event.preventDefault(); card.focus({ preventScroll: true }); return }
      if (!card.contains(active) || active === card || event.shiftKey && active === first || !event.shiftKey && active === last) {
        event.preventDefault(); (event.shiftKey ? last! : first).focus({ preventScroll: true })
      }
    }
    document.addEventListener('keydown', onKeyDown)
    document.body.classList.add('modal-open')
    const focusTimer = window.setTimeout(() => { if (isTop()) closeRef.current?.focus({ preventScroll: true }) }, 0)
    return () => {
      window.clearTimeout(focusTimer)
      document.removeEventListener('keydown', onKeyDown)
      const wasTop = isTop(), index = stack.findIndex((entry) => entry.token === token)
      if (index >= 0) stack.splice(index, 1)
      if (!stack.length) document.body.classList.remove('modal-open')
      if (wasTop) {
        const top = stack.at(-1)?.card
        if (previous?.isConnected && (!top || top.contains(previous))) previous.focus({ preventScroll: true })
        else if (top) (focusable(top)[0] ?? top).focus({ preventScroll: true })
      }
    }
  }, [open])

  if (!open) return null
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && stack.at(-1)?.card === cardRef.current && onClose()}>
      <section ref={cardRef} tabIndex={-1} className={`modal-card modal-card--${size}`} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="modal-head">
          <div>
            {eyebrow && <div className="eyebrow">{eyebrow}</div>}
            <h2 id={titleId}>{title}</h2>
          </div>
          <button ref={closeRef} className="icon-button" type="button" onClick={onClose} aria-label="Закрыть">
            <Icon name="close" />
          </button>
        </div>
        {children}
      </section>
    </div>
  )
}
