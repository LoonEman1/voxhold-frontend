// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ActiveStream } from '../domain/types'
import { createApi } from '../services/api'
import { WorkspacePage } from './WorkspacePage'

const fixture = vi.hoisted(() => ({
  callbacks: {} as Record<string, (...args: never[]) => unknown>,
  viewers: [] as { onRequestRewatch: () => void; onICECandidate: (candidate: object) => void; close: () => void }[],
  watch: vi.fn(), leave: vi.fn(), notify: vi.fn(), expire: vi.fn(),
  auth: { user: { id: 1, username: 'viewer', created_at: 1 }, token: 'fixture' },
}))
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ ...fixture.auth, expire: fixture.expire }) }))
vi.mock('../components/Toast', () => ({ useToast: () => fixture.notify }))
vi.mock('../theme/ThemeContext', () => ({ useTheme: () => ({ theme: 'dark', toggleTheme: vi.fn() }) }))
vi.mock('../components/PersistentStreamPlayer', () => ({ PersistentStreamPlayer: () => null }))
vi.mock('../components/VoicePanel', () => ({ VoicePanel: (props: { onJoin: () => void; onWatchStream: () => void; connectionStatus: string; streamStatus: string; streamError: string }) => <>
  <button onClick={props.onJoin}>Join fixture</button><button onClick={props.onWatchStream}>Watch fixture</button>
  <output data-testid="voice-state">{props.connectionStatus}</output><output data-testid="stream-state">{props.streamStatus}</output><output data-testid="stream-error">{props.streamError}</output>
</> }))
vi.mock('../services/voiceInput', () => ({ BrowserVoiceInput: class { isHealthy = true; close() {} } }))
vi.mock('../services/voice', async (original) => ({ ...await original<object>(), BrowserVoiceSession: class {
  static supported() { return true }
  constructor(private options: { onConnectionStateChange: (state: string) => void }) {}
  async start() { setTimeout(() => this.options.onConnectionStateChange('connected'), 0) }
  setSelfState() {} setParticipantState() {} setUserVolume() {} setPreferences() {} close() {} resumeAudio() {}
  recordingAudioTracks() { return [] } subscribeRecordingAudio() { return () => {} }
} }))
vi.mock('../services/stream', async (original) => ({ ...await original<object>(), supportedStreamCodecs: () => ['vp9'], BrowserServerStreamSession: class {
  close = vi.fn()
  constructor(options: typeof fixture.viewers[number]) { fixture.viewers.push({ ...options, close: this.close }) }
} }))
vi.mock('../services/realtime', () => ({ RealtimeClient: class {
  constructor(options: typeof fixture.callbacks) { fixture.callbacks = options }
  connect() { (fixture.callbacks.onStateChange as unknown as (state: string) => void)('online') }
  close() {} subscribe() {} unsubscribe() {}
  joinVoice() { return 'voice-join' }
  leaveVoice() { return 'voice-leave' }
  watchStream() { return fixture.watch() }
  leaveStream() { return fixture.leave() }
  sendStreamICECandidate() { return 'old-media' }
} }))

const stream: ActiveStream = { server_id: 1, channel_id: 1, publisher_user_id: 2, publisher_connection_id: 'publisher', mode: 'server', codec: 'vp9', has_audio: true, viewer_count: 1 }
function emit(name: string, data: unknown, requestId?: string) {
  (fixture.callbacks[name] as unknown as (data: unknown, requestId?: string) => void)(data, requestId)
}
const api = createApi({ request: async <T,>(request: { path: string }) => {
  let data: unknown = {}
  if (request.path.endsWith('/me/servers')) data = [{ id: 1, name: 'Fixture', role: 'member', created_by: 2, created_at: 1, joined_at: 1 }]
  else if (request.path.endsWith('/channels')) data = [{ id: 1, server_id: 1, name: 'voice', kind: 'voice', position: 0, created_by: 2, created_at: 1 }]
  else if (request.path.endsWith('/members')) data = []
  else if (request.path.endsWith('/recordings')) data = { recordings: [] }
  else if (request.path.endsWith('/webrtc/config')) data = { ice_servers: [], ice_transport_policy: 'all' }
  return { status: 200, data: data as T }
} })

beforeEach(() => {
  localStorage.clear(); fixture.viewers.length = 0
  fixture.watch.mockReset().mockReturnValueOnce('watch-1').mockReturnValue('watch-2')
  fixture.leave.mockReset().mockReturnValue('rewatch-leave')
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

async function startViewer() {
  render(<WorkspacePage api={api}/>)
  await screen.findByRole('button', { name: 'Join fixture' })
  act(() => emit('onStreamSnapshot', { streams: [stream] }))
  fireEvent.click(screen.getByRole('button', { name: 'Join fixture' }))
  await waitFor(() => expect(screen.getByTestId('voice-state').textContent).toBe('connected'))
  fireEvent.click(screen.getByRole('button', { name: 'Watch fixture' }))
  await waitFor(() => expect(fixture.watch).toHaveBeenCalledOnce())
}

it.each(['acknowledged', 'already closed'] as const)('recreates the viewer after a leave that is %s', async (response) => {
  await startViewer()
  act(() => fixture.viewers[0]!.onICECandidate({ candidate: 'fixture' }))
  act(() => fixture.viewers[0]!.onRequestRewatch())
  expect(fixture.leave).toHaveBeenCalledOnce()
  act(() => emit('onStreamWebRTCClosed', { reason: 'stream WebRTC connection closed' }))
  if (response === 'acknowledged') act(() => emit('onStreamLeft', { server_id: 1, channel_id: 1 }, 'rewatch-leave'))
  else act(() => emit('onError', { request_id: 'rewatch-leave', code: 'invalid_state', message: 'stream is not active on this connection' }))
  await waitFor(() => expect(fixture.watch).toHaveBeenCalledTimes(2))
  expect(fixture.viewers).toHaveLength(2)
  // A queued ICE failure from the old generation must not close the new one.
  act(() => emit('onError', { request_id: 'old-media', code: 'invalid_state', message: 'stream is not active on this connection' }))
  expect(fixture.viewers[1]!.close).not.toHaveBeenCalled()
  expect(screen.getByTestId('stream-error').textContent).toBe('')
})

it('does not resume a failed leave for an unrelated permission error', async () => {
  await startViewer()
  act(() => fixture.viewers[0]!.onRequestRewatch())
  act(() => emit('onError', { request_id: 'rewatch-leave', code: 'forbidden', message: 'channel access denied' }))
  await act(async () => undefined)
  expect(fixture.watch).toHaveBeenCalledOnce()
  expect(screen.getByTestId('stream-state').textContent).toBe('idle')
})
