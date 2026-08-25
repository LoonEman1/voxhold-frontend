import type {
  ApiErrorPayload,
  AuthPayload,
  Channel,
  ChannelRead,
  ChannelKind,
  CreatedInvite,
  IncomingInvite,
  InstanceMetadata,
  InviteLinkPreview,
  CreatedInviteLink,
  CorsOriginsPayload,
  Message,
  MessageContext,
  MessagePage,
  PinnedMessage,
  Profile,
  SearchMessagePage,
  Server,
  ServerMember,
  ServerRole,
  Session,
  ClientDiagnosticsPayload,
  WebRTCConfigPayload,
} from '../domain/types'
import type { Transport, TransportRequest } from '../platform/transport'
import { notifyUnauthorized } from './authEvents'

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

async function unwrap<T>(transport: Transport, request: TransportRequest): Promise<T> {
  let response
  try {
    response = await transport.request<T | ApiErrorPayload>(request)
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new ApiError('Не удалось связаться с сервером', 0)
  }

  if (response.status < 200 || response.status >= 300) {
    const payload = response.data as ApiErrorPayload | null
    if (response.status === 401) {
      // Single source of truth for session loss: AuthProvider listens and
      // expires the stored session; call sites no longer duplicate this.
      notifyUnauthorized()
    }
    throw new ApiError(payload?.error || 'Сервер вернул ошибку', response.status)
  }

  return response.data as T
}

const url = (value: string | number) => encodeURIComponent(String(value))

