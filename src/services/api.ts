import type {
  ApiErrorPayload,
  ChannelRecording,
  RecordingStorage,
  RecordingLimits,
  AuthPayload,
  Channel,
  ChannelAccess,
  NewsSettings,
  NotificationMode,
  NotificationSettings,
  ChannelRead,
  ChannelKind,
  CreatedInvite,
  IncomingInvite,
  InstanceMetadata,
  InviteLinkPreview,
  CreatedInviteLink,
  InviteLinkPage,
  CorsOriginsPayload,
  Message,
  MessageReactions,
  ReactorPage,
  MessageContext,
  MessagePage,
  MessageSyncPage,
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
import type { AvatarCrop } from '../lib/avatarCrop'

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
    if (response.status === 401 && request.token) {
      // Single source of truth for session loss: AuthProvider listens and
      // expires the stored session; call sites no longer duplicate this.
      notifyUnauthorized(request.token)
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
    storageScope: transport.resolveURL?.('') || (typeof window === 'undefined' ? '' : window.location.origin),
    linkPreviews: {
      get: (token: string, href: string, signal?: AbortSignal) => authorized(token, { path: `/api/v1/link-preview?url=${encodeURIComponent(href)}`, signal }) as Promise<import('../domain/community').LinkPreview | null>,
      image: (token: string, path: string, signal?: AbortSignal) => {
        if (!/^\/api\/v1\/link-preview\/images\/[a-f0-9]{64}$/.test(path)) return Promise.reject(new Error('Invalid preview image path'))
        return authorized(token, { path, responseType: 'blob', signal }) as Promise<Blob>
      },
    },
    community: {
      thumbnail: (token: string, id: string, signal?: AbortSignal) => unwrap<Blob>(transport, { token, path: `/api/v1/attachments/${encodeURIComponent(id)}/thumbnail`, responseType: 'blob', signal }),
      attachmentStatus: (token: string, id: string, signal?: AbortSignal) => unwrap<void>(transport, { token, path: `/api/v1/attachments/${encodeURIComponent(id)}/content`, method: 'HEAD', signal }),
      request: <T>(token: string, path: string, method: TransportRequest['method'] = 'GET', body?: unknown, signal?: AbortSignal) => unwrap<T>(transport, { token, path: `/api/v1${path}`, method, body, signal }),
      upload: (token: string, channelId: number, id: string, file: File, onUploadProgress: (fraction: number) => void, signal?: AbortSignal, conversationId?: number) => unwrap<import('../domain/community').Attachment>(transport, { token, path: `/api/v1/${conversationId ? `conversations/${conversationId}` : `channels/${channelId}`}/attachments/${id}?filename=${encodeURIComponent(file.name)}`, method: 'PUT', rawBody: file, contentType: file.type || 'application/octet-stream', onUploadProgress, signal }),
      content: (token: string, id: string, signal?: AbortSignal) => unwrap<Blob>(transport, { token, path: `/api/v1/attachments/${encodeURIComponent(id)}/content`, responseType: 'blob', signal }),
    },
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
      // The version makes each URL immutable, so the HTTP cache needs no revalidation.
      avatar: (token: string, userId: number, version: string, signal?: AbortSignal) => authorized(token, { path: `/api/v1/users/${url(userId)}/avatar?v=${url(version)}`, responseType: 'blob', signal }) as Promise<Blob>,
      uploadAvatar: (token: string, file: File, crop?: AvatarCrop) => authorized(token, { path: `/api/v1/me/avatar${crop ? `?crop_x=${crop.x}&crop_y=${crop.y}&crop_size=${crop.size}` : ''}`, method: 'PUT', rawBody: file, contentType: file.type || 'application/octet-stream' }) as Promise<{ etag: string }>,
      removeAvatar: (token: string) => authorized(token, { path: '/api/v1/me/avatar', method: 'DELETE' }) as Promise<void>,
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
    recordings: {
      get: (token: string, id: string, signal?: AbortSignal) => authorized(token, { path: `/api/v1/recordings/${url(id)}`, signal }) as Promise<ChannelRecording>,
      remove: (token: string, id: string) => authorized(token, { path: `/api/v1/recordings/${url(id)}`, method: 'DELETE' }) as Promise<ChannelRecording>,
      storage: (token: string, signal?: AbortSignal) => authorized(token, { path: '/api/v1/instance/recording-storage', signal }) as Promise<RecordingStorage>,
      setQuota: (token: string, quota_bytes: number) => authorized(token, { path: '/api/v1/instance/recording-storage', method: 'PUT', body: { quota_bytes } }) as Promise<RecordingStorage>,
      list: (token: string, serverId: number, signal?: AbortSignal) => authorized(token, { path: `/api/v1/servers/${url(serverId)}/recordings`, signal }) as Promise<{ recordings: ChannelRecording[] } & Partial<RecordingLimits>>,
      start: (token: string, serverId: number, channelId: number, mime_type: string) => authorized(token, { path: `/api/v1/servers/${url(serverId)}/channels/${url(channelId)}/recordings`, method: 'POST', body: { mime_type } }) as Promise<ChannelRecording>,
      heartbeat: (token: string, id: string) => authorized(token, { path: `/api/v1/recordings/${url(id)}/heartbeat`, method: 'POST' }),
      stop: (token: string, id: string, size_bytes: number, duration_ms: number, local_only = false) => authorized(token, { path: `/api/v1/recordings/${url(id)}/stop`, method: 'POST', body: { size_bytes, duration_ms, local_only } }) as Promise<ChannelRecording>,
      offset: (token: string, id: string, signal?: AbortSignal) => authorized(token, { path: `/api/v1/recordings/${url(id)}/upload`, signal }) as Promise<{ offset: number }>,
      append: (token: string, id: string, offset: number, chunk: Blob, signal?: AbortSignal) => authorized(token, { path: `/api/v1/recordings/${url(id)}/content?offset=${offset}`, method: 'PATCH', rawBody: chunk, signal }) as Promise<{ offset: number }>,
      complete: (token: string, id: string) => authorized(token, { path: `/api/v1/recordings/${url(id)}/complete`, method: 'POST' }) as Promise<ChannelRecording>,
      preview: (token: string, id: string, version: string, signal?: AbortSignal) => authorized(token, { path: `/api/v1/recordings/${url(id)}/preview?v=${url(version)}`, responseType: 'blob', signal }) as Promise<Blob>,
      uploadPreview: (token: string, id: string, image: Blob, signal?: AbortSignal) => authorized(token, { path: `/api/v1/recordings/${url(id)}/preview`, method: 'PUT', rawBody: image, contentType: image.type || 'application/octet-stream', signal }) as Promise<ChannelRecording>,
      download: async (token: string, id: string) => {
        const result = await authorized(token, { path: `/api/v1/recordings/${url(id)}/download`, method: 'POST' }) as { url: string }
        // Only our relative route may receive the signed, short-lived ticket.
        if (!result.url.startsWith('/api/v1/recording-downloads/')) throw new Error('Invalid recording download URL')
        return transport.resolveURL?.(result.url) ?? result.url
      },
    },
    channels: {
      unreadCounts: (token: string, serverId: number, signal?: AbortSignal) =>
        authorized(token, { path: `/api/v1/servers/${url(serverId)}/notification-counts`, signal }) as Promise<Array<{ channel_id: number; unread_count: number }>>,
      news: (token: string, serverId: number, channelId: number, signal?: AbortSignal) =>
        authorized(token, { path: `/api/v1/servers/${url(serverId)}/channels/${url(channelId)}/news`, signal }) as Promise<NewsSettings>,
      setNews: (token: string, serverId: number, channelId: number, settings: NewsSettings) =>
        authorized(token, { path: `/api/v1/servers/${url(serverId)}/channels/${url(channelId)}/news`, method: 'PUT', body: settings }) as Promise<NewsSettings>,
      notifications: (token: string, serverId: number, channelId: number, signal?: AbortSignal) =>
        authorized(token, { path: `/api/v1/servers/${url(serverId)}/channels/${url(channelId)}/notifications`, signal }) as Promise<NotificationSettings>,
      setNotifications: (token: string, serverId: number, channelId: number, mode: NotificationMode) =>
        authorized(token, { path: `/api/v1/servers/${url(serverId)}/channels/${url(channelId)}/notifications`, method: 'PUT', body: { mode } }) as Promise<NotificationSettings>,
      access: (token: string, serverId: number, channelId: number, signal?: AbortSignal) =>
        authorized(token, { path: `/api/v1/servers/${url(serverId)}/channels/${url(channelId)}/access`, signal }) as Promise<ChannelAccess>,
      setAccess: (token: string, serverId: number, channelId: number, access: ChannelAccess) =>
        authorized(token, { path: `/api/v1/servers/${url(serverId)}/channels/${url(channelId)}/access`, method: 'PUT', body: access }) as Promise<ChannelAccess>,
      members: (token: string, serverId: number, channelId: number, signal?: AbortSignal) =>
        authorized(token, { path: `/api/v1/servers/${url(serverId)}/channels/${url(channelId)}/members`, signal }) as Promise<{ user_ids: number[] }>,
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
      comments: (token: string, serverId: number, channelId: number, postId: number, beforeId?: number, signal?: AbortSignal) =>
        authorized(token, { path: `/api/v1/servers/${url(serverId)}/channels/${url(channelId)}/messages/${url(postId)}/comments${beforeId ? `?before_id=${beforeId}` : ''}`, signal }) as Promise<MessagePage>,
      setReaction: (token: string, serverId: number, channelId: number, messageId: number, emoji: string, active: boolean) =>
        authorized(token, { path: `/api/v1/servers/${url(serverId)}/channels/${url(channelId)}/messages/${url(messageId)}/reactions/${url(emoji)}`, method: active ? 'PUT' : 'DELETE' }) as Promise<MessageReactions>,
      reactors: (token: string, serverId: number, channelId: number, messageId: number, emoji: string, signal: AbortSignal, after?: number) =>
        authorized(token, { path: `/api/v1/servers/${url(serverId)}/channels/${url(channelId)}/messages/${url(messageId)}/reactions/${url(emoji)}${after ? `?after_user_id=${after}` : ''}`, signal }) as Promise<ReactorPage>,
      forward: (token: string, serverId: number, channelId: number, sourceServerId: number, sourceChannelId: number, sourceMessageId: number, clientMessageId: string, signal?: AbortSignal) =>
        authorized(token, { path: `/api/v1/servers/${url(serverId)}/channels/${url(channelId)}/messages/forward`, method: 'POST', body: { source_server_id: sourceServerId, source_channel_id: sourceChannelId, source_message_id: sourceMessageId, client_message_id: clientMessageId }, signal }) as Promise<Message>,
      sync: (token: string, serverId: number, channelId: number, after?: number, signal?: AbortSignal) =>
        authorized(token, { path: `/api/v1/servers/${url(serverId)}/channels/${url(channelId)}/messages/sync${after === undefined ? '' : `?after=${after}`}`, signal }) as Promise<MessageSyncPage>,
      list: (token: string, serverId: number, channelId: number, beforeId?: number, signal?: AbortSignal) => {
        const query = new URLSearchParams({ limit: '50' })
        if (beforeId) query.set('before_id', String(beforeId))
        return authorized(token, {
          path: `/api/v1/servers/${url(serverId)}/channels/${url(channelId)}/messages?${query}`,
          signal,
        }) as Promise<MessagePage>
      },
      create: (token: string, serverId: number, channelId: number, content: string, clientMessageId?: string, signal?: AbortSignal, replyToMessageId?: number, threadRootId?: number, attachmentIds?: string[]) =>
        authorized(token, {
          path: `/api/v1/servers/${url(serverId)}/channels/${url(channelId)}/messages`,
          method: 'POST',
          body: { content, ...(clientMessageId ? { client_message_id: clientMessageId } : {}), ...(replyToMessageId ? { reply_to_message_id: replyToMessageId } : {}), ...(threadRootId ? { thread_root_id: threadRootId } : {}), ...(attachmentIds?.length ? { attachment_ids: attachmentIds } : {}) },
          ...(signal ? { signal } : {}),
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
      list: (token: string, serverId: number, beforeId?: number, signal?: AbortSignal) => {
        const query = new URLSearchParams({ limit: '50' })
        if (beforeId !== undefined) query.set('before_id', String(beforeId))
        return authorized(token, { path: `/api/v1/servers/${url(serverId)}/invite-links?${query}`, signal }) as Promise<InviteLinkPage>
      },
      revoke: (token: string, serverId: number, linkId: number) =>
        authorized(token, { path: `/api/v1/servers/${url(serverId)}/invite-links/${url(linkId)}`, method: 'DELETE' }) as Promise<void>,
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
