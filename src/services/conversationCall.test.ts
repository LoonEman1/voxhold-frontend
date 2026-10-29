import { afterEach, expect, it, vi } from 'vitest'
import { ConversationCall } from './conversationCall'
import { ApiError, type VoxholdApi } from './api'
import { captureScreen } from './stream'
vi.mock('./stream', () => ({ captureScreen: vi.fn() }))
import type { CallState } from '../domain/community'

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); vi.clearAllMocks() })

it('keeps a newer membership event when the initial HTTP snapshot arrives late', async () => {
  const close = vi.fn(), stop = vi.fn(), state = vi.fn()
  vi.stubGlobal('RTCPeerConnection', class {
    close = close
    addTrack() {}
  })
  vi.stubGlobal('MediaStream', class {})
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop }] }) } })
  let complete!: (state: CallState) => void
  const response = new Promise<CallState>((resolve) => { complete = resolve })
  const request = vi.fn((_token: string, _path: string, method: string) => method === 'PUT' ? response : Promise.resolve({}))
  const api = { community: { request }, webrtc: { config: async () => ({ ice_servers: [] }) } } as unknown as VoxholdApi
  const call = new ConversationCall(api, 'token', 7, 1, { state, media: vi.fn(), removed: vi.fn(), error: vi.fn(), screen: vi.fn(), ended: vi.fn() })
  const starting = call.start()
  await vi.waitFor(() => expect(request).toHaveBeenCalledWith('token', '/conversations/7/call', 'PUT', expect.anything()))
  const mine = { user_id: 1, username: 'owner', session_id: call.sessionId }
  const latest = { conversation_id: 7, revision: 2, members: [mine, { user_id: 2, username: 'member', session_id: 'remote-session' }] }
  call.update(latest)
  complete({ conversation_id: 7, revision: 1, members: [mine] })
  await starting
  expect(state).toHaveBeenCalledTimes(1)
  expect(state).toHaveBeenLastCalledWith(latest)
  expect(close).not.toHaveBeenCalled()
  call.close()
  expect(close).toHaveBeenCalledOnce()
  expect(stop).toHaveBeenCalledOnce()
})

function isolatedCall(request: ReturnType<typeof vi.fn>) {
  const stop = vi.fn(), ended = vi.fn()
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop }] }) } })
  const api = { community: { request }, webrtc: { config: async () => ({ ice_servers: [] }) } } as unknown as VoxholdApi
  const call = new ConversationCall(api, 'token', 7, 1, { state: vi.fn(), media: vi.fn(), removed: vi.fn(), error: vi.fn(), screen: vi.fn(), ended })
  return { call, stop, ended }
}
it('does not start a heartbeat after a newer event replaces a pending join', async () => {
  vi.useFakeTimers()
  let complete!: (state: CallState) => void
  const response = new Promise<CallState>((resolve) => { complete = resolve })
  const request = vi.fn((_token: string, _path: string, method: string) => method === 'PUT' ? response : Promise.resolve({}))
  const { call, ended, stop } = isolatedCall(request)
  const starting = call.start()
  await Promise.resolve(); await Promise.resolve()
  call.update({ conversation_id: 7, revision: 2, members: [] })
  complete({ conversation_id: 7, revision: 1, members: [{ user_id: 1, username: 'owner', session_id: call.sessionId }] })
  await starting
  expect(ended).toHaveBeenCalledOnce()
  expect(stop).toHaveBeenCalledOnce()
  expect(vi.getTimerCount()).toBe(0)
})
it('removes a lease that commits after closing an in-flight join', async () => {
  vi.useFakeTimers()
  let complete!: (state: CallState) => void
  const response = new Promise<CallState>((resolve) => { complete = resolve })
  const request = vi.fn((_token: string, _path: string, method: string) => method === 'PUT' ? response : Promise.resolve({}))
  const { call, stop } = isolatedCall(request)
  const starting = call.start()
  await Promise.resolve(); await Promise.resolve()
  expect(request).toHaveBeenCalledWith('token', '/conversations/7/call', 'PUT', expect.anything())
  call.close()
  complete({ conversation_id: 7, revision: 1, members: [{ user_id: 1, username: 'owner', session_id: call.sessionId }] })
  await starting
  expect(request.mock.calls.filter((v) => v[2] === 'DELETE')).toHaveLength(2)
  expect(stop).toHaveBeenCalledOnce()
  expect(vi.getTimerCount()).toBe(0)
})
it('retries a transient heartbeat failure but closes on revoked access', async () => {
  vi.useFakeTimers()
  let attempts = 0
  const request = vi.fn(async (_token: string, _path: string, method: string) => {
    if (method !== 'PUT') return {}
    attempts++
    if (attempts === 2) throw new ApiError('temporary', 503)
    if (attempts === 4) throw new ApiError('revoked', 403)
    return { conversation_id: 7, revision: 1, members: [{ user_id: 1, username: 'owner', session_id: call.sessionId }] }
  })
  const { call, ended, stop } = isolatedCall(request)
  await call.start()
  await vi.advanceTimersByTimeAsync(12_000)
  expect(ended).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(12_000)
  expect(attempts).toBe(3)
  expect(ended).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(12_000)
  expect(ended).toHaveBeenCalledOnce()
  expect(stop).toHaveBeenCalledOnce()
  expect(vi.getTimerCount()).toBe(0)
})
it('serializes screen capture and releases a late stream after leaving', async () => {
  let complete!: (stream: MediaStream) => void
  vi.mocked(captureScreen).mockImplementation(() => new Promise<MediaStream>((resolve) => { complete = resolve }))
  const { call } = isolatedCall(vi.fn().mockResolvedValue({}))
  const capturing = call.shareScreen()
  await call.shareScreen()
  expect(captureScreen).toHaveBeenCalledOnce()
  call.close()
  const stop = vi.fn()
  complete({ getTracks: () => [{ stop }] } as unknown as MediaStream)
  await capturing
  expect(stop).toHaveBeenCalledOnce()
})
