// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RecordingsDialog } from './RecordingsDialog'
import type { ChannelRecording } from '../domain/types'
import type { LocalRecording } from '../services/recordingStore'

afterEach(() => { cleanup(); document.body.classList.remove('modal-open') })

const now = Math.floor(Date.now() / 1000)
const record = (id: string, patch: Partial<ChannelRecording> = {}): ChannelRecording => ({ id, server_id: 1, channel_id: 7, owner_user_id: 2, owner_username: 'Мария', status: 'ready', mime_type: 'video/webm', size_bytes: 1024, duration_ms: 90_000, created_at: now, updated_at: 0, expires_at: now + 3600, ...patch })
const local = (value: ChannelRecording, patch: Partial<LocalRecording> = {}): LocalRecording => ({ key: `scope:${value.id}`, scope: 'scope', record: value, bytes: 2048, chunks: 1, duration: 90_000, finished: true, ...patch })
const renderDialog = (records: ChannelRecording[], locals: LocalRecording[], onRemoveLocal = vi.fn(async () => undefined)) => render(<RecordingsDialog open onClose={vi.fn()} records={records} locals={locals} serverId={1} progress={{}} voiceActive={false} onDownload={vi.fn(async () => undefined)} onRemoveLocal={onRemoveLocal} onRetry={vi.fn()}/>)

describe('recordings list', () => {
  it('hides other members\' records that have nothing to download', () => {
    renderDialog([record('a'.repeat(32), { status: 'local_only' }), record('b'.repeat(32), { status: 'uploading' })], [])
    expect(screen.getAllByRole('article')).toHaveLength(1)
    expect(screen.getByText('Загружается на сервер')).toBeTruthy()
    expect(screen.getByText(/1:30/)).toBeTruthy()
  })

  it('asks before removing a local copy whose server copy has expired', () => {
    const onRemoveLocal = vi.fn(async () => undefined)
    const expired = record('c'.repeat(32), { expires_at: now - 10 })
    renderDialog([], [local(expired)], onRemoveLocal)
    expect(screen.getByText('Срок серверной копии истёк · в этом браузере')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Удалить локальную' }))
    expect(onRemoveLocal).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Удалить единственную копию?' }))
    expect(onRemoveLocal).toHaveBeenCalledWith(expired.id)
  })

  it('lets an interrupted entry without data be removed', () => {
    const interrupted = record('d'.repeat(32), { status: 'failed' })
    renderDialog([interrupted], [local(interrupted, { bytes: 0, chunks: 0, finished: false })])
    expect(screen.getByText('Запись прервана до появления данных')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Скачать' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByRole('button', { name: 'Удалить локальную' })).toBeTruthy()
  })
})
