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
  localStorage.clear()
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

  it('starts compact at the bottom right and returns to the channel without stopping the stream', () => {
    const handlers = renderPlayer('expanded')
    const player = screen.getByRole('dialog')
    expect(player.style.width).toBe('360px')
    expect(player.style.height).toBe('225px')
    expect(Number.parseFloat(player.style.left) + 360).toBe(window.innerWidth - 12)
    expect(Number.parseFloat(player.style.top) + 225).toBe(window.innerHeight - 12)
    fireEvent.click(screen.getByRole('button', { name: 'Вернуться в голосовой канал' }))
    expect(handlers.onCollapse).toHaveBeenCalledOnce()
    expect(handlers.onLeave).not.toHaveBeenCalled()
  })

  it('keeps the same video when switching layouts and leaving native fullscreen with Escape', async () => {
    const props = {
      stream, role: 'viewer' as const, status: 'connected' as const, media: {} as MediaStream,
      channelName: 'Общий', preferences: DEFAULT_STREAM_PREFERENCES,
      onPreferencesChange: vi.fn(), onExpand: vi.fn(), onCollapse: vi.fn(), onLeave: vi.fn(),
    }
    const { container, rerender } = render(<PersistentStreamPlayer {...props} mode="mini"/>)
    const video = container.querySelector('video')
    fireEvent.click(screen.getByRole('button', { name: 'Полный экран' }))
    rerender(<PersistentStreamPlayer {...props} mode="expanded"/>)
    expect(container.querySelector('video')).toBe(video)
    const player = screen.getByRole('dialog')
    expect(player.classList.contains('is-ui-hidden')).toBe(true)
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null })
    fireEvent(document, new Event('fullscreenchange'))
    expect(player.classList.contains('is-ui-hidden')).toBe(false)
    expect(player.style.width).toBe('360px')
    expect(container.querySelector('video')).toBe(video)
    expect(props.onLeave).not.toHaveBeenCalled()
    Reflect.deleteProperty(document, 'fullscreenElement')
  })

  it('exits a late native fullscreen request when Escape is pressed before it completes', async () => {
    renderPlayer('expanded')
    const player = screen.getByRole('dialog')
    let finish!: () => void
    const pending = new Promise<void>((resolve) => { finish = resolve })
    Object.defineProperty(player, 'requestFullscreen', { configurable: true, value: vi.fn(() => pending) })
    const exit = vi.fn(async () => {
      Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null })
      document.dispatchEvent(new Event('fullscreenchange'))
    })
    Object.defineProperty(document, 'exitFullscreen', { configurable: true, value: exit })
    fireEvent.click(screen.getByRole('button', { name: 'Полный экран' }))
    fireEvent.keyDown(window, { key: 'Escape' })
    await act(async () => {
      Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: player })
      finish()
      await pending
    })
    expect(exit).toHaveBeenCalledOnce()
    expect(player.classList.contains('is-ui-hidden')).toBe(false)
    expect(player.style.width).toBe('360px')
    Reflect.deleteProperty(document, 'fullscreenElement')
    Reflect.deleteProperty(document, 'exitFullscreen')
  })

  it('collapses on Escape and changes playback volume', () => {
    const handlers = renderPlayer('expanded')

    fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.change(screen.getByRole('slider'), { target: { value: '42' } })

    expect(handlers.onCollapse).toHaveBeenCalledOnce()
    expect(handlers.onPreferencesChange).toHaveBeenCalledWith({
      ...DEFAULT_STREAM_PREFERENCES,
      playbackVolume: 42,
      playbackMuted: false,
    })
  })

  it('hides the interface and restores it before collapsing on Escape', async () => {
    const handlers = renderPlayer('expanded')
    const requestFullscreen = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(screen.getByRole('dialog'), 'requestFullscreen', {
      configurable: true,
      value: requestFullscreen,
    })

    fireEvent.click(screen.getByRole('button', { name: 'Полный экран' }))
    expect(screen.getByRole('dialog').classList.contains('is-ui-hidden')).toBe(true)
    expect(requestFullscreen).toHaveBeenCalledOnce()

    await act(async () => { fireEvent.keyDown(window, { key: 'Escape' }) })
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

  function renderExpanded(startInCinema: boolean, onCollapse = vi.fn()) {
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
      onCollapse={onCollapse}
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

  it('resets the hover guard when cinema controls are unmounted', async () => {
    vi.useFakeTimers()
    const dialog = renderExpanded(true)
    fireEvent.pointerEnter(dialog.querySelector('.stream-cinema-controls')!)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Выйти из полного экрана' })) })
    fireEvent.click(screen.getByRole('button', { name: 'Полный экран' }))
    act(() => { vi.advanceTimersByTime(CINEMA_IDLE_MS + 100) })
    expect(dialog.classList.contains('is-idle')).toBe(true)
  })

  it('toggles fullscreen with the F key', async () => {
    const dialog = renderExpanded(false)

    await act(async () => { fireEvent.keyDown(window, { code: 'KeyF', key: 'f' }) })
    expect(dialog.classList.contains('is-ui-hidden')).toBe(true)

    await act(async () => { fireEvent.keyDown(window, { code: 'KeyF', key: 'f' }) })
    expect(dialog.classList.contains('is-ui-hidden')).toBe(false)
  })

  it('leaves shortcuts and tab navigation to controls outside the floating player', () => {
    const collapse = vi.fn()
    const dialog = renderExpanded(false, collapse)
    const outside = document.createElement('button'); document.body.append(outside); outside.focus()
    fireEvent.keyDown(outside, { key: 'Escape' })
    fireEvent.keyDown(outside, { key: 'f', code: 'KeyF' })
    expect(collapse).not.toHaveBeenCalled()
    expect(HTMLElement.prototype.requestFullscreen).not.toHaveBeenCalled()
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    outside.dispatchEvent(tab)
    expect(tab.defaultPrevented).toBe(false)
    dialog.focus()
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(collapse).toHaveBeenCalledOnce()
    outside.remove()
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
