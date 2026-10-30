// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { MessageAttachments } from './MessageAttachments'

const context = vi.hoisted(() => ({ token: 'session', api: { community: { content: vi.fn(), thumbnail: vi.fn(), attachmentStatus: vi.fn() } } }))
vi.mock('./Community', () => ({ useCommunity: () => context }))
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); context.api.community.content.mockReset(); context.api.community.thumbnail.mockReset(); context.api.community.attachmentStatus.mockReset() })
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

it('loads only an intersecting thumbnail and ignores other-scope changes', async () => {
  let intersect!: IntersectionObserverCallback
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: IntersectionObserverCallback) { intersect = callback }
    observe() {} disconnect() {}
  })
  vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:preview'), revokeObjectURL: vi.fn() })
  context.api.community.thumbnail.mockResolvedValue(new Blob(['jpeg'], { type: 'image/jpeg' }))
  context.api.community.attachmentStatus.mockResolvedValue(undefined)
  render(<MessageAttachments channelId={2} attachments={[{ id: 'image', filename: 'image.png', mime_type: 'image/png', size_bytes: 1000, deleted: false }]}/>)
  expect(context.api.community.thumbnail).not.toHaveBeenCalled()
  expect(context.api.community.content).not.toHaveBeenCalled()
  intersect([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver)
  await waitFor(() => expect(screen.getByAltText('image.png')).toBeTruthy())
  window.dispatchEvent(new CustomEvent('voxhold:attachments', { detail: { channel_id: 3 } }))
  expect(context.api.community.attachmentStatus).not.toHaveBeenCalled()
  window.dispatchEvent(new CustomEvent('voxhold:attachments', { detail: { channel_id: 2 } }))
  await waitFor(() => expect(context.api.community.attachmentStatus).toHaveBeenCalledOnce())
  expect(context.api.community.thumbnail).toHaveBeenCalledOnce()
  expect(context.api.community.content).not.toHaveBeenCalled()
  window.dispatchEvent(new CustomEvent('voxhold:attachments', { detail: { channel_id: 2, attachment_ids: ['image'] } }))
  await screen.findByText(/Вложение удалено сервером/)
})
