// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CHANNEL_SIDEBAR_WIDTH,
  MAX_CHANNEL_SIDEBAR_WIDTH,
  MIN_CHANNEL_SIDEBAR_WIDTH,
  MIN_MEMBERS_SIDEBAR_WIDTH,
  clampWorkspacePanelWidth,
} from './useWorkspaceLayout'

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
})
