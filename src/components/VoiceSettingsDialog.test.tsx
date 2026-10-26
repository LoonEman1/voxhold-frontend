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
