// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { VoxholdApi } from '../services/api'
import { ConversationCallDock } from './ConversationCallDock'
const mocks = vi.hoisted(() => ({ close: vi.fn(), setToken: vi.fn() }))
vi.mock('../services/conversationCall', () => ({ ConversationCall: class {
  constructor(_api: unknown, _token: string, _id: number, _uid: number, private callbacks: { state: (v: unknown) => void }) {}
  async start() { this.callbacks.state({ conversation_id: 7, revision: 1, members: [{ user_id: 1, username: 'owner' }] }) }
  close = mocks.close
  setToken = mocks.setToken
} }))
afterEach(() => { cleanup(); vi.clearAllMocks() })
it('keeps a personal call alive across token renewal and closes it on unmount', async () => {
  const api = {} as VoxholdApi
  const view = render(<ConversationCallDock api={api} token="old" userId={1}/>)
  await act(async () => window.dispatchEvent(new CustomEvent('voxhold:start-conversation-call', { detail: 7 })))
  expect(screen.getByText('owner (вы)')).toBeTruthy()
  view.rerender(<ConversationCallDock api={api} token="new" userId={1}/>)
  expect(mocks.close).not.toHaveBeenCalled()
  expect(mocks.setToken).toHaveBeenLastCalledWith('new')
  view.unmount(); expect(mocks.close).toHaveBeenCalledOnce()
})
