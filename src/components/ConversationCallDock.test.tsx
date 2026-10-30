// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { VoxholdApi } from '../services/api'
import { ConversationCallDock } from './ConversationCallDock'

const calls = vi.hoisted(() => [] as Array<{ close: ReturnType<typeof vi.fn>; token: () => string }>)
vi.mock('../services/conversationCall', () => ({ ConversationCall: class {
  close = vi.fn()
  constructor(_api: unknown, public token: () => string, _cid: number, _uid: number, private callbacks: { state: (value: unknown) => void }) { calls.push(this) }
  async start() { this.callbacks.state({ conversation_id: 1, revision: 1, members: [] }) }
} }))
afterEach(() => { cleanup(); calls.length = 0 })
it('preserves a live call across token rotation and clears it on account change', async () => {
  const api = {} as VoxholdApi
  const view = render(<ConversationCallDock api={api} token="old" userId={1}/>)
  await act(async () => { window.dispatchEvent(new CustomEvent('voxhold:start-conversation-call', { detail: 1 })) })
  expect(screen.getByLabelText('Звонок в беседе')).toBeTruthy()
  view.rerender(<ConversationCallDock api={api} token="new" userId={1}/>)
  expect(calls).toHaveLength(1)
  expect(calls[0]!.close).not.toHaveBeenCalled()
  expect(calls[0]!.token()).toBe('new')
  view.rerender(<ConversationCallDock api={api} token="account-two" userId={2}/>)
  expect(calls[0]!.close).toHaveBeenCalledOnce()
  expect(screen.queryByLabelText('Звонок в беседе')).toBeNull()
})
