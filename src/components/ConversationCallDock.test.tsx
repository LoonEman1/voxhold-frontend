// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { VoxholdApi } from '../services/api'
import { E2EE_VOICE_NOTICE } from '../services/e2ee/notices'
import { ConversationCallDock } from './ConversationCallDock'
import { AudioPlaybackMixer } from '../services/audioPlaybackMixer'
import { DEFAULT_VOICE_PREFERENCES, saveVoicePreferences } from '../services/voiceSettings'

const calls = vi.hoisted(() => [] as Array<{ close: ReturnType<typeof vi.fn>; token: () => string }>)
const started = vi.hoisted(() => ({ members: [] as unknown[], encrypted: false, media: null as MediaStream | null }))
vi.mock('../services/conversationCall', () => ({ ConversationCall: class {
  close = vi.fn()
  constructor(_api: unknown, public token: () => string, _cid: number, _uid: number, private callbacks: { state: (value: unknown, encrypted: boolean) => void; media: (id: number, stream: MediaStream) => void }) { calls.push(this) }
  async start() { this.callbacks.state({ conversation_id: 1, revision: 1, members: started.members }, started.encrypted); if (started.media) this.callbacks.media(2, started.media) }
} }))
afterEach(() => { cleanup(); calls.length = 0; started.members = []; started.encrypted = false; started.media = null; vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('applies shared speaker-volume changes to an existing personal call immediately', async () => {
  class Stream {
    constructor(private tracks: unknown[] = []) {}
    getTracks() { return this.tracks }
    getAudioTracks() { return this.tracks }
    getVideoTracks() { return [] }
  }
  vi.stubGlobal('MediaStream', Stream)
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined)
  const mix = vi.spyOn(AudioPlaybackMixer.prototype, 'setVolume').mockImplementation((audio, stream, gain) => { audio.srcObject = stream; audio.volume = Math.min(1, gain) })
  saveVoicePreferences(DEFAULT_VOICE_PREFERENCES)
  started.media = new Stream([{}]) as unknown as MediaStream
  render(<ConversationCallDock api={{} as VoxholdApi} token="token" userId={1}/>)
  await act(async () => { window.dispatchEvent(new CustomEvent('voxhold:start-conversation-call', { detail: 1 })) })
  expect(mix).toHaveBeenLastCalledWith(expect.any(HTMLAudioElement), expect.any(Stream), 1)
  act(() => saveVoicePreferences({ ...DEFAULT_VOICE_PREFERENCES, outputVolume: 200 }))
  expect(mix).toHaveBeenLastCalledWith(expect.any(HTMLAudioElement), expect.any(Stream), 2)
  expect(calls).toHaveLength(1)
  expect(calls[0]!.close).not.toHaveBeenCalled()
})
it('preserves a live call across token rotation and clears it on account change', async () => {
  const api = {} as VoxholdApi
  const view = render(<ConversationCallDock api={api} token="old" userId={1}/>)
  await act(async () => { window.dispatchEvent(new CustomEvent('voxhold:start-conversation-call', { detail: 1 })) })
  expect(screen.getByLabelText('Звонок в беседе')).toBeTruthy()
  view.rerender(<ConversationCallDock api={api} token="new" userId={1}/>)
  expect(calls).toHaveLength(1)
  expect(calls[0]!.close).not.toHaveBeenCalled()
  expect(calls[0]!.token()).toBe('new')
  view.rerender(<ConversationCallDock api={api} token="account-two" userId={2}/>)
  expect(calls[0]!.close).toHaveBeenCalledOnce()
  expect(screen.queryByLabelText('Звонок в беседе')).toBeNull()
})

it.each([false, true])('shows the lock only when this client encrypts (encrypted: %s)', async (encrypted) => {
  // Members advertise devices either way: that part is written by the server.
  started.members = [{ user_id: 1, username: 'me', session_id: 'a', e2ee_device_id: 'a'.repeat(32) }, { user_id: 2, username: 'peer', session_id: 'b', e2ee_device_id: 'b'.repeat(32) }]
  started.encrypted = encrypted
  render(<ConversationCallDock api={{} as VoxholdApi} token="token" userId={1}/>)
  await act(async () => { window.dispatchEvent(new CustomEvent('voxhold:start-conversation-call', { detail: 1 })) })
  expect(screen.queryByTitle(E2EE_VOICE_NOTICE) !== null).toBe(encrypted)
})
