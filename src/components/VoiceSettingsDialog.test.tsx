// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_VOICE_PREFERENCES } from '../services/voiceSettings'
import { VoiceSettingsDialog } from './VoiceSettingsDialog'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('VoiceSettingsDialog microphone meter', () => {
  it('updates inside the dialog without rerendering the workspace, and stops sampling when closed', () => {
    vi.useFakeTimers()
    let level = 0.2
    let workspaceRenders = 0
    const getInputLevel = vi.fn(() => level)
    function Workspace({ open }: { open: boolean }) {
      workspaceRenders += 1
      return <VoiceSettingsDialog
        open={open} preferences={DEFAULT_VOICE_PREFERENCES} devices={[]}
        getInputLevel={getInputLevel} voiceActive loadingDevices={false}
        onClose={vi.fn()} onChange={vi.fn()} onRefreshDevices={vi.fn(async () => undefined)}
      />
    }
    const { rerender } = render(<Workspace open/>)
    expect(screen.getByLabelText('Уровень микрофона 20%')).toBeTruthy()
    level = 0.65
    act(() => { vi.advanceTimersByTime(180) })
    expect(screen.getByLabelText('Уровень микрофона 65%')).toBeTruthy()
    expect(workspaceRenders).toBe(1)

    rerender(<Workspace open={false}/>)
    getInputLevel.mockClear()
    act(() => { vi.advanceTimersByTime(900) })
    expect(getInputLevel).not.toHaveBeenCalled()
  })
})

it('does not start a preview meter after the dialog closes during AudioContext.resume', async () => {
  let resume!: () => void
  const pending = new Promise<void>((resolve) => { resume = resolve })
  const node = { connect: vi.fn(), gain: { value: 1 }, fftSize: 256, smoothingTimeConstant: 0, getByteTimeDomainData: vi.fn() }
  const close = vi.fn(async () => undefined), stop = vi.fn()
  class Context { state = 'suspended'; destination = {}; createMediaStreamSource = () => node; createGain = () => ({ ...node, gain: { value: 1 } }); createAnalyser = () => node; resume = () => pending; close = close }
  vi.stubGlobal('AudioContext', Context)
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop }] })) } })
  const refresh = vi.fn(async () => undefined), interval = vi.spyOn(window, 'setInterval')
  try {
    const { unmount } = render(<VoiceSettingsDialog open preferences={DEFAULT_VOICE_PREFERENCES} devices={[]} getInputLevel={() => 0} voiceActive={false} loadingDevices={false} onClose={() => undefined} onChange={() => undefined} onRefreshDevices={refresh}/>)
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    unmount(); await act(async () => { resume(); await pending })
    expect(interval).not.toHaveBeenCalled(); expect(refresh).not.toHaveBeenCalled()
    expect(stop).toHaveBeenCalledOnce(); expect(close).toHaveBeenCalledOnce()
  } finally { vi.unstubAllGlobals(); vi.restoreAllMocks() }
})
