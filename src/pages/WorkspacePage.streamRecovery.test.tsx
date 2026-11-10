// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Profiler, type ReactNode } from 'react'
import type { ActiveStream } from '../domain/types'
import { createApi } from '../services/api'
import { WorkspacePage } from './WorkspacePage'

const fixture = vi.hoisted(() => ({
  callbacks: {} as Record<string, (...args: never[]) => unknown>,
  viewers: [] as { onRequestRewatch: () => void; onICECandidate: (candidate: object) => void; close: () => void }[],
  watch: vi.fn(), leave: vi.fn(), publish: vi.fn(), capture: vi.fn(), joinVoice: vi.fn(), notify: vi.fn(), expire: vi.fn(),
  auth: { user: { id: 1, username: 'viewer', created_at: 1 }, token: 'fixture' },
}))
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ ...fixture.auth, expire: fixture.expire }) }))
vi.mock('../components/Toast', () => ({ useToast: () => fixture.notify }))
vi.mock('../theme/ThemeContext', () => ({ useTheme: () => ({ theme: 'dark', toggleTheme: vi.fn() }) }))
vi.mock('../components/PersistentStreamPlayer', () => ({ PersistentStreamPlayer: () => null }))
vi.mock('../components/StreamSettingsDialog', () => ({ StreamSettingsDialog: (props: { onStart: () => void; onClose: () => void }) => <><button onClick={props.onStart}>Start fixture</button><button onClick={props.onClose}>Cancel fixture</button></> }))
vi.mock('../components/VoicePanel', () => ({ VoicePanel: (props: { onJoin: () => void; onOpenStreamSettings: () => void; onWatchStream: (publisherId?: string) => void; streamList?: ActiveStream[]; connectionStatus: string; streamStatus: string; streamError: string; chat?: ReactNode }) => <>
  <button onClick={props.onOpenStreamSettings}>Share fixture</button>
  <button onClick={props.onJoin}>Join fixture</button><button onClick={() => props.onWatchStream()}>Watch fixture</button>{props.streamList?.map((item) => <button key={item.publisher_connection_id} onClick={() => props.onWatchStream(item.publisher_connection_id)}>Watch {item.publisher_connection_id}</button>)}
  <output data-testid="voice-state">{props.connectionStatus}</output><output data-testid="stream-state">{props.streamStatus}</output><output data-testid="stream-error">{props.streamError}</output>
  {props.chat}
</> }))
vi.mock('../services/voiceInput', () => ({ BrowserVoiceInput: class { isHealthy = true; close() {} } }))
vi.mock('../services/voiceEnvironment', async (original) => ({ ...await original<object>(), voiceSupported: () => true }))
vi.mock('../services/voice', async (original) => ({ ...await original<object>(), BrowserVoiceSession: class {
  static supported() { return true }
  constructor(private options: { onConnectionStateChange: (state: string) => void }) {}
  async start() { setTimeout(() => this.options.onConnectionStateChange('connected'), 0) }
  setSelfState() {} setParticipantState() {} setUserVolume() {} setPreferences() {} close() {} resumeAudio() {}
  recordingAudioTracks() { return [] } subscribeRecordingAudio() { return () => {} }
} }))
vi.mock('../services/screenCapture', async (original) => ({ ...await original<object>(), captureScreen: fixture.capture }))
vi.mock('../services/hdrPipeline', async (original) => ({ ...await original<object>(), createSDRPublishPipeline: async (media: MediaStream) => ({ stream: media, close() {} }) }))
vi.mock('../services/streamAudioGain', () => ({ StreamAudioGain: class { constructor(public stream: MediaStream) {} async resume() {} close() {} } }))
vi.mock('../services/stream', async (original) => ({ ...await original<object>(), supportedStreamCodecs: () => ['vp9'], selectedStreamCodec: () => 'vp9', BrowserServerStreamSession: class {
  close = vi.fn()
  constructor(options: typeof fixture.viewers[number]) { fixture.viewers.push({ ...options, close: this.close }) }
} }))
vi.mock('../services/realtime', () => ({ RealtimeClient: class {
  constructor(options: typeof fixture.callbacks) { fixture.callbacks = options }
  connect() { (fixture.callbacks.onStateChange as unknown as (state: string) => void)('online') }
  close() {} subscribe() {} unsubscribe() {}
  joinVoice() { fixture.joinVoice(); return 'voice-join' }
  leaveVoice() { return 'voice-leave' }
  watchStream(...args: unknown[]) { return fixture.watch(...args) }
  leaveStream() { return fixture.leave() }
  startStream(...args: unknown[]) { return fixture.publish(...args) }
  stopStream() { return 'stop-1' }
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
  else if (request.path.endsWith('/members') || request.path.endsWith('/notification-counts')) data = []
  else if (request.path.endsWith('/recordings')) data = { recordings: [] }
  else if (request.path.includes('/messages/sync')) data = { messages: [], deleted_ids: [], cursor: 0, reset: false, has_more: false, has_older: false }
  else if (request.path.endsWith('/pins')) data = []
  else if (request.path.endsWith('/webrtc/config')) data = { ice_servers: [], ice_transport_policy: 'all' }
  return { status: 200, data: data as T }
} })

beforeEach(() => {
  localStorage.clear(); fixture.viewers.length = 0
  fixture.joinVoice.mockClear()
  fixture.capture.mockReset(); fixture.publish.mockReset().mockReturnValue('publish-1')
  fixture.watch.mockReset().mockReturnValueOnce('watch-1').mockReturnValue('watch-2')
  fixture.leave.mockReset().mockReturnValue('rewatch-leave')
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

async function startViewer(multipleStreams = false) {
  render(<WorkspacePage api={api}/>)
  await screen.findByRole('button', { name: 'Join fixture' })
  act(() => emit('onReady', { multipleStreams }))
  act(() => emit('onStreamSnapshot', { streams: [stream] }))
  fireEvent.click(screen.getByRole('button', { name: 'Join fixture' }))
  await waitFor(() => expect(screen.getByTestId('voice-state').textContent).toBe('connected'))
  fireEvent.click(screen.getByRole('button', { name: 'Watch fixture' }))
  await waitFor(() => expect(fixture.watch).toHaveBeenCalledOnce())
}

it('keeps the share action while viewing and preserves playback when the picker is cancelled', async () => {
  await startViewer(true)
  expect(screen.getByRole('button', { name: 'Поделиться экраном в voice' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Share fixture' }))
  await screen.findByRole('button', { name: 'Start fixture' })
  fixture.capture.mockRejectedValue(new DOMException('Cancelled', 'NotAllowedError'))
  fireEvent.click(screen.getByRole('button', { name: 'Start fixture' }))
  await waitFor(() => expect(fixture.capture).toHaveBeenCalledOnce())
  await act(async () => undefined)
  expect(fixture.leave).not.toHaveBeenCalled()
  expect(fixture.viewers[0]!.close).not.toHaveBeenCalled()
  expect(fixture.publish).not.toHaveBeenCalled()
  expect(screen.getByTestId('stream-error').textContent).toBe('')
})

it('replaces only our viewer after capture confirmation and ignores its late leave acknowledgement', async () => {
  await startViewer(true)
  const track = { stop: vi.fn(), getSettings: () => ({ displaySurface: 'browser' }), addEventListener: vi.fn() }
  const capture = { getTracks: () => [track], getVideoTracks: () => [track], getAudioTracks: () => [] } as unknown as MediaStream
  fixture.capture.mockResolvedValue(capture)
  fireEvent.click(screen.getByRole('button', { name: 'Share fixture' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Start fixture' }))
  await waitFor(() => expect(fixture.publish).toHaveBeenCalledOnce())
  expect(fixture.leave).toHaveBeenCalledOnce()
  expect(fixture.viewers[0]!.close).toHaveBeenCalledOnce()
  act(() => emit('onStreamLeft', { server_id: 1, channel_id: 1, publisher_connection_id: 'publisher' }, 'rewatch-leave'))
  expect(fixture.viewers[1]!.close).not.toHaveBeenCalled()
  expect(track.stop).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: 'Watch publisher' })).toBeTruthy()
})

it.each(['voice e2ee device was revoked', 'voice permission was revoked'])('does not automatically register/rejoin after %s', async (reason) => {
  await startViewer()
  expect(fixture.joinVoice).toHaveBeenCalledOnce()
  act(() => emit('onVoiceWebRTCClosed', { reason }))
  await waitFor(() => expect(screen.getByTestId('voice-state').textContent).toBe('idle'))
  expect(fixture.joinVoice).toHaveBeenCalledOnce()
})

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

it('does not commit a Workspace render for repeated presence or identical unread counters', async () => {
  const commits = vi.fn(), unread = vi.spyOn(api.channels, 'unreadCounts')
  render(<Profiler id="workspace" onRender={commits}><WorkspacePage api={api}/></Profiler>)
  await screen.findByRole('button', { name: 'Join fixture' })
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 120)) })
  act(() => emit('onPresenceUpdated', { server_id: 1, user_id: 2, status: 'online', last_seen_at: 100 }))
  const afterOnline = commits.mock.calls.length
  act(() => emit('onPresenceUpdated', { server_id: 1, user_id: 2, status: 'online', last_seen_at: 100 }))
  expect(commits.mock.calls.length).toBe(afterOnline)
  act(() => emit('onPresenceUpdated', { server_id: 1, user_id: 2, status: 'offline', last_seen_at: 101 }))
  const afterOffline = commits.mock.calls.length
  act(() => emit('onPresenceUpdated', { server_id: 1, user_id: 2, status: 'offline', last_seen_at: 101 }))
  expect(commits.mock.calls.length).toBe(afterOffline)
  // Opposite transitions in one React batch must not be mistaken for duplicates.
  act(() => {
    emit('onPresenceUpdated', { server_id: 1, user_id: 2, status: 'online' })
    emit('onPresenceUpdated', { server_id: 1, user_id: 2, status: 'offline' })
  })
  const afterBurst = commits.mock.calls.length
  act(() => emit('onPresenceUpdated', { server_id: 1, user_id: 2, status: 'offline' }))
  expect(commits.mock.calls.length).toBe(afterBurst)
  unread.mockClear()
  act(() => window.dispatchEvent(new Event('focus')))
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 120)) })
  expect(unread).toHaveBeenCalledOnce()
  expect(await unread.mock.results[0]!.value).toEqual([])
  expect(commits.mock.calls.length).toBe(afterBurst)
})


