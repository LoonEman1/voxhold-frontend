// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { ActiveStream } from '../domain/types'
import { DEFAULT_STREAM_PREFERENCES } from '../services/streamSettings'
import { StreamPanel } from './StreamPanel'
afterEach(() => { cleanup(); vi.restoreAllMocks() })
it('keeps the publisher audio toggle on the call tile', () => {
  const stream: ActiveStream = { server_id: 1, channel_id: 2, publisher_user_id: 3,
    publisher_connection_id: 'publisher', mode: 'server', codec: 'vp9', has_audio: true, viewer_count: 1 }
  const onToggleAudio = vi.fn()
  render(<StreamPanel tile stream={stream} currentUserId={3} voiceActive status="connected" error=""
    media={null} preferences={DEFAULT_STREAM_PREFERENCES} audioMuted onToggleAudio={onToggleAudio}
    onPreferencesChange={vi.fn()} onOpenSettings={vi.fn()} onWatch={vi.fn()} onLeave={vi.fn()} onExpand={vi.fn()}/>)
  fireEvent.click(screen.getByRole('button', { name: 'Включить звук трансляции' }))
  expect(onToggleAudio).toHaveBeenCalledOnce()
})