export function createApi(transport: Transport) {
  const authorized = (token: string, request: TransportRequest) =>
    unwrap(transport, { ...request, token })

  return {
    instance: {
      get: (signal?: AbortSignal) =>
        unwrap<InstanceMetadata>(transport, { path: '/api/v1/instance', signal }),
    },
    corsOrigins: {
      get: async (token: string, signal?: AbortSignal): Promise<CorsOriginsPayload> => ({
        origins: ((await authorized(token, {
          path: '/api/v1/instance/cors-origins',
          signal,
        })) as CorsOriginsPayload).origins ?? [],
      }),
      replace: async (token: string, origins: string[]): Promise<CorsOriginsPayload> => ({
        origins: ((await authorized(token, {
          path: '/api/v1/instance/cors-origins',
          method: 'PUT',
          body: { origins },
        })) as CorsOriginsPayload).origins ?? [],
      }),
    },
    auth: {
      login: (username: string, password: string) =>
        unwrap<AuthPayload>(transport, {
          path: '/api/v1/auth/login',
          method: 'POST',
          body: { username, password },
        }),
      register: (username: string, password: string, passwordConfirm: string, inviteToken: string) =>
        unwrap<AuthPayload>(transport, {
          path: '/api/v1/auth/register',
          method: 'POST',
          body: { username, password, password_confirm: passwordConfirm, invite_token: inviteToken },
        }),
      refresh: (token: string) =>
        authorized(token, { path: '/api/v1/auth/refresh', method: 'POST' }) as Promise<Session>,
      logout: (token: string) =>
        authorized(token, { path: '/api/v1/auth/logout', method: 'POST' }) as Promise<void>,
    },
    account: {
      delete: (token: string) =>
        authorized(token, { path: '/api/v1/account', method: 'DELETE' }) as Promise<void>,
    },
    profile: {
      me: (token: string, signal?: AbortSignal) =>
        authorized(token, { path: '/api/v1/me/profile', signal }) as Promise<Profile>,
      byUser: (token: string, userId: number, signal?: AbortSignal) =>
        authorized(token, { path: `/api/v1/users/${url(userId)}/profile`, signal }) as Promise<Profile>,
      update: (token: string, patch: { about?: string; country_code?: string }) =>
        authorized(token, { path: '/api/v1/me/profile', method: 'PATCH', body: patch }) as Promise<Profile>,
    },
    servers: {
      list: (token: string, signal?: AbortSignal) =>
        authorized(token, { path: '/api/v1/me/servers', signal }) as Promise<Server[]>,
      update: (token: string, serverId: number, name: string) =>
        authorized(token, { path: `/api/v1/servers/${url(serverId)}`, method: 'PATCH', body: { name } }) as Promise<Server>,
      members: (token: string, serverId: number, signal?: AbortSignal) =>
        authorized(token, { path: `/api/v1/servers/${url(serverId)}/members`, signal }) as Promise<ServerMember[]>,
      updateMemberRole: (token: string, serverId: number, userId: number, role: Exclude<ServerRole, 'owner'>) =>
        authorized(token, {
          path: `/api/v1/servers/${url(serverId)}/members/${url(userId)}/role`,
          method: 'PATCH',
          body: { role },
        }) as Promise<ServerMember>,
      banMember: (token: string, serverId: number, userId: number) =>
        authorized(token, {
          path: `/api/v1/servers/${url(serverId)}/bans/${url(userId)}`,
          method: 'POST',
        }) as Promise<void>,
    },
    channels: {
      list: (token: string, serverId: number, signal?: AbortSignal) =>
        authorized(token, { path: `/api/v1/servers/${url(serverId)}/channels`, signal }) as Promise<Channel[]>,
      create: (token: string, serverId: number, name: string, kind: ChannelKind) =>
        authorized(token, { path: `/api/v1/servers/${url(serverId)}/channels`, method: 'POST', body: { name, kind } }) as Promise<Channel>,
      update: (token: string, serverId: number, channelId: number, name: string) =>
        authorized(token, { path: `/api/v1/servers/${url(serverId)}/channels/${url(channelId)}`, method: 'PATCH', body: { name } }) as Promise<Channel>,
      delete: (token: string, serverId: number, channelId: number) =>
        authorized(token, { path: `/api/v1/servers/${url(serverId)}/channels/${url(channelId)}`, method: 'DELETE' }) as Promise<void>,
    },
    messages: {
      list: (token: string, serverId: number, channelId: number, beforeId?: number, signal?: AbortSignal) => {
        const query = new URLSearchParams({ limit: '50' })
        if (beforeId) query.set('before_id', String(beforeId))
        return authorized(token, {
          path: `/api/v1/servers/${url(serverId)}/channels/${url(channelId)}/messages?${query}`,
          signal,
        }) as Promise<MessagePage>
      },
      create: (token: string, serverId: number, channelId: number, content: string) =>
        authorized(token, {
          path: `/api/v1/servers/${url(serverId)}/channels/${url(channelId)}/messages`,
          method: 'POST',
          body: { content },
        }) as Promise<Message>,
      update: (token: string, serverId: number, channelId: number, messageId: number, content: string) =>
        authorized(token, {
          path: `/api/v1/servers/${url(serverId)}/channels/${url(channelId)}/messages/${url(messageId)}`,
          method: 'PATCH',
          body: { content },
        }) as Promise<Message>,
      delete: (token: string, serverId: number, channelId: number, messageId: number) =>
        authorized(token, {
          path: `/api/v1/servers/${url(serverId)}/channels/${url(channelId)}/messages/${url(messageId)}`,
          method: 'DELETE',
        }) as Promise<void>,
      pin: (token: string, serverId: number, channelId: number, messageId: number) =>
        authorized(token, {
          path: `/api/v1/servers/${url(serverId)}/channels/${url(channelId)}/messages/${url(messageId)}/pin`,
          method: 'PUT',
        }) as Promise<PinnedMessage>,
      unpin: (token: string, serverId: number, channelId: number, messageId: number) =>
        authorized(token, {
          path: `/api/v1/servers/${url(serverId)}/channels/${url(channelId)}/messages/${url(messageId)}/pin`,
          method: 'DELETE',
        }) as Promise<void>,
      pins: (token: string, serverId: number, channelId: number, signal?: AbortSignal) =>
        authorized(token, {
          path: `/api/v1/servers/${url(serverId)}/channels/${url(channelId)}/pins`,
          signal,
        }) as Promise<PinnedMessage[]>,
      search: (token: string, serverId: number, query: string, beforeId?: number, limit = 25, signal?: AbortSignal) => {
        const search = new URLSearchParams({ q: query, limit: String(limit) })
        if (beforeId) search.set('before_id', String(beforeId))
        return authorized(token, {
          path: `/api/v1/servers/${url(serverId)}/messages/search?${search}`,
          signal,
        }) as Promise<SearchMessagePage>
      },
      context: (token: string, serverId: number, channelId: number, messageId: number, before = 25, after = 25, signal?: AbortSignal) => {
        const query = new URLSearchParams({ before: String(before), after: String(after) })
        return authorized(token, {
          path: `/api/v1/servers/${url(serverId)}/channels/${url(channelId)}/messages/${url(messageId)}/context?${query}`,
          signal,
        }) as Promise<MessageContext>
      },
    },
    reads: {
      mark: (token: string, serverId: number, channelId: number, lastReadMessageId: number) =>
        authorized(token, {
          path: `/api/v1/servers/${url(serverId)}/channels/${url(channelId)}/read`,
          method: 'PUT',
          body: { last_read_message_id: lastReadMessageId },
        }) as Promise<ChannelRead>,
    },
    invites: {
      list: (token: string, signal?: AbortSignal) =>
        authorized(token, { path: '/api/v1/me/server-invites', signal }) as Promise<IncomingInvite[]>,
      create: (token: string, serverId: number, username: string) =>
        authorized(token, {
          path: `/api/v1/servers/${url(serverId)}/invites`,
          method: 'POST',
          body: { username },
        }) as Promise<CreatedInvite>,
      accept: (token: string, inviteId: number) =>
        authorized(token, { path: `/api/v1/me/server-invites/${url(inviteId)}/accept`, method: 'POST' }) as Promise<Server>,
      decline: (token: string, inviteId: number) =>
        authorized(token, { path: `/api/v1/me/server-invites/${url(inviteId)}/decline`, method: 'POST' }) as Promise<void>,
    },
    inviteLinks: {
      create: (
        token: string,
        serverId: number,
        input: { expires_in_seconds: number; max_uses: number | null; allow_registration: boolean },
      ) => authorized(token, {
        path: `/api/v1/servers/${url(serverId)}/invite-links`,
        method: 'POST',
        body: input,
      }) as Promise<CreatedInviteLink>,
      resolve: (inviteToken: string, signal?: AbortSignal) =>
        unwrap<InviteLinkPreview>(transport, {
          path: '/api/v1/invite-links/resolve',
          method: 'POST',
          body: { token: inviteToken },
          signal,
        }),
      accept: (token: string, inviteToken: string) =>
        authorized(token, {
          path: '/api/v1/invite-links/accept',
          method: 'POST',
          body: { token: inviteToken },
        }) as Promise<Server>,
    },
    diagnostics: {
      list: (token: string, limit = 5_000, signal?: AbortSignal) =>
        authorized(token, {
          path: `/api/v1/diagnostics/client-events?limit=${url(limit)}`,
          signal,
        }) as Promise<ClientDiagnosticsPayload>,
    },
    webrtc: {
      config: (token: string, signal?: AbortSignal) =>
        authorized(token, { path: '/api/v1/webrtc/config', signal }) as Promise<WebRTCConfigPayload>,
    },
  }
}

export type VoxholdApi = ReturnType<typeof createApi>