it('does not close the watched peer when another publisher in the channel stops', async () => {
  await startViewer()
  act(() => emit('onStreamStarted', { ...stream, publisher_user_id: 3, publisher_connection_id: 'second' }))
  act(() => emit('onStreamStopped', { server_id: 1, channel_id: 1, publisher_connection_id: 'second' }))
  expect(fixture.viewers[0]!.close).not.toHaveBeenCalled()
  expect(fixture.watch).toHaveBeenCalledOnce()
})

it('switches publisher only after leave acknowledgement and ignores the previous publisher stop', async () => {
  await startViewer()
  act(() => emit('onStreamStarted', { ...stream, publisher_user_id: 3, publisher_connection_id: 'second' }))
  fireEvent.click(screen.getByRole('button', { name: 'Watch second' }))
  expect(fixture.leave).toHaveBeenCalledOnce()
  expect(fixture.watch).toHaveBeenCalledOnce()
  act(() => emit('onStreamLeft', { server_id: 1, channel_id: 1, publisher_connection_id: 'publisher' }, 'rewatch-leave'))
  await waitFor(() => expect(fixture.watch).toHaveBeenCalledTimes(2))
  expect(fixture.watch.mock.calls[1]?.[3]).toBe('second')
  act(() => emit('onStreamStopped', { server_id: 1, channel_id: 1, publisher_connection_id: 'publisher' }))
  expect(fixture.viewers[1]!.close).not.toHaveBeenCalled()
  act(() => emit('onStreamStopped', { server_id: 1, channel_id: 1, publisher_connection_id: 'second' }))
  expect(fixture.viewers[1]!.close).toHaveBeenCalledOnce()
})


