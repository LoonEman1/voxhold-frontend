import { expect, it, vi } from 'vitest'
import type { ClientDiagnosticsCursor, StoredClientDiagnosticEvent } from '../domain/types'
import { exportClientDiagnostics } from './diagnosticExport'

it('preserves the newest-first order across export pages', async () => {
  const event = (id: number): StoredClientDiagnosticEvent => ({
    id, created_at: 100, client_timestamp_ms: 100_000, user_id: 1, username: 'owner',
    session_id: 'tab', client_version: 'test', platform: 'browser', category: 'media',
    name: 'stream_capture_ready', level: 'info', details: { label: 'тест' },
  })
  const newer = event(2), older = event(1)
  const cursor = { created_at: newer.created_at, id: newer.id }
  const list = vi.fn(async (before?: ClientDiagnosticsCursor) => before
    ? { events: [older], retention_seconds: 86400 }
    : { events: [newer], retention_seconds: 86400, next_cursor: cursor })

  const { count, blob } = await exportClientDiagnostics(list)
  expect(list.mock.calls).toEqual([[], [cursor]])
  expect(count).toBe(2)
  expect(JSON.parse(await blob.text())).toEqual({ retention_seconds: 86400, events: [newer, older] })
})
