// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { InviteAppPrompt } from './InviteAppPrompt'

afterEach(cleanup)

describe('InviteAppPrompt', () => {
  it('offers the native client without blocking the browser flow', () => {
    const onStayInBrowser = vi.fn()
    render(<InviteAppPrompt
      invite={{
        server_id: 1,
        server_name: 'Design room',
        creator_username: 'mira',
        expires_at: 0,
        max_uses: null,
        use_count: 0,
        allow_registration: true,
      }}
      nativeURL="voxhold://invite/token?server=https%3A%2F%2Fchat.example.com"
      onStayInBrowser={onStayInBrowser}
    />)

    expect(screen.getByRole('link', { name: /Открыть приложение/ }).getAttribute('href')).toBe(
      'voxhold://invite/token?server=https%3A%2F%2Fchat.example.com',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Остаться на сайте' }))
    expect(onStayInBrowser).toHaveBeenCalledOnce()
  })
})
