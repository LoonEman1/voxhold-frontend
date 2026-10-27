// @vitest-environment jsdom
import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ActiveStream } from '../domain/types'
import { DEFAULT_STREAM_PREFERENCES } from '../services/streamSettings'
import { PersistentStreamPlayer } from './PersistentStreamPlayer'
import { StreamPanel } from './StreamPanel'

const stream: ActiveStream = { server_id: 1, channel_id: 2, publisher_user_id: 3, publisher_connection_id: 'publisher', mode: 'server', codec: 'vp9', has_audio: true, viewer_count: 1 }
beforeEach(() => { vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined) })
afterEach(() => { cleanup(); vi.restoreAllMocks() })

it.each(['publisher', 'viewer'] as const)('preserves %s volume across mute and player modes', (role) => {
  function Fixture() {
    const [mode, setMode] = useState<'mini' | 'expanded'>('expanded')
    const [preferences, setPreferences] = useState(DEFAULT_STREAM_PREFERENCES)
    const [muted, setMuted] = useState(false)
    return <><button onClick={() => setMode((value) => value === 'mini' ? 'expanded' : 'mini')}>Режим</button><PersistentStreamPlayer
      mode={mode} stream={stream} role={role} status="connected" media={{} as MediaStream} channelName="Общий"
      preferences={preferences} onPreferencesChange={setPreferences} audioMuted={muted} onToggleAudio={() => setMuted((value) => !value)}
      onExpand={() => {}} onCollapse={() => {}} onLeave={() => {}}/></>
  }
  render(<Fixture/>)
  fireEvent.change(screen.getByRole('slider'), { target: { value: '37' } })
  expect((screen.getByRole('slider') as HTMLInputElement).value).toBe('37')
  fireEvent.click(screen.getByRole('button', { name: 'Выключить звук трансляции' }))
  expect((screen.getByRole('slider') as HTMLInputElement).value).toBe('0')
  fireEvent.click(screen.getByRole('button', { name: 'Режим' }))
  fireEvent.click(screen.getByRole('button', { name: 'Включить звук трансляции' }))
  expect((screen.getByRole('slider') as HTMLInputElement).value).toBe('37')
  fireEvent.change(screen.getByRole('slider'), { target: { value: '0' } })
  fireEvent.click(screen.getByRole('button', { name: 'Включить звук трансляции' }))
  expect((screen.getByRole('slider') as HTMLInputElement).value).toBe('37')
})

it.each([true, false])('exposes the viewer mixer on a stream panel (tile=%s)', (tile) => {
  const change = vi.fn()
  render(<StreamPanel tile={tile} stream={stream} currentUserId={1} voiceActive status="connected" error="" media={{} as MediaStream}
    preferences={DEFAULT_STREAM_PREFERENCES} onPreferencesChange={change} onOpenSettings={() => {}} onWatch={() => {}} onLeave={() => {}} onExpand={() => {}}/>)
  fireEvent.change(screen.getByRole('slider', { name: 'Громкость трансляции' }), { target: { value: '42' } })
  expect(change).toHaveBeenLastCalledWith({ ...DEFAULT_STREAM_PREFERENCES, playbackVolume: 42, playbackMuted: false })
})
