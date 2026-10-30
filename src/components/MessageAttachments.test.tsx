// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { MessageAttachments } from './MessageAttachments'

const context = vi.hoisted(() => ({ token: 'session', api: { community: { content: vi.fn() } } }))
vi.mock('./Community', () => ({ useCommunity: () => context }))
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); context.api.community.content.mockReset() })
it('downloads SVG as an inert file without rendering an image', async () => {
  const create = vi.fn(() => 'blob:safe')
  vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: vi.fn() })
  context.api.community.content.mockResolvedValue(new Blob(['<svg/>'], { type: 'image/svg+xml' }))
  const { container } = render(<MessageAttachments attachments={[{ id: 'file', filename: 'active.svg', mime_type: 'image/svg+xml', size_bytes: 6, deleted: false }]}/>)
  expect(container.querySelector('img')).toBeNull()
  fireEvent.click(screen.getByText(/Загрузить файл/))
  await waitFor(() => expect(create).toHaveBeenCalledOnce())
  expect((create.mock.calls as unknown as Array<[Blob]>)[0]![0].type).toBe('application/octet-stream')
  expect(container.querySelector('img')).toBeNull()
})
