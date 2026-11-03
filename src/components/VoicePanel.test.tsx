// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import type { ActiveStream, Channel, ServerMember } from '../domain/types'
import { E2EE_STREAM_NOTICE, E2EE_VOICE_NOTICE } from '../services/e2ee/notices'
import { DEFAULT_STREAM_PREFERENCES } from '../services/streamSettings'
import { VoicePanel } from './VoicePanel'

vi.mock('./StreamPanel', () => ({ StreamPanel: () => null }))
afterEach(cleanup)

const channel = { id: 8, server_id: 3, name: 'Голос', kind: 'voice', position: 0, created_by: 1, created_at: 1, e2ee_required: true } as Channel

function props(overrides: Partial<ComponentProps<typeof VoicePanel>> = {}): ComponentProps<typeof VoicePanel> {
  return {
    channel, activeChannel: { id: 8, name: 'Голос' }, participants: [], members: [], currentUserId: 1,
    connectionStatus: 'connected', realtimeOnline: true, selfMute: false, selfDeaf: false, error: '',
    onJoin: vi.fn(async () => undefined), onLeave: vi.fn(), onToggleMute: vi.fn(), onToggleDeaf: vi.fn(), onOpenProfile: vi.fn(),
    stream: null, streamStatus: 'idle', streamError: '', streamMedia: null, streamPreferences: DEFAULT_STREAM_PREFERENCES,
    onStreamPreferencesChange: vi.fn(), onOpenStreamSettings: vi.fn(), onWatchStream: vi.fn(), onLeaveStream: vi.fn(), onExpandStream: vi.fn(),
    ...overrides,
  }
}

it('shows the encryption badge, the notice and key-change warnings in an encrypted channel', () => {
  render(<VoicePanel {...props({ encryption: { active: true, changedKeyNames: ['Alice'] } })}/>)
  expect(screen.getByText('Сквозное шифрование')).toBeInTheDocument()
  expect(screen.getByText(E2EE_VOICE_NOTICE)).toBeInTheDocument()
  expect(screen.getByRole('alert')).toHaveTextContent('Ключ устройства Alice изменился')
  expect(screen.queryByText(E2EE_STREAM_NOTICE)).toBeNull()
})

it('warns that a stream is not end-to-end encrypted and hides the call notice outside the call', () => {
  const stream = { server_id: 3, channel_id: 8, publisher_user_id: 2, publisher_connection_id: 'c2', mode: 'server', codec: 'vp9', has_audio: true, viewer_count: 1 } as ActiveStream
  render(<VoicePanel {...props({ activeChannel: null, stream, encryption: { active: true, changedKeyNames: ['Alice'] } })}/>)
  expect(screen.getByText(E2EE_STREAM_NOTICE)).toBeInTheDocument()
  expect(screen.queryByText(E2EE_VOICE_NOTICE)).toBeNull()
  expect(screen.queryByRole('alert')).toBeNull()
})

it('shows nothing about encryption in a plain channel', () => {
  render(<VoicePanel {...props({ channel: { ...channel, e2ee_required: false } })}/>)
  expect(screen.queryByText('Сквозное шифрование')).toBeNull()
  expect(screen.queryByText(E2EE_VOICE_NOTICE)).toBeNull()
})

it('replaces a participant card with their camera and name, then restores the card on stop', () => {
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined)
  const camera = {} as MediaStream
  const participant = { connection_id: 'alice', user_id: 2, server_id: 3, channel_id: 8, self_mute: false, self_deaf: false, self_video: true }
  const value = props({ participants: [participant], members: [{ user_id: 2, username: 'Alice', role: 'member' } as ServerMember], cameras: { alice: camera } })
  const view = render(<VoicePanel {...value}/>)
  expect(view.container.querySelector('.voice-participant')).toBeNull()
  expect(screen.getByText('Alice')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Развернуть камеру: Alice' }))
  expect(screen.getByRole('dialog', { name: 'Камера · Alice' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }))
  view.rerender(<VoicePanel {...value} participants={[{ ...participant, self_video: false }]}/>)
  expect(view.container.querySelector('.voice-participant')).not.toBeNull()
  expect(screen.queryByRole('button', { name: 'Развернуть камеру: Alice' })).toBeNull()
  vi.restoreAllMocks()
})
