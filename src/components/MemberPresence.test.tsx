// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { MemberPresence } from './MemberPresence'
afterEach(cleanup)
describe('last seen display', () => {
  it('gives online presence priority over an old timestamp', () => {
    render(<MemberPresence online lastSeenAt={1}/>)
    expect(screen.getByText('Сейчас в сети')).toBeTruthy()
    expect(screen.queryByText(/Был в сети/)).toBeNull()
  })
  it('shows a relative time and exact timestamp without inventing unknown activity', () => {
    const now = Date.UTC(2026, 9, 27, 0, 0, 0)
    const { container, rerender } = render(<MemberPresence online={false} lastSeenAt={now / 1000 - 300} now={now}/>)
    expect(screen.getByText('Был в сети 5 минут назад')).toBeTruthy()
    expect(container.querySelector('time')?.dateTime).toBe('2026-10-26T23:55:00.000Z')
    expect(container.querySelector('time')?.title).toContain('Последний раз в сети:')
    rerender(<MemberPresence online={false} lastSeenAt={null} now={now}/>)
    expect(screen.getByText('Нет данных об активности')).toBeTruthy()
  })
})
