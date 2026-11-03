import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import '../styles/floating-window.css'

export interface WindowBounds { x: number; y: number; width: number; height: number }
interface Viewport { width: number; height: number; left: number; bottom: number }
const MARGIN = 12

export function constrainWindow(value: WindowBounds, viewport: Viewport, minWidth = 280, minHeight = 200): WindowBounds {
  const availableWidth = Math.max(1, viewport.width - viewport.left - MARGIN * 2)
  const availableHeight = Math.max(1, viewport.height - viewport.bottom - MARGIN * 2)
  const width = Math.min(availableWidth, Math.max(Math.min(minWidth, availableWidth), value.width))
  const height = Math.min(availableHeight, Math.max(Math.min(minHeight, availableHeight), value.height))
  return { width, height, x: Math.max(viewport.left + MARGIN, Math.min(viewport.width - width - MARGIN, value.x)), y: Math.max(MARGIN, Math.min(viewport.height - viewport.bottom - height - MARGIN, value.y)) }
}

function viewport(): Viewport {
  const rail = document.querySelector('.personal-rail')?.getBoundingClientRect()
  return { width: window.innerWidth, height: Math.min(window.innerHeight, window.visualViewport?.height ?? window.innerHeight), left: window.innerWidth > 760 ? rail?.width ?? 0 : 0, bottom: window.innerWidth <= 760 ? rail?.height ?? 63 : 0 }
}

export function useFloatingWindow({ storageKey, width, height, minWidth = 280, minHeight = 200, enabled = true, collapsed = false, elementRef }: {
  storageKey: string; width: number; height: number; minWidth?: number; minHeight?: number; enabled?: boolean; collapsed?: boolean; elementRef?: RefObject<HTMLElement | null>
}) {
  const ownRef = useRef<HTMLElement>(null), ref = elementRef ?? ownRef
  const defaults = () => constrainWindow({ x: window.innerWidth - width - MARGIN, y: 86, width, height }, viewport(), minWidth, minHeight)
  const [bounds, setBounds] = useState<WindowBounds>(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(storageKey) ?? 'null')
      if (saved && typeof saved === 'object' && ['x', 'y', 'width', 'height'].every((key) => typeof (saved as Record<string, unknown>)[key] === 'number' && Number.isFinite((saved as Record<string, number>)[key])) && (saved as WindowBounds).width > 0 && (saved as WindowBounds).height > 0) return constrainWindow(saved as WindowBounds, viewport(), minWidth, minHeight)
    } catch { /* Positioning works without browser storage. */ }
    return defaults()
  })
  const live = useRef(bounds), preferred = useRef(bounds), cancel = useRef<(() => void) | null>(null)
  const saveTimer = useRef(0), pendingSave = useRef<WindowBounds | null>(null)
  const save = (value: WindowBounds) => { try { localStorage.setItem(storageKey, JSON.stringify(value)) } catch { /* Keep in-memory geometry. */ } }
  const commit = (next: WindowBounds) => {
    live.current = next; preferred.current = next; setBounds(next); pendingSave.current = next
    window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => { save(next); pendingSave.current = null }, 150)
  }
  const fit = (next: WindowBounds) => {
    const area = viewport(), fitted = constrainWindow(next, area, minWidth, minHeight)
    if (collapsed) fitted.y = Math.max(MARGIN, Math.min(area.height - area.bottom - (ref.current?.getBoundingClientRect().height || 120) - MARGIN, next.y))
    return fitted
  }

  useEffect(() => {
    if (!enabled) return
    let frame = 0
    const resize = () => {
      if (frame) return
      frame = window.requestAnimationFrame(() => {
        frame = 0; cancel.current?.()
        const area = viewport(), fitted = constrainWindow(preferred.current, area, minWidth, minHeight)
        if (collapsed) fitted.y = Math.max(MARGIN, Math.min(area.height - area.bottom - (ref.current?.getBoundingClientRect().height || 120) - MARGIN, preferred.current.y))
        live.current = fitted
        setBounds((current) => Object.keys(fitted).every((key) => fitted[key as keyof WindowBounds] === current[key as keyof WindowBounds]) ? current : fitted)
      })
    }
    resize()
    window.addEventListener('resize', resize); window.visualViewport?.addEventListener('resize', resize)
    return () => { if (frame) window.cancelAnimationFrame(frame); cancel.current?.(); window.removeEventListener('resize', resize); window.visualViewport?.removeEventListener('resize', resize) }
  }, [enabled, minWidth, minHeight, collapsed, ref])

  useEffect(() => {
    return () => {
      cancel.current?.(); window.clearTimeout(saveTimer.current)
      if (pendingSave.current) { try { localStorage.setItem(storageKey, JSON.stringify(pendingSave.current)) } catch { /* Optional preference. */ } }
    }
  }, [storageKey])

  const begin = (kind: 'move' | 'resize', event: ReactPointerEvent<HTMLElement>) => {
    if (!enabled || event.button !== 0 || kind === 'resize' && collapsed) return
    cancel.current?.(); event.preventDefault(); event.stopPropagation(); event.currentTarget.focus({ preventScroll: true })
    const start = { ...live.current }, x = event.clientX, y = event.clientY, pointerId = event.pointerId
    let frame = 0, next = start
    const paint = () => {
      frame = 0
      const node = ref.current
      if (!node) return
      live.current = next
      node.style.left = `${next.x}px`; node.style.top = `${next.y}px`; node.style.width = `${next.width}px`
      if (!collapsed) node.style.height = `${next.height}px`
    }
    const move = (pointer: PointerEvent) => {
      if (pointer.pointerId !== pointerId) return
      next = fit(kind === 'move' ? { ...start, x: start.x + pointer.clientX - x, y: start.y + pointer.clientY - y } : { ...start, width: start.width + pointer.clientX - x, height: start.height + pointer.clientY - y })
      if (!frame) frame = window.requestAnimationFrame(paint)
    }
    const clear = (persist: boolean) => {
      if (frame) window.cancelAnimationFrame(frame)
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', finish); window.removeEventListener('pointercancel', finish); window.removeEventListener('blur', finish)
      document.body.classList.remove('is-adjusting-window'); cancel.current = null
      if (persist) { paint(); commit(next) }
    }
    const finish = (event: Event) => { if ('pointerId' in event && event.pointerId !== pointerId) return; clear(true) }
    cancel.current = () => clear(false)
    document.body.classList.add('is-adjusting-window')
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', finish); window.addEventListener('pointercancel', finish); window.addEventListener('blur', finish)
  }
  const key = (kind: 'move' | 'resize', event: KeyboardEvent<HTMLElement>) => {
    if (!enabled) return
    if (event.key === 'Home') { event.preventDefault(); commit(defaults()); return }
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
    event.preventDefault()
    const step = event.shiftKey ? 40 : 16, horizontal = event.key === 'ArrowLeft' || event.key === 'ArrowRight'
    const delta = (event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1) * step
    const field = kind === 'move' ? horizontal ? 'x' : 'y' : horizontal ? 'width' : 'height'
    commit(fit({ ...live.current, [field]: live.current[field] + delta }))
  }
  const style: CSSProperties = { left: bounds.x, top: bounds.y, width: bounds.width, height: collapsed ? undefined : bounds.height, right: 'auto', bottom: 'auto' }
  return { ref, style, beginMove: (event: ReactPointerEvent<HTMLElement>) => begin('move', event), beginResize: (event: ReactPointerEvent<HTMLElement>) => begin('resize', event), moveKey: (event: KeyboardEvent<HTMLElement>) => key('move', event), resizeKey: (event: KeyboardEvent<HTMLElement>) => key('resize', event) }
}
