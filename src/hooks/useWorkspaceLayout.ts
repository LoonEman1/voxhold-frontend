import { useEffect, useState, type CSSProperties, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'

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
  const effectiveMaximum = Math.max(minimum, Math.min(configuredMaximum, maximum ?? configuredMaximum))
  return Math.round(Math.min(effectiveMaximum, Math.max(minimum, width)))
}

function loadWorkspaceLayout(): WorkspaceLayout {
  let saved: SavedWorkspaceLayout = {}
  try {
    saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as SavedWorkspaceLayout
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

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      channel_width: layout.channelWidth,
      members_width: layout.membersWidth,
      members_open: layout.membersOpen,
    }))
  }, [layout])

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const compact = window.matchMedia('(max-width: 1180px)')
    const closeForCompactLayout = (event: MediaQueryListEvent) => {
      if (event.matches) setLayout((current) => ({ ...current, membersOpen: false }))
    }
    compact.addEventListener('change', closeForCompactLayout)
    return () => compact.removeEventListener('change', closeForCompactLayout)
  }, [])

  const resize = (target: ResizeTarget, width: number, workspaceWidth?: number) => {
    setLayout((current) => {
      const membersAreOverlay = (workspaceWidth ?? Number.POSITIVE_INFINITY) <= 1180
      const remainingPanelWidth = target === 'channels' ? current.membersWidth : current.channelWidth
      const availableMaximum = workspaceWidth === undefined || membersAreOverlay
        ? undefined
        : workspaceWidth - remainingPanelWidth - MIN_CONTENT_WIDTH
      const nextWidth = clampWorkspacePanelWidth(target, width, availableMaximum)
      return target === 'channels'
        ? { ...current, channelWidth: nextWidth }
        : { ...current, membersWidth: nextWidth }
    })
  }

  const beginResize = (target: ResizeTarget, event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0 || window.matchMedia?.('(max-width: 760px)').matches) return
    event.preventDefault()
    const startX = event.clientX
    const startWidth = target === 'channels' ? layout.channelWidth : layout.membersWidth
    const workspaceWidth = event.currentTarget.closest('.workspace')?.getBoundingClientRect().width
    document.body.classList.add('is-resizing-workspace')

    const move = (pointerEvent: PointerEvent) => {
      const delta = pointerEvent.clientX - startX
      resize(target, startWidth + (target === 'channels' ? delta : -delta), workspaceWidth)
    }
    const finish = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
      document.body.classList.remove('is-resizing-workspace')
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
  }

  const handleResizeKey = (target: ResizeTarget, event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Home') {
      event.preventDefault()
      resize(target, target === 'channels' ? DEFAULT_CHANNEL_SIDEBAR_WIDTH : DEFAULT_MEMBERS_SIDEBAR_WIDTH)
      return
    }
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const handleDelta = event.key === 'ArrowRight' ? 16 : -16
    const currentWidth = target === 'channels' ? layout.channelWidth : layout.membersWidth
    resize(target, currentWidth + (target === 'channels' ? handleDelta : -handleDelta))
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
