import { act, render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import type { ServerMember } from '../domain/types'
import { TypingIndicator, typingText } from './TypingIndicator'

const members = new Map<number, ServerMember>([[2, { user_id: 2, username: 'Alice' } as ServerMember], [3, { user_id: 3, username: 'Bob' } as ServerMember]])
const emit = (user_id: number, expires_at: number, channel_id = 7) => act(() => { window.dispatchEvent(new CustomEvent('voxhold:typing', { detail: { channel_id, user_id, expires_at } })) })

it('formats one, two and many typists', () => {
  expect(typingText([])).toBe('')
  expect(typingText(['A'])).toBe('A печатает…')
  expect(typingText(['A', 'B'])).toBe('A и B печатают…')
  expect(typingText(['A', 'B', 'C'])).toBe('Несколько человек печатают…')
})

it('shows typists, ignores yourself and other channels, and clears on a post', () => {
  render(<TypingIndicator channelId={7} currentUserId={1} membersById={members}/>)
  const soon = Math.floor(Date.now() / 1000) + 6
  emit(2, soon)
  expect(screen.getByRole('status').textContent).toBe('Alice печатает…')
  emit(1, soon); emit(3, soon, 8)
  expect(screen.getByRole('status').textContent).toBe('Alice печатает…')
  emit(3, soon)
  expect(screen.getByRole('status').textContent).toBe('Alice и Bob печатают…')
  emit(2, 0)
  expect(screen.getByRole('status').textContent).toBe('Bob печатает…')
})
