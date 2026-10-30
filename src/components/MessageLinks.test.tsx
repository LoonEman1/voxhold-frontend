// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { LinkText, MessageLinkPreviews } from './MessageLinks'
import { MessageAttachments } from './MessageAttachments'
import { CommunityProvider } from './Community'
import { createApi } from '../services/api'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })
it('renders safe clickable links while escaping markup', () => {
  render(<p><LinkText text={'<script>alert(1)</script> https://example.org/article.'}/></p>)
  const link = screen.getByRole('link')
  expect(link.getAttribute('href')).toBe('https://example.org/article')
  expect(link.getAttribute('rel')).toContain('noopener')
  expect(document.querySelector('script')).toBeNull()
})
it('waits for visibility before downloading images and fetching universal preview cards', async () => {
  const callbacks: IntersectionObserverCallback[] = []
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: IntersectionObserverCallback) { callbacks.push(callback) }
    observe() {} unobserve() {} disconnect() {}
  })
  const requested: string[] = []
  const api = createApi({ request: async <T,>({ path }: { path: string }) => {
    requested.push(path)
    const data = path.includes('link-preview?') ? { url: 'https://publisher.example/story', title: 'Universal article', site_name: 'Publisher', description: 'Article summary' } : path.endsWith('/thumbnail') || path.endsWith('/content') ? new Blob(['image'], { type: 'image/jpeg' }) : path.endsWith('/inbox') ? { items: [], has_more: false } : path.endsWith('/message-privacy') ? { mode: 'shared', blocked_user_ids: [] } : []
    return { status: 200, data: data as T }
  } })
  render(<CommunityProvider api={api} token="test" userId={1} serverId={1} owner members={[]} onMessage={() => undefined} onNavigate={() => undefined}>
    <MessageAttachments attachments={[{ id: 'a', filename: 'a.jpg', mime_type: 'image/jpeg', size_bytes: 100, deleted: false }]}/>
    <MessageLinkPreviews content="https://publisher.example/story#section"/>
  </CommunityProvider>)
  expect(requested.filter((p) => p.includes('/content') || p.includes('/thumbnail') || p.includes('link-preview?'))).toHaveLength(0)
  await act(async () => { for (const callback of callbacks) callback([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver) })
  await waitFor(() => expect(requested.some((p) => p.endsWith('/thumbnail'))).toBe(true))
  expect(requested.some((p) => p.endsWith('/content'))).toBe(false)
  expect((await screen.findByRole('link', { name: /Universal article/ })).getAttribute('href')).toBe('https://publisher.example/story#section')
})