it('opens an empty voice channel chat and loads history without joining voice', async () => {
  const sync = vi.spyOn(api.messages, 'sync')
  const { container } = render(<WorkspacePage api={api}/>)
  const toggle = await screen.findByRole('button', { name: /^Чат канала voice$/ })
  expect(container.querySelector('.content-header [aria-label^="Чат канала"]')).toBeNull()
  expect(toggle.getAttribute('aria-pressed')).toBe('false')
  fireEvent.click(toggle)
  expect(toggle.getAttribute('aria-pressed')).toBe('true')
  expect(container.querySelector('.voice-channel-chat')).not.toBeNull()
  await screen.findByLabelText('Сообщение в voice')
  await waitFor(() => expect(sync).toHaveBeenCalled())
  expect(fixture.joinVoice).not.toHaveBeenCalled()
  fireEvent.click(toggle)
  expect(toggle.getAttribute('aria-pressed')).toBe('false')
  expect(container.querySelector('.voice-channel-chat')).toBeNull()
  fireEvent.contextMenu(screen.getByRole('button', { name: /^voice$/ }))
  fireEvent.click(screen.getByRole('menuitem', { name: 'Открыть чат' }))
  expect(toggle.getAttribute('aria-pressed')).toBe('true')
  expect(container.querySelector('.voice-channel-chat')).not.toBeNull()
  expect(fixture.joinVoice).not.toHaveBeenCalled()
})

it('opens and closes the channel sidebar from the hamburger', async () => {
  const { container } = render(<WorkspacePage api={api}/>)
  const menu = await screen.findByRole('button', { name: 'Меню' })
  const sidebar = container.querySelector('#workspace-channel-sidebar')!
  expect(menu.getAttribute('aria-expanded')).toBe('false')
  expect(sidebar.classList.contains('is-mobile-open')).toBe(false)
  fireEvent.click(menu)
  expect(menu.getAttribute('aria-expanded')).toBe('true')
  expect(sidebar.classList.contains('is-mobile-open')).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Закрыть меню' }))
  expect(menu.getAttribute('aria-expanded')).toBe('false')
  expect(sidebar.classList.contains('is-mobile-open')).toBe(false)
})
