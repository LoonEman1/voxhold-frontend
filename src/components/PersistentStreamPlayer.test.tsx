// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ActiveStream } from '../domain/types'
import { DEFAULT_STREAM_PREFERENCES } from '../services/streamSettings'
import { CINEMA_IDLE_MS, PersistentStreamPlayer } from './PersistentStreamPlayer'

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
  it.each(['mini', 'expanded'] as const)('preserves %s playback when the workspace rerenders for voice state changes', async (mode) => {
    const media = {} as MediaStream
    const props = {
      mode, stream, role: 'viewer' as const, status: 'connected' as const,
      media, channelName: 'Общий', preferences: DEFAULT_STREAM_PREFERENCES,
      onPreferencesChange: vi.fn(), onExpand: vi.fn(), onCollapse: vi.fn(), onLeave: vi.fn(),
    }
    const { container, rerender } = render(<PersistentStreamPlayer {...props}/>)
    await act(async () => undefined)
    const video = container.querySelector('video')!
    const play = vi.mocked(HTMLMediaElement.prototype.play)
    play.mockClear()
    const attachments: unknown[] = []
    Object.defineProperty(video, 'srcObject', {
      configurable: true,
      get: () => media,
      set: (value) => { attachments.push(value) },
    })

    for (let index = 0; index < 6; index += 1) {
      rerender(<PersistentStreamPlayer {...props} onLeave={() => props.onLeave()}/> )
    }

    expect(container.querySelector('video')).toBe(video)
    expect(attachments).toEqual([])
    expect(play).not.toHaveBeenCalled()
  })

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

describe('PersistentStreamPlayer cinema mode', () => {
  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', {
      configurable: true,
      value: vi.fn().mockResolvedValue(undefined),
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    Reflect.deleteProperty(HTMLElement.prototype, 'requestFullscreen')
  })

  function renderExpanded(startInCinema: boolean) {
    render(<PersistentStreamPlayer
      mode="expanded"
      stream={stream}
      role="viewer"
      status="connected"
      media={{} as MediaStream}
      channelName="Общий"
      preferences={DEFAULT_STREAM_PREFERENCES}
      startInCinema={startInCinema}
      onPreferencesChange={vi.fn()}
      onExpand={vi.fn()}
      onCollapse={vi.fn()}
      onLeave={vi.fn()}
    />)
    return screen.getByRole('dialog')
  }

  it('opens straight in fullscreen and leaves only the picture after a pause', () => {
    vi.useFakeTimers()
    const dialog = renderExpanded(true)

    expect(HTMLElement.prototype.requestFullscreen).toHaveBeenCalledOnce()
    expect(dialog.classList.contains('is-ui-hidden')).toBe(true)
    expect(screen.getByRole('button', { name: 'Выйти из полного экрана' })).toBeTruthy()
    expect(dialog.classList.contains('is-idle')).toBe(false)

    act(() => { vi.advanceTimersByTime(CINEMA_IDLE_MS + 100) })
    expect(dialog.classList.contains('is-idle')).toBe(true)

    fireEvent.pointerMove(dialog)
    expect(dialog.classList.contains('is-idle')).toBe(false)
  })

  it('resets the hover guard when cinema controls are unmounted', () => {
    vi.useFakeTimers()
    const dialog = renderExpanded(true)
    fireEvent.pointerEnter(dialog.querySelector('.stream-cinema-controls')!)
    fireEvent.click(screen.getByRole('button', { name: 'Выйти из полного экрана' }))
    fireEvent.click(screen.getByRole('button', { name: 'Полный экран' }))
    act(() => { vi.advanceTimersByTime(CINEMA_IDLE_MS + 100) })
    expect(dialog.classList.contains('is-idle')).toBe(true)
  })

  it('toggles fullscreen with the F key', () => {
    const dialog = renderExpanded(false)

    fireEvent.keyDown(window, { code: 'KeyF', key: 'f' })
    expect(dialog.classList.contains('is-ui-hidden')).toBe(true)

    fireEvent.keyDown(window, { code: 'KeyF', key: 'f' })
    expect(dialog.classList.contains('is-ui-hidden')).toBe(false)
  })
})

it.each(['mini', 'expanded'] as const)('lets the publisher toggle stream audio in the %s player', (mode) => {
  const onToggleAudio = vi.fn()
  const props = { mode, stream, role: 'publisher' as const, status: 'connected' as const,
    media: {} as MediaStream, channelName: 'Общий', preferences: DEFAULT_STREAM_PREFERENCES,
    onPreferencesChange: vi.fn(), onExpand: vi.fn(), onCollapse: vi.fn(), onLeave: vi.fn() }
  const { rerender } = render(<PersistentStreamPlayer {...props} audioMuted={false} onToggleAudio={onToggleAudio}/>)
  fireEvent.click(screen.getByRole('button', { name: 'Выключить звук трансляции' }))
  expect(onToggleAudio).toHaveBeenCalledOnce()
  rerender(<PersistentStreamPlayer {...props} audioMuted onToggleAudio={onToggleAudio}/>)
  expect(screen.getByRole('button', { name: 'Включить звук трансляции' }).getAttribute('aria-pressed')).toBe('true')
})
