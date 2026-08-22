// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ActiveStream } from '../domain/types'
import { DEFAULT_STREAM_PREFERENCES } from '../services/streamSettings'
import { PersistentStreamPlayer } from './PersistentStreamPlayer'

const stream: ActiveStream = {
  server_id: 1,
  channel_id: 2,
  publisher_user_id: 3,
  publisher_connection_id: 'publisher',
  mode: 'server',
  codec: 'vp9',
  has_audio: true,
  viewer_count: 4,
}

beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function renderPlayer(mode: 'mini' | 'expanded') {
  const handlers = {
    onPreferencesChange: vi.fn(),
    onExpand: vi.fn(),
    onCollapse: vi.fn(),
    onLeave: vi.fn(),
  }
  render(<PersistentStreamPlayer
    mode={mode}
    stream={stream}
    role="viewer"
    status="connected"
    media={{} as MediaStream}
    channelName="Общий"
    preferences={DEFAULT_STREAM_PREFERENCES}
    {...handlers}
  />)
  return handlers
}

describe('PersistentStreamPlayer', () => {
  it('expands and leaves from the mini player', () => {
    const handlers = renderPlayer('mini')

    fireEvent.click(screen.getByTitle('Открыть трансляцию на весь экран'))
    fireEvent.click(screen.getByRole('button', { name: 'Перестать смотреть' }))

    expect(handlers.onExpand).toHaveBeenCalledOnce()
    expect(handlers.onLeave).toHaveBeenCalledOnce()
  })

  it('collapses on Escape and changes playback volume', () => {
    const handlers = renderPlayer('expanded')

    fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.change(screen.getByRole('slider'), { target: { value: '42' } })

    expect(handlers.onCollapse).toHaveBeenCalledOnce()
    expect(handlers.onPreferencesChange).toHaveBeenCalledWith({
      ...DEFAULT_STREAM_PREFERENCES,
      playbackVolume: 42,
    })
  })

  it('hides the interface and restores it before collapsing on Escape', () => {
    const handlers = renderPlayer('expanded')
    const requestFullscreen = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(screen.getByRole('dialog'), 'requestFullscreen', {
      configurable: true,
      value: requestFullscreen,
    })

    fireEvent.click(screen.getByRole('button', { name: 'Полный экран' }))
    expect(screen.getByRole('dialog').classList.contains('is-ui-hidden')).toBe(true)
    expect(requestFullscreen).toHaveBeenCalledOnce()

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.getByRole('dialog').classList.contains('is-ui-hidden')).toBe(false)
    expect(handlers.onCollapse).not.toHaveBeenCalled()

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(handlers.onCollapse).toHaveBeenCalledOnce()
  })
})
