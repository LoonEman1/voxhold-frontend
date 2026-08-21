import { describe, expect, it, vi } from 'vitest'
import type { Transport, TransportRequest, TransportResponse } from '../platform/transport'
import { ApiError, createApi } from './api'

function mockTransport(response: TransportResponse<unknown>) {
  const request = vi.fn(async (_input: TransportRequest) => response)
  return { api: createApi({ request } as Transport), request }
}

describe('Voxhold API client', () => {
  it('discovers a backend instance without authentication', async () => {
    const payload = {
      instance_id: '0123456789abcdef0123456789abcdef',
      name: 'Voxhold',
      initialized: true,
      registration: 'invite_only',
      protocol_version: 1,
      created_at: 1,
    }
    const { api, request } = mockTransport({ status: 200, data: payload })

    await expect(api.instance.get()).resolves.toEqual(payload)
    expect(request).toHaveBeenCalledWith({
      path: '/api/v1/instance',
      signal: undefined,
    })
  })

  it('uses the backend login contract', async () => {
    const payload = {
      user: { id: 7, username: 'niko', created_at: 1 },
      session: { token: 'secret', expires_at: 100 },
    }
    const { api, request } = mockTransport({ status: 200, data: payload })

    await expect(api.auth.login('niko', 'password')).resolves.toEqual(payload)
    expect(request).toHaveBeenCalledWith({
      path: '/api/v1/auth/login',
      method: 'POST',
      body: { username: 'niko', password: 'password' },
    })
  })

  it('deletes the current instance account', async () => {
    const { api, request } = mockTransport({ status: 204, data: null })

    await api.account.delete('session')

    expect(request).toHaveBeenCalledWith({
      path: '/api/v1/account',
      method: 'DELETE',
      token: 'session',
    })
  })

  it('sends the invite token during registration', async () => {
    const payload = {
      user: { id: 8, username: 'mira', created_at: 1 },
      session: { token: 'session', expires_at: 100 },
    }
    const { api, request } = mockTransport({ status: 201, data: payload })

    await expect(api.auth.register('mira', 'password', 'password', 'invite-token')).resolves.toEqual(payload)
    expect(request).toHaveBeenCalledWith({
      path: '/api/v1/auth/register',
      method: 'POST',
      body: {
        username: 'mira',
        password: 'password',
        password_confirm: 'password',
        invite_token: 'invite-token',
      },
    })
  })

  it('builds invite-link create, resolve and accept requests', async () => {
    const { api, request } = mockTransport({ status: 200, data: {} })
    const input = { expires_in_seconds: 3600, max_uses: 1, allow_registration: true }

    await api.inviteLinks.create('session', 4, input)
    await api.inviteLinks.resolve('invite-token')
    await api.inviteLinks.accept('session', 'invite-token')

    expect(request).toHaveBeenNthCalledWith(1, {
      path: '/api/v1/servers/4/invite-links',
      method: 'POST',
      body: input,
      token: 'session',
    })
    expect(request).toHaveBeenNthCalledWith(2, {
      path: '/api/v1/invite-links/resolve',
      method: 'POST',
      body: { token: 'invite-token' },
      signal: undefined,
    })
    expect(request).toHaveBeenNthCalledWith(3, {
      path: '/api/v1/invite-links/accept',
      method: 'POST',
      body: { token: 'invite-token' },
      token: 'session',
    })
  })

  it('builds cursor pagination and authorization', async () => {
    const { api, request } = mockTransport({
      status: 200,
      data: { messages: [], pagination: { next_before_id: null, has_more: false } },
    })

    await api.messages.list('token', 2, 9, 41)
    expect(request).toHaveBeenCalledWith(expect.objectContaining({
      path: '/api/v1/servers/2/channels/9/messages?limit=50&before_id=41',
      token: 'token',
    }))
  })

  it('turns backend errors into typed errors', async () => {
    const { api } = mockTransport({ status: 401, data: { error: 'invalid or expired session' } })
    await expect(api.profile.me('old-token')).rejects.toEqual(
      expect.objectContaining<ApiError>({
        name: 'ApiError',
        status: 401,
        message: 'invalid or expired session',
      }),
    )
  })

  it('builds message mutation and pin requests', async () => {
    const pin = {
      message: { id: 41, channel_id: 9, author: { user_id: 3, username: 'author' }, content: 'important', created_at: 10, edited_at: null },
      pinned_by: { user_id: 1, username: 'owner' },
      pinned_at: 12,
    }
    const { api, request } = mockTransport({ status: 204, data: null })
    request
      .mockResolvedValueOnce({ status: 204, data: null })
      .mockResolvedValueOnce({ status: 200, data: pin })
      .mockResolvedValueOnce({ status: 204, data: null })

    await api.messages.delete('token', 2, 9, 41)
    await expect(api.messages.pin('token', 2, 9, 41)).resolves.toEqual(pin)
    await api.messages.unpin('token', 2, 9, 41)

    expect(request).toHaveBeenNthCalledWith(1, {
      path: '/api/v1/servers/2/channels/9/messages/41',
      method: 'DELETE',
      token: 'token',
    })
    expect(request).toHaveBeenNthCalledWith(2, {
      path: '/api/v1/servers/2/channels/9/messages/41/pin',
      method: 'PUT',
      token: 'token',
    })
    expect(request).toHaveBeenNthCalledWith(3, {
      path: '/api/v1/servers/2/channels/9/messages/41/pin',
      method: 'DELETE',
      token: 'token',
    })
  })

  it('encodes Cyrillic search and message context parameters', async () => {
    const { api, request } = mockTransport({
      status: 200,
      data: { messages: [], pagination: { next_before_id: null, has_more: false } },
    })

    await api.messages.search('token', 3, 'привет мир', 90, 25)
    await api.messages.context('token', 3, 4, 58, 12, 18)

    expect(request).toHaveBeenNthCalledWith(1, expect.objectContaining({
      path: '/api/v1/servers/3/messages/search?q=%D0%BF%D1%80%D0%B8%D0%B2%D0%B5%D1%82+%D0%BC%D0%B8%D1%80&limit=25&before_id=90',
      token: 'token',
    }))
    expect(request).toHaveBeenNthCalledWith(2, expect.objectContaining({
      path: '/api/v1/servers/3/channels/4/messages/58/context?before=12&after=18',
      token: 'token',
    }))
  })

  it('builds member management and read cursor requests', async () => {
    const { api, request } = mockTransport({ status: 200, data: {} })

    await api.servers.updateMemberRole('token', 3, 8, 'admin')
    await api.servers.banMember('token', 3, 8)
    await api.reads.mark('token', 3, 5, 144)

    expect(request).toHaveBeenNthCalledWith(1, {
      path: '/api/v1/servers/3/members/8/role',
      method: 'PATCH',
      body: { role: 'admin' },
      token: 'token',
    })
    expect(request).toHaveBeenNthCalledWith(2, {
      path: '/api/v1/servers/3/bans/8',
      method: 'POST',
      token: 'token',
    })
    expect(request).toHaveBeenNthCalledWith(3, {
      path: '/api/v1/servers/3/channels/5/read',
      method: 'PUT',
      body: { last_read_message_id: 144 },
      token: 'token',
    })
  })
})
