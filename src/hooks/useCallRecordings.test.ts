// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { ChannelRecording } from '../domain/types'
import type { VoxholdApi } from '../services/api'
import { RecordingStore } from '../services/recordingStore'
import { useCallRecordings } from './useCallRecordings'

afterEach(() => { cleanup(); vi.restoreAllMocks() })
it('refreshes a stale recording snapshot without losing a live update and still removes revoked records', async () => {
  vi.spyOn(RecordingStore, 'open').mockResolvedValue({ list: async () => [], close: vi.fn() } as unknown as RecordingStore)
  const responses: ((value: { recordings: ChannelRecording[] }) => void)[] = []
  const list = vi.fn(() => new Promise<{ recordings: ChannelRecording[] }>((resolve) => { responses.push(resolve) }))
  const api = { recordings: { list } } as unknown as VoxholdApi
  const notify = vi.fn(), voiceMedia = { current: null }
  const { result } = renderHook(() => useCallRecordings({ api, token: 'test', scope: 'test', serverId: 1, voice: null, voiceMedia, stream: null, notify }))
  const record: ChannelRecording = { id: 'new-live-recording', server_id: 1, channel_id: 2, owner_user_id: 3, owner_username: 'Alice',
    status: 'ready', mime_type: 'video/webm', size_bytes: 100, duration_ms: 1000, created_at: 1, updated_at: 2, expires_at: Math.floor(Date.now() / 1000) + 3600 }
  act(() => result.current.merge(record))
  await act(async () => { responses[0]!({ recordings: [] }) })
  expect(result.current.records).toEqual([record])
  expect(list).toHaveBeenCalledTimes(2)
  await act(async () => { responses[1]!({ recordings: [record] }) })
  expect(result.current.records).toEqual([record])
  act(() => result.current.retry())
  await act(async () => { responses[2]!({ recordings: [] }) })
  expect(result.current.records).toEqual([])
})
