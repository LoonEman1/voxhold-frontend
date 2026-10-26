// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { ChannelRecording } from '../domain/types'
import { RecordingPreview } from './RecordingPreview'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

it('loads a private image, replaces changed versions and releases object URLs', async () => {
  let index = 0
  vi.stubGlobal('URL', { createObjectURL: vi.fn(() => `blob:preview-${++index}`), revokeObjectURL: vi.fn() })
  const load = vi.fn<(record: ChannelRecording, signal: AbortSignal) => Promise<Blob | null>>(async () => new Blob(['jpeg'], { type: 'image/jpeg' }))
  const record = { id: 'record', status: 'ready', preview_version: 'v1' } as ChannelRecording
  const view = render(<RecordingPreview record={record} load={load}/> )
  await waitFor(() => expect(screen.getByAltText('Кадр из записи').getAttribute('src')).toBe('blob:preview-1'))
  const firstSignal = load.mock.calls[0]?.[1] as AbortSignal | undefined
  view.rerender(<RecordingPreview record={{ ...record, preview_version: 'v2' }} load={load}/> )
  await waitFor(() => expect(load).toHaveBeenCalledTimes(2))
  expect(firstSignal?.aborted).toBe(true)
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview-1')
  view.unmount()
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview-2')
})

it('keeps a placeholder when decoding or fetching a preview fails', async () => {
  render(<RecordingPreview record={{ id: 'record', status: 'ready' } as ChannelRecording} load={async () => { throw new Error('unavailable') }}/> )
  await waitFor(() => expect(screen.getByText('Без превью')).toBeTruthy())
  expect(screen.queryByAltText('Кадр из записи')).toBeNull()
})
