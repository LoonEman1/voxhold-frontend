import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'

export const DEFAULT_CHANNEL_SIDEBAR_WIDTH = 252
export const DEFAULT_MEMBERS_SIDEBAR_WIDTH = 238
export const MIN_CHANNEL_SIDEBAR_WIDTH = 210
export const MAX_CHANNEL_SIDEBAR_WIDTH = 480
export const MIN_MEMBERS_SIDEBAR_WIDTH = 190
export const MAX_MEMBERS_SIDEBAR_WIDTH = 420

const MIN_CONTENT_WIDTH = 390
const STORAGE_KEY = 'voxhold.workspace-layout.v1'

type ResizeTarget = 'channels' | 'members'

interface WorkspaceLayout {
  channelWidth: number
  membersWidth: number
  membersOpen: boolean
}

interface SavedWorkspaceLayout {
  channel_width?: number
  members_width?: number
  members_open?: boolean
}

export function clampWorkspacePanelWidth(target: ResizeTarget, width: number, maximum?: number): number {
  const minimum = target === 'channels' ? MIN_CHANNEL_SIDEBAR_WIDTH : MIN_MEMBERS_SIDEBAR_WIDTH
  const configuredMaximum = target === 'channels' ? MAX_CHANNEL_SIDEBAR_WIDTH : MAX_MEMBERS_SIDEBAR_WIDTH
  const fallback = target === 'channels' ? DEFAULT_CHANNEL_SIDEBAR_WIDTH : DEFAULT_MEMBERS_SIDEBAR_WIDTH
  const effectiveMaximum = Math.max(minimum, Math.min(configuredMaximum, maximum !== undefined && Number.isFinite(maximum) ? maximum : configuredMaximum))
  return Math.round(Math.min(effectiveMaximum, Math.max(minimum, Number.isFinite(width) ? width : fallback)))
}

function loadWorkspaceLayout(): WorkspaceLayout {
  let saved: SavedWorkspaceLayout = {}
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) saved = parsed as SavedWorkspaceLayout
  } catch {
    saved = {}
  }
  const desktop = typeof window.matchMedia !== 'function' || window.matchMedia('(min-width: 1181px)').matches
  return {
    channelWidth: clampWorkspacePanelWidth('channels', saved.channel_width ?? DEFAULT_CHANNEL_SIDEBAR_WIDTH),
    membersWidth: clampWorkspacePanelWidth('members', saved.members_width ?? DEFAULT_MEMBERS_SIDEBAR_WIDTH),
    membersOpen: typeof saved.members_open === 'boolean' ? saved.members_open : desktop,
  }
}

export function useWorkspaceLayout() {
  const [layout, setLayout] = useState(loadWorkspaceLayout)
  const cancelResize = useRef<(() => void) | null>(null)

  useEffect(() => {
    // Persist once a drag settles instead of synchronously writing on each move.
    const timer = window.setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
          channel_width: layout.channelWidth,
          members_width: layout.membersWidth,
          members_open: layout.membersOpen,
        }))
      } catch { /* The layout still works when browser storage is unavailable. */ }
    }, 150)
    return () => window.clearTimeout(timer)
  }, [layout])

  useEffect(() => () => cancelResize.current?.(), [])

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const compact = window.matchMedia('(max-width: 1180px)')
    const closeForCompactLayout = (event: MediaQueryListEvent) => {
      if (event.matches) setLayout((current) => ({ ...current, membersOpen: false }))
    }
    compact.addEventListener('change', closeForCompactLayout)
    return () => compact.removeEventListener('change', closeForCompactLayout)
  }, [])

  const panelMaximum = (target: ResizeTarget, element?: HTMLElement) => {
    if (target === 'members' && window.innerWidth <= 1180) return undefined
    const workspace = element?.closest('.workspace')
    if (!workspace) return undefined
    const navigation = workspace.querySelector('.personal-rail')?.getBoundingClientRect().width ?? 0
    const otherPanel = target === 'members' ? '.channel-sidebar' : window.innerWidth > 1180 ? '.members-sidebar.is-open' : ''
    const reserved = otherPanel ? workspace.querySelector(otherPanel)?.getBoundingClientRect().width ?? 0 : 0
    return workspace.getBoundingClientRect().width - navigation - reserved - MIN_CONTENT_WIDTH
  }

  const resize = (target: ResizeTarget, width: number, maximum?: number) => {
    setLayout((current) => {
      const nextWidth = clampWorkspacePanelWidth(target, width, maximum)
      if ((target === 'channels' ? current.channelWidth : current.membersWidth) === nextWidth) return current
      return target === 'channels'
        ? { ...current, channelWidth: nextWidth }
        : { ...current, membersWidth: nextWidth }
    })
  }

  const beginResize = (target: ResizeTarget, event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0 || window.matchMedia?.('(max-width: 760px)').matches) return
    cancelResize.current?.()
    event.preventDefault()
    const startX = event.clientX
    const startWidth = event.currentTarget.parentElement?.getBoundingClientRect().width || (target === 'channels' ? layout.channelWidth : layout.membersWidth)
    const maximum = panelMaximum(target, event.currentTarget)
    let frame = 0, nextWidth = startWidth
    document.body.classList.add('is-resizing-workspace')

    const move = (pointerEvent: PointerEvent) => {
      if (pointerEvent.pointerId !== event.pointerId) return
      const delta = pointerEvent.clientX - startX
      nextWidth = startWidth + (target === 'channels' ? delta : -delta)
      if (!frame) frame = window.requestAnimationFrame(() => { frame = 0; resize(target, nextWidth, maximum) })
    }
    const clear = (commit: boolean) => {
      if (frame) window.cancelAnimationFrame(frame)
      if (commit) resize(target, nextWidth, maximum)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
      window.removeEventListener('blur', finish)
      document.body.classList.remove('is-resizing-workspace')
      cancelResize.current = null
    }
    const finish = () => clear(true)
    cancelResize.current = () => clear(false)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
    window.addEventListener('blur', finish)
  }

  const handleResizeKey = (target: ResizeTarget, event: KeyboardEvent<HTMLElement>) => {
    const maximum = panelMaximum(target, event.currentTarget)
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      resize(target, event.key === 'End' ? target === 'channels' ? MAX_CHANNEL_SIDEBAR_WIDTH : MAX_MEMBERS_SIDEBAR_WIDTH : target === 'channels' ? DEFAULT_CHANNEL_SIDEBAR_WIDTH : DEFAULT_MEMBERS_SIDEBAR_WIDTH, maximum)
      return
    }
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const handleDelta = event.key === 'ArrowRight' ? 16 : -16
    const currentWidth = event.currentTarget.parentElement?.getBoundingClientRect().width || (target === 'channels' ? layout.channelWidth : layout.membersWidth)
    resize(target, currentWidth + (target === 'channels' ? handleDelta : -handleDelta), maximum)
  }

  const resetPanel = (target: ResizeTarget) => {
    resize(target, target === 'channels' ? DEFAULT_CHANNEL_SIDEBAR_WIDTH : DEFAULT_MEMBERS_SIDEBAR_WIDTH)
  }

  const style = {
    '--channel-sidebar-width': `${layout.channelWidth}px`,
    '--members-sidebar-width': `${layout.membersWidth}px`,
  } as CSSProperties

  return {
    ...layout,
    style,
    beginResize,
    handleResizeKey,
    resetPanel,
    toggleMembers: () => setLayout((current) => ({ ...current, membersOpen: !current.membersOpen })),
    closeMembers: () => setLayout((current) => ({ ...current, membersOpen: false })),
  }
}
