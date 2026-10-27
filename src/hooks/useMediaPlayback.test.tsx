// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useMediaPlayback } from './useMediaPlayback'

let callback: VideoFrameRequestCallback | null
const media = { getVideoTracks: () => [] } as unknown as MediaStream
function Player({ onRecoveryRequired, recovering = false, role = 'viewer' }: { onRecoveryRequired: () => void; recovering?: boolean; role?: 'viewer' | 'publisher' }) {
  const { videoRef, attach } = useMediaPlayback({ role, muted: true, recovering, onRecoveryRequired })
  return <><button onClick={() => attach(media)}>Start</button><video ref={videoRef}/></>
}
async function tick(ms: number) { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }
describe('stream element recovery', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
    callback = null
    vi.stubGlobal('MediaStream', class {})
    Object.defineProperty(HTMLVideoElement.prototype, 'requestVideoFrameCallback', { configurable: true, value: vi.fn((handler) => { callback = handler; return 1 }) })
    Object.defineProperty(HTMLVideoElement.prototype, 'cancelVideoFrameCallback', { configurable: true, value: vi.fn() })
  })
  afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })
  it('rebinds a frozen player once and asks for session recovery only if frames still do not return', async () => {
    const recover = vi.fn()
    const { container, unmount } = render(<Player onRecoveryRequired={recover}/>)
    fireEvent.click(container.querySelector('button')!)
    const video = container.querySelector('video')!
    const writes: unknown[] = []
    Object.defineProperty(video, 'srcObject', { configurable: true, get: () => media, set: (value) => writes.push(value) })
    await tick(10_000)
    expect(writes).toEqual([null, media])
    expect(recover).not.toHaveBeenCalled()
    await tick(20_000)
    expect(recover).toHaveBeenCalledTimes(1)
    expect(writes).toHaveLength(2)
    unmount()
    await tick(30_000)
    expect(recover).toHaveBeenCalledTimes(1)
  })
  it('keeps a static but healthy screen intact and repairs after an interruption', async () => {
    const recover = vi.fn()
    const { container, rerender } = render(<Player onRecoveryRequired={recover}/>)
    fireEvent.click(container.querySelector('button')!)
    const video = container.querySelector('video')!
    Object.defineProperties(video, { paused: { configurable: true, value: false }, readyState: { configurable: true, value: 4 } })
    act(() => callback?.(performance.now(), {} as VideoFrameCallbackMetadata))
    await tick(30_000)
    expect(recover).not.toHaveBeenCalled()
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1)
    rerender(<Player onRecoveryRequired={recover} recovering/>)
    rerender(<Player onRecoveryRequired={recover} recovering={false}/>)
    await tick(2_000)
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(2)
    act(() => callback?.(performance.now(), {} as VideoFrameCallbackMetadata))
    await tick(30_000)
    expect(recover).not.toHaveBeenCalled()
  })
  it.each(['hidden', 'publisher'])('does not reconnect a %s player', async (mode) => {
    const recover = vi.fn()
    if (mode === 'hidden') Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
    const { container } = render(<Player onRecoveryRequired={recover} role={mode === 'publisher' ? 'publisher' : 'viewer'}/>)
    fireEvent.click(container.querySelector('button')!)
    await tick(60_000)
    expect(recover).not.toHaveBeenCalled()
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1)
  })
})
