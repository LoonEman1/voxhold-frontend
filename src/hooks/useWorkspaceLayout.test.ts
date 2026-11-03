// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_CHANNEL_SIDEBAR_WIDTH,
  MAX_CHANNEL_SIDEBAR_WIDTH,
  MIN_CHANNEL_SIDEBAR_WIDTH,
  MIN_MEMBERS_SIDEBAR_WIDTH,
  clampWorkspacePanelWidth,
  useWorkspaceLayout,
} from './useWorkspaceLayout'

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); localStorage.clear() })

describe('workspace layout sizing', () => {
  it('keeps panel widths inside their supported range', () => {
    expect(clampWorkspacePanelWidth('channels', 20)).toBe(MIN_CHANNEL_SIDEBAR_WIDTH)
    expect(clampWorkspacePanelWidth('channels', 900)).toBe(MAX_CHANNEL_SIDEBAR_WIDTH)
    expect(clampWorkspacePanelWidth('members', 10)).toBe(MIN_MEMBERS_SIDEBAR_WIDTH)
  })

  it('honours a smaller maximum when the chat needs more room', () => {
    expect(clampWorkspacePanelWidth('channels', 400, 310)).toBe(310)
    expect(clampWorkspacePanelWidth('channels', DEFAULT_CHANNEL_SIDEBAR_WIDTH, 100)).toBe(MIN_CHANNEL_SIDEBAR_WIDTH)
  })

  it.each(['null', '[]', '{"channel_width":"wide","members_width":null}', '{broken'])('recovers from unsupported saved settings: %s', (saved) => {
    localStorage.setItem('voxhold.workspace-layout.v1', saved)
    const { result } = renderHook(useWorkspaceLayout)
    expect(result.current.channelWidth).toBe(DEFAULT_CHANNEL_SIDEBAR_WIDTH)
    expect(Number.isFinite(result.current.membersWidth)).toBe(true)
  })

  it('does not crash when saving layout preferences is denied', () => {
    vi.useFakeTimers()
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Blocked', 'SecurityError') })
    const { result } = renderHook(useWorkspaceLayout)
    const open = result.current.membersOpen
    act(() => result.current.toggleMembers())
    expect(() => act(() => vi.advanceTimersByTime(200))).not.toThrow()
    expect(result.current.membersOpen).toBe(!open)
  })

  it('coalesces preference writes while layout changes are in progress', () => {
    vi.useFakeTimers()
    const saved = vi.spyOn(Storage.prototype, 'setItem')
    const { result } = renderHook(useWorkspaceLayout)
    for (let index = 0; index < 5; index++) {
      act(() => result.current.toggleMembers())
      act(() => vi.advanceTimersByTime(40))
    }
    expect(saved).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(150))
    expect(saved).toHaveBeenCalledTimes(1)
  })

  it('cleans up a drag when its workspace unmounts', () => {
    const { result, unmount } = renderHook(useWorkspaceLayout)
    const handle = document.createElement('div')
    act(() => result.current.beginResize('channels', { button: 0, clientX: 250, currentTarget: handle, preventDefault() {} } as unknown as Parameters<typeof result.current.beginResize>[1]))
    expect(document.body.classList.contains('is-resizing-workspace')).toBe(true)
    unmount()
    expect(document.body.classList.contains('is-resizing-workspace')).toBe(false)
  })
})
