import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import { Avatar } from '../components/Avatar'
import { Brand } from '../components/Brand'
import { ChatPanel } from '../components/ChatPanel'
import { Icon } from '../components/Icon'
import { MessageSearchPanel, PinnedMessagesPanel } from '../components/MessagePanels'
import { PersistentStreamPlayer } from '../components/PersistentStreamPlayer'
import { StreamSettingsDialog } from '../components/StreamSettingsDialog'
import { useToast } from '../components/Toast'
import { VoicePanel, type VoiceConnectionStatus } from '../components/VoicePanel'
import { VoiceSettingsDialog } from '../components/VoiceSettingsDialog'
import {
  ChannelSettingsDialog,
  CreateChannelDialog,
  InvitesDialog,
  InviteUserDialog,
  LogoutConfirmDialog,
  MemberProfileDialog,
  ProfileDialog,
  ServerSettingsDialog,
} from '../components/WorkspaceDialogs'
import type { ActiveStream, Channel, ChannelKind, ChannelRead, IncomingInvite, InstanceMetadata, Message, PinnedMessage, Profile, Server, ServerMember, ServerRole, VoiceParticipant } from '../domain/types'
import { useWorkspaceLayout } from '../hooks/useWorkspaceLayout'
import { channelHasUnreadMessages } from '../lib/channelUnread'
import { humanError, relativeTime } from '../lib/format'
import { roleMeta } from '../lib/roles'
import type { VoxholdApi } from '../services/api'
import { ApiError } from '../services/api'
import { RealtimeClient, type ConnectionState } from '../services/realtime'
import { BrowserP2PStreamPublisher, BrowserP2PStreamViewer, BrowserServerStreamSession, captureScreen, selectedStreamCodec, streamErrorMessage, supportedStreamCodecs, type StreamQualityStats } from '../services/stream'
import { loadStreamPreferences, saveStreamPreferences, type StreamPreferences } from '../services/streamSettings'
import { BrowserVoiceSession, enumerateVoiceDevices, voiceCloseMessage, voiceErrorMessage } from '../services/voice'
import { isEditableKeyboardTarget, loadVoicePreferences, saveVoicePreferences, shortcutMatches, type VoicePreferences } from '../services/voiceSettings'
import { clientDiagnostics } from '../platform/clientDiagnostics'
import { useTheme } from '../theme/ThemeContext'

type Dialog = 'server' | 'channel' | 'channelSettings' | 'invite' | 'invites' | 'profile' | 'userProfile' | 'settings' | 'voiceSettings' | 'streamSettings' | 'logout' | null
type MessagePanel = 'search' | 'pins' | null
type MessageTarget = { channelId: number; messageId: number }
type ActiveVoiceSession = { serverId: number; channelId: number; channelName: string; connectionId: string | null; selfMute: boolean; selfDeaf: boolean }
type StreamStatus = 'idle' | 'requesting' | 'signaling' | 'connected'

interface WorkspaceProps {
  api: VoxholdApi
  realtimeBaseUrl?: string
}

function upsertPinnedMessage(current: PinnedMessage[], value: PinnedMessage) {
  return [value, ...current.filter((pin) => pin.message.id !== value.message.id)]
    .sort((left, right) => right.pinned_at - left.pinned_at || right.message.id - left.message.id)
}

export function WorkspacePage({ api, realtimeBaseUrl }: WorkspaceProps) {
  const { user, token, logout, expire } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const notify = useToast()
  const workspaceLayout = useWorkspaceLayout()
  const [instance, setInstance] = useState<InstanceMetadata | null>(null)
  const [servers, setServers] = useState<Server[]>([])
  const [selectedServerId, setSelectedServerId] = useState<number | null>(null)
  const [channels, setChannels] = useState<Channel[]>([])
  const [selectedChannelId, setSelectedChannelId] = useState<number | null>(null)
  const [members, setMembers] = useState<ServerMember[]>([])
  const [messages, setMessages] = useState<Message[]>([])
  const [pinnedMessages, setPinnedMessages] = useState<PinnedMessage[]>([])
  const [pinsLoading, setPinsLoading] = useState(false)
  const [nextBeforeId, setNextBeforeId] = useState<number | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [hasNewer, setHasNewer] = useState(false)
  const [loadingNewer, setLoadingNewer] = useState(false)
  const [invites, setInvites] = useState<IncomingInvite[]>([])
  const [profile, setProfile] = useState<Profile | null>(null)
  const [initialLoading, setInitialLoading] = useState(true)
  const [messagesLoading, setMessagesLoading] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [connection, setConnection] = useState<ConnectionState>('connecting')
  const [dialog, setDialog] = useState<Dialog>(null)
  const [messagePanel, setMessagePanel] = useState<MessagePanel>(null)
  const [messageTarget, setMessageTarget] = useState<MessageTarget | null>(null)
  const [focusedMessageId, setFocusedMessageId] = useState<number | null>(null)
  const [onlineByServer, setOnlineByServer] = useState<Record<number, number[]>>({})
  const [channelReads, setChannelReads] = useState<Record<number, Record<number, ChannelRead>>>({})
  const [voiceParticipants, setVoiceParticipants] = useState<Record<string, VoiceParticipant>>({})
  const [voiceSession, setVoiceSession] = useState<ActiveVoiceSession | null>(null)
  const [voiceStatus, setVoiceStatus] = useState<VoiceConnectionStatus>('idle')
  const [voiceError, setVoiceError] = useState('')
  const [voicePreferences, setVoicePreferences] = useState(loadVoicePreferences)
  const [voiceDevices, setVoiceDevices] = useState<MediaDeviceInfo[]>([])
  const [voiceDevicesLoading, setVoiceDevicesLoading] = useState(false)
  const [voiceInputLevel, setVoiceInputLevel] = useState(0)
  const [streams, setStreams] = useState<Record<number, ActiveStream>>({})
  const [streamStatus, setStreamStatus] = useState<StreamStatus>('idle')
  const [streamError, setStreamError] = useState('')
  const [streamMedia, setStreamMedia] = useState<MediaStream | null>(null)
  const [streamQuality, setStreamQuality] = useState<StreamQualityStats | null>(null)
  const [streamPreferences, setStreamPreferences] = useState(loadStreamPreferences)
  const [streamRole, setStreamRole] = useState<'publisher' | 'viewer' | null>(null)
  const [streamExpanded, setStreamExpanded] = useState(false)
  const [mobileNav, setMobileNav] = useState(false)
  const [editingChannel, setEditingChannel] = useState<Channel | null>(null)
  const [viewedProfile, setViewedProfile] = useState<Profile | null>(null)
  const [viewedProfileRole, setViewedProfileRole] = useState<ServerRole>('member')
  const [viewedProfileLoading, setViewedProfileLoading] = useState(false)
  const [viewedProfileError, setViewedProfileError] = useState('')
  const realtimeRef = useRef<RealtimeClient | null>(null)
  const voiceMediaRef = useRef<BrowserVoiceSession | null>(null)
  const voiceSessionRef = useRef<ActiveVoiceSession | null>(voiceSession)
  const voicePreferencesRef = useRef(voicePreferences)
  const pushToTalkHeldRef = useRef(false)
  const voiceRequestIdsRef = useRef(new Map<string, 'join' | 'state' | 'media' | 'leave'>())
  const streamRequestIdsRef = useRef(new Map<string, 'start' | 'watch' | 'media' | 'leave'>())
  const streamRoleRef = useRef<'publisher' | 'viewer' | null>(streamRole)
  const streamPreferencesRef = useRef(streamPreferences)
  const streamCaptureRef = useRef<MediaStream | null>(null)
  const serverStreamRef = useRef<BrowserServerStreamSession | null>(null)
  const p2pStreamPublisherRef = useRef<BrowserP2PStreamPublisher | null>(null)
  const p2pStreamViewerRef = useRef<BrowserP2PStreamViewer | null>(null)
  const serversRef = useRef<Server[]>(servers)
  const channelsRef = useRef<Channel[]>(channels)
  const channelReadsRef = useRef(channelReads)
  const viewedProfileRef = useRef<Profile | null>(viewedProfile)
  const pendingReadMarksRef = useRef(new Map<number, { serverId: number; messageId: number; timer: number }>())
  const activeChannelRef = useRef<number | null>(selectedChannelId)
  const activeServerRef = useRef<number | null>(selectedServerId)
  const hasNewerRef = useRef(false)
  const messageTargetRef = useRef<MessageTarget | null>(messageTarget)
  const newerRequestRef = useRef(false)
  const skipNextMessageLoadRef = useRef(false)
  const syncLatestRef = useRef<() => void>(() => undefined)
  const syncPinsRef = useRef<() => void>(() => undefined)
  activeChannelRef.current = selectedChannelId
  activeServerRef.current = selectedServerId
  serversRef.current = servers
  channelsRef.current = channels
  channelReadsRef.current = channelReads
  voiceSessionRef.current = voiceSession
  voicePreferencesRef.current = voicePreferences
  streamRoleRef.current = streamRole
  streamPreferencesRef.current = streamPreferences
  viewedProfileRef.current = viewedProfile
  hasNewerRef.current = hasNewer
  messageTargetRef.current = messageTarget

  syncLatestRef.current = () => {
    const serverId = activeServerRef.current
    const channelId = activeChannelRef.current
    if (!token || !serverId || !channelId || hasNewerRef.current || messageTargetRef.current) return
    void api.messages.list(token, serverId, channelId).then((page) => {
      if (activeServerRef.current !== serverId || activeChannelRef.current !== channelId || messageTargetRef.current) return
      setMessages((current) => {
        const merged = new Map(current.map((message) => [message.id, message]))
        page.messages.forEach((message) => merged.set(message.id, message))
        return [...merged.values()].sort((left, right) => left.id - right.id)
      })
      setNextBeforeId(page.pagination.next_before_id)
      setHasMore(page.pagination.has_more)
    }).catch(() => undefined)
  }

  syncPinsRef.current = () => {
    const serverId = activeServerRef.current
    const channelId = activeChannelRef.current
    if (!token || !serverId || !channelId) return
    void api.messages.pins(token, serverId, channelId).then((pins) => {
      if (activeServerRef.current === serverId && activeChannelRef.current === channelId) setPinnedMessages(pins)
    }).catch(() => undefined)
  }

  const selectedServer = servers.find((server) => server.id === selectedServerId) ?? null
  const selectedChannel = channels.find((channel) => channel.id === selectedChannelId) ?? null
  const canManage = selectedServer?.role === 'owner' || selectedServer?.role === 'admin'
  const pinnedMessageIds = useMemo(() => new Set(pinnedMessages.map((pin) => pin.message.id)), [pinnedMessages])

  const handleError = useCallback((error: unknown, fallback = 'Не удалось выполнить действие') => {
    if (error instanceof ApiError && error.status === 401) {
      expire()
      return
    }
    notify(error instanceof Error ? humanError(error) : fallback, 'error')
  }, [expire, notify])

  const applyChannelRead = useCallback((read: ChannelRead) => {
    setChannelReads((current) => {
      const channelState = current[read.channel_id] ?? {}
      const existing = channelState[read.user_id]
      if (existing && existing.last_read_message_id >= read.last_read_message_id) return current
      const next = { ...current, [read.channel_id]: { ...channelState, [read.user_id]: read } }
      channelReadsRef.current = next
      return next
    })
  }, [])

  const recordLastMessage = useCallback((channelId: number, messageId: number) => {
    setChannels((current) => {
      let changed = false
      const next = current.map((channel) => {
        if (channel.id !== channelId || (channel.last_message_id ?? 0) >= messageId) return channel
        changed = true
        return { ...channel, last_message_id: messageId }
      })
      if (!changed) return current
      channelsRef.current = next
      return next
    })
  }, [])

  const replaceChannelReads = useCallback((channelId: number, reads: ChannelRead[]) => {
    setChannelReads((current) => {
      const nextChannelState: Record<number, ChannelRead> = { ...(current[channelId] ?? {}) }
      reads.forEach((read) => {
        const existing = nextChannelState[read.user_id]
        if (!existing || existing.last_read_message_id < read.last_read_message_id) nextChannelState[read.user_id] = read
      })
      const next = { ...current, [channelId]: nextChannelState }
      channelReadsRef.current = next
      return next
    })
  }, [])

  const markReadThrough = useCallback((messageId: number) => {
    const serverId = activeServerRef.current
    const channelId = activeChannelRef.current
    const userId = user?.id
    if (!token || !serverId || !channelId || !userId || messageId <= 0) return
    const currentCursor = channelReadsRef.current[channelId]?.[userId]?.last_read_message_id ?? 0
    if (messageId <= currentCursor) return

    const pending = pendingReadMarksRef.current.get(channelId)
    if (pending) window.clearTimeout(pending.timer)
    const target = Math.max(messageId, pending?.messageId ?? 0)
    const timer = window.setTimeout(() => {
      const queued = pendingReadMarksRef.current.get(channelId)
      if (!queued) return
      pendingReadMarksRef.current.delete(channelId)
      void api.reads.mark(token, queued.serverId, channelId, queued.messageId)
        .then(applyChannelRead)
        .catch((error: unknown) => {
          if (error instanceof ApiError && error.status === 401) expire()
        })
    }, 220)
    pendingReadMarksRef.current.set(channelId, { serverId, messageId: target, timer })
  }, [api, token, user?.id, expire, applyChannelRead])

  useEffect(() => () => {
    pendingReadMarksRef.current.forEach((pending) => window.clearTimeout(pending.timer))
    pendingReadMarksRef.current.clear()
  }, [])

  const trackVoiceRequest = useCallback((requestId: string | null, kind: 'join' | 'state' | 'media' | 'leave') => {
    if (!requestId) return false
    if (voiceRequestIdsRef.current.size >= 256) voiceRequestIdsRef.current.clear()
    voiceRequestIdsRef.current.set(requestId, kind)
    return true
  }, [])

  const trackStreamRequest = useCallback((requestId: string | null, kind: 'start' | 'watch' | 'media' | 'leave') => {
    if (!requestId) return false
    if (streamRequestIdsRef.current.size >= 256) streamRequestIdsRef.current.clear()
    streamRequestIdsRef.current.set(requestId, kind)
    return true
  }, [])

  const upsertStream = useCallback((value: ActiveStream) => {
    setStreams((current) => ({ ...current, [value.channel_id]: value }))
  }, [])

  const removeStream = useCallback((channelId: number) => {
    setStreams((current) => {
      if (!current[channelId]) return current
      const { [channelId]: _removed, ...remaining } = current
      return remaining
    })
  }, [])

  const upsertVoiceParticipant = useCallback((participant: VoiceParticipant) => {
    setVoiceParticipants((current) => ({ ...current, [participant.connection_id]: participant }))
  }, [])

  const removeVoiceParticipant = useCallback((connectionId: string) => {
    setVoiceParticipants((current) => {
      if (!current[connectionId]) return current
      const { [connectionId]: _removed, ...remaining } = current
      return remaining
    })
  }, [])

  const closeStreamLocally = useCallback(() => {
    serverStreamRef.current?.close()
    p2pStreamPublisherRef.current?.close()
    p2pStreamViewerRef.current?.close()
    serverStreamRef.current = null
    p2pStreamPublisherRef.current = null
    p2pStreamViewerRef.current = null
    if (streamRoleRef.current === 'publisher') {
      streamCaptureRef.current?.getTracks().forEach((track) => track.stop())
    }
    streamCaptureRef.current = null
    streamRoleRef.current = null
    setStreamRole(null)
    setStreamMedia(null)
    setStreamQuality(null)
    setStreamStatus('idle')
    setStreamExpanded(false)
  }, [])

  const closeVoiceLocally = useCallback(() => {
    closeStreamLocally()
    const media = voiceMediaRef.current
    voiceMediaRef.current = null
    media?.close()
    pushToTalkHeldRef.current = false
    setVoiceInputLevel(0)
    const connectionId = voiceSessionRef.current?.connectionId
    if (connectionId) removeVoiceParticipant(connectionId)
    voiceSessionRef.current = null
    setVoiceSession(null)
    setVoiceStatus('idle')
  }, [closeStreamLocally, removeVoiceParticipant])

  useEffect(() => () => closeVoiceLocally(), [closeVoiceLocally])

  const refreshVoiceDevices = useCallback(async (requestPermission = false) => {
    setVoiceDevicesLoading(true)
    try {
      setVoiceDevices(await enumerateVoiceDevices(requestPermission && !voiceMediaRef.current))
    } catch (error) {
      notify(voiceErrorMessage(error), 'error')
    } finally {
      setVoiceDevicesLoading(false)
    }
  }, [notify])

  useEffect(() => {
    if (!navigator.mediaDevices?.addEventListener) return
    const refresh = () => { void refreshVoiceDevices(false) }
    navigator.mediaDevices.addEventListener('devicechange', refresh)
    return () => navigator.mediaDevices.removeEventListener('devicechange', refresh)
  }, [refreshVoiceDevices])

  const loadServers = useCallback(async (signal?: AbortSignal) => {
    if (!token) return []
    const data = await api.servers.list(token, signal)
    setServers(data)
    setSelectedServerId((current) => data.some((item) => item.id === current) ? current : (data[0]?.id ?? null))
    return data
  }, [api, token])

  const loadInvites = useCallback(async (signal?: AbortSignal) => {
    if (!token) return
    const data = await api.invites.list(token, signal)
    setInvites(data.filter((invite) => invite.status === 'pending'))
  }, [api, token])

  useEffect(() => {
    if (!token) return
    const controller = new AbortController()
    const load = async () => {
      setInitialLoading(true)
      try {
        const [, , ownProfile, metadata] = await Promise.all([
          loadServers(controller.signal),
          loadInvites(controller.signal),
          api.profile.me(token, controller.signal),
          api.instance.get(controller.signal),
        ])
        setProfile(ownProfile)
        setInstance(metadata)
      } catch (error) {
        if (!(error instanceof DOMException && error.name === 'AbortError')) handleError(error, 'Не удалось загрузить Voxhold')
      } finally {
        if (!controller.signal.aborted) setInitialLoading(false)
      }
    }
    void load()
    return () => controller.abort()
  }, [api, token, loadServers, loadInvites, handleError])

  useEffect(() => {
    if (!token || !selectedServerId) {
      setChannels([]); setMembers([]); setSelectedChannelId(null)
      return
    }
    const controller = new AbortController()
    const load = async () => {
      try {
        const [nextChannels, nextMembers] = await Promise.all([
          api.channels.list(token, selectedServerId, controller.signal),
          api.servers.members(token, selectedServerId, controller.signal),
        ])
        nextChannels.sort((left, right) => left.position - right.position || left.id - right.id)
        setChannels(nextChannels)
        setMembers(nextMembers)
        const currentChannelId = activeChannelRef.current
        const nextChannelId = nextChannels.some((item) => item.id === currentChannelId)
          ? currentChannelId
          : (nextChannels.find((item) => item.kind === 'text')?.id ?? nextChannels[0]?.id ?? null)
        if (nextChannelId !== currentChannelId) {
          const nextChannel = nextChannels.find((item) => item.id === nextChannelId)
          setMessages([])
          setPinnedMessages([])
          setNextBeforeId(null)
          setHasMore(false)
          setHasNewer(false)
          setMessagesLoading(nextChannel?.kind === 'text')
        }
        setSelectedChannelId(nextChannelId)
      } catch (error) {
        if (!(error instanceof DOMException && error.name === 'AbortError')) handleError(error, 'Не удалось загрузить сервер')
      }
    }
    void load()
    return () => controller.abort()
  }, [api, token, selectedServerId, handleError])

  useEffect(() => {
    if (!token || !selectedServerId || !selectedChannelId || selectedChannel?.kind !== 'text') {
      setMessages([]); setPinnedMessages([]); setNextBeforeId(null); setHasMore(false); setHasNewer(false)
      setMessagesLoading(false)
      return
    }
    if (skipNextMessageLoadRef.current) {
      skipNextMessageLoadRef.current = false
      setMessagesLoading(false)
      return
    }
    const controller = new AbortController()
    setMessagesLoading(true)
    setMessages([])
    setHasNewer(false)
    const target = messageTarget?.channelId === selectedChannelId ? messageTarget : null
    const request = target
      ? api.messages.context(token, selectedServerId, selectedChannelId, target.messageId, 25, 25, controller.signal)
      : api.messages.list(token, selectedServerId, selectedChannelId, undefined, controller.signal)
    request
      .then((page) => {
        setMessages(page.messages)
        if ('target_index' in page) {
          setNextBeforeId(page.messages[0]?.id ?? null)
          setHasMore(page.target_index >= 25)
          setHasNewer(page.messages.length - page.target_index - 1 >= 25)
          skipNextMessageLoadRef.current = true
          setMessageTarget(null)
        } else {
          setNextBeforeId(page.pagination.next_before_id)
          setHasMore(page.pagination.has_more)
          setHasNewer(false)
        }
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) handleError(error, 'Не удалось загрузить сообщения')
      })
      .finally(() => { if (!controller.signal.aborted) setMessagesLoading(false) })
    return () => controller.abort()
  }, [api, token, selectedServerId, selectedChannelId, selectedChannel?.kind, messageTarget, handleError])

  useEffect(() => {
    if (!token || !selectedServerId || !selectedChannelId || selectedChannel?.kind !== 'text') {
      setPinnedMessages([])
      return
    }
    const controller = new AbortController()
    setPinsLoading(true)
    api.messages.pins(token, selectedServerId, selectedChannelId, controller.signal)
      .then(setPinnedMessages)
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) handleError(error, 'Не удалось загрузить закрепы')
      })
      .finally(() => { if (!controller.signal.aborted) setPinsLoading(false) })
    return () => controller.abort()
  }, [api, token, selectedServerId, selectedChannelId, selectedChannel?.kind, handleError])

  useEffect(() => {
    if (!token) return
    const client = new RealtimeClient({
      token,
      baseUrl: realtimeBaseUrl,
      onStateChange: (state) => {
        setConnection(state)
        if (state === 'offline') {
          setOnlineByServer({})
          if (voiceSessionRef.current) {
            setVoiceError('Realtime-соединение потеряно. Подключитесь к голосовому каналу снова')
            closeVoiceLocally()
          }
        }
      },
      onUnauthorized: expire,
      onReady: () => { syncLatestRef.current(); syncPinsRef.current() },
      onSubscribed: () => { syncLatestRef.current(); syncPinsRef.current() },
      onMessage: (message) => {
        recordLastMessage(message.channel_id, message.id)
        setMessages((current) => {
          if (message.channel_id !== activeChannelRef.current || hasNewerRef.current || current.some((item) => item.id === message.id)) return current
          return [...current, message]
        })
      },
      onMessageUpdated: (message) => {
        if (message.channel_id !== activeChannelRef.current) return
        setMessages((current) => current.map((item) => item.id === message.id ? message : item))
        setPinnedMessages((current) => current.map((pin) => pin.message.id === message.id ? { ...pin, message } : pin))
      },
      onMessageDeleted: (event) => {
        if (event.channel_id !== activeChannelRef.current) return
        setMessages((current) => current.filter((message) => message.id !== event.message_id))
        setPinnedMessages((current) => current.filter((pin) => pin.message.id !== event.message_id))
      },
      onMessagePinned: (event) => {
        if (event.channel_id !== activeChannelRef.current) return
        setPinnedMessages((current) => upsertPinnedMessage(current, {
          message: event.message,
          pinned_by: event.pinned_by,
          pinned_at: event.pinned_at,
        }))
      },
      onMessageUnpinned: (event) => {
        if (event.channel_id === activeChannelRef.current) setPinnedMessages((current) => current.filter((pin) => pin.message.id !== event.message_id))
      },
      onPresenceSnapshot: (snapshot) => {
        const next: Record<number, number[]> = {}
        snapshot.servers.forEach((server) => { next[server.server_id] = server.online_user_ids })
        setOnlineByServer(next)
      },
      onPresenceUpdated: (update) => {
        setOnlineByServer((current) => {
          const users = new Set(current[update.server_id] ?? [])
          if (update.status === 'online') users.add(update.user_id)
          else users.delete(update.user_id)
          return { ...current, [update.server_id]: [...users] }
        })
      },
      onServerMemberJoined: (event) => {
        if (event.server_id !== activeServerRef.current) return
        setMembers((current) => current.some((member) => member.user_id === event.member.user_id)
          ? current.map((member) => member.user_id === event.member.user_id ? event.member : member)
          : [...current, event.member])
      },
      onServerMemberRoleUpdated: (event) => {
        if (event.server_id === activeServerRef.current) {
          setMembers((current) => current.map((member) => member.user_id === event.member.user_id ? event.member : member))
          setViewedProfileRole((current) => viewedProfileRef.current?.user_id === event.member.user_id ? event.member.role : current)
        }
        if (event.member.user_id === user?.id) {
          setServers((current) => current.map((server) => server.id === event.server_id ? { ...server, role: event.member.role } : server))
        }
      },
      onServerMemberRemoved: (event) => {
        if (event.user_id === user?.id && voiceSessionRef.current?.serverId === event.server_id) closeVoiceLocally()
        if (event.user_id === user?.id) {
          const remaining = serversRef.current.filter((server) => server.id !== event.server_id)
          serversRef.current = remaining
          setServers(remaining)
          if (activeServerRef.current === event.server_id) {
            setMessages([]); setPinnedMessages([]); setChannels([]); setMembers([]); setSelectedChannelId(null); setSelectedServerId(remaining[0]?.id ?? null)
          }
        } else if (event.server_id === activeServerRef.current) {
          setMembers((current) => current.filter((member) => member.user_id !== event.user_id))
        }
        setChannelReads((current) => {
          const next: Record<number, Record<number, ChannelRead>> = {}
          Object.entries(current).forEach(([channelId, reads]) => {
            const { [event.user_id]: _removed, ...remainingReads } = reads
            next[Number(channelId)] = remainingReads
          })
          channelReadsRef.current = next
          return next
        })
      },
      onServerDeleted: (event) => {
        if (voiceSessionRef.current?.serverId === event.server_id) closeVoiceLocally()
        setStreams((current) => Object.fromEntries(
          Object.entries(current).filter(([, value]) => value.server_id !== event.server_id),
        ))
        const remaining = serversRef.current.filter((server) => server.id !== event.server_id)
        serversRef.current = remaining
        setServers(remaining)
        if (activeServerRef.current === event.server_id) {
          setMessages([]); setPinnedMessages([]); setChannels([]); setMembers([]); setSelectedChannelId(null); setSelectedServerId(remaining[0]?.id ?? null)
        }
      },
      onInvitationReceived: (invite) => {
        if (invite.status !== 'pending') return
        setInvites((current) => current.some((item) => item.id === invite.id) ? current : [...current, invite])
      },
      onChannelCreated: (channel) => {
        if (channel.server_id !== activeServerRef.current) return
        setChannels((current) => {
          const existing = current.find((item) => item.id === channel.id)
          const nextChannel = {
            ...channel,
            last_message_id: channel.last_message_id ?? existing?.last_message_id ?? 0,
          }
          const next = [...current.filter((item) => item.id !== channel.id), nextChannel].sort((left, right) => left.position - right.position || left.id - right.id)
          channelsRef.current = next
          return next
        })
      },
      onChannelUpdated: (channel) => {
        if (channel.server_id !== activeServerRef.current) return
        setChannels((current) => {
          const next = current.map((item) => item.id === channel.id ? {
            ...item,
            ...channel,
            last_message_id: channel.last_message_id ?? item.last_message_id,
          } : item).sort((left, right) => left.position - right.position || left.id - right.id)
          channelsRef.current = next
          return next
        })
        setEditingChannel((current) => current?.id === channel.id ? { ...current, ...channel } : current)
      },
      onChannelDeleted: (event) => {
        if (voiceSessionRef.current?.channelId === event.channel_id) closeVoiceLocally()
        removeStream(event.channel_id)
        if (event.server_id !== activeServerRef.current) return
        const remaining = channelsRef.current.filter((channel) => channel.id !== event.channel_id)
        channelsRef.current = remaining
        setChannels(remaining)
        setChannelReads((current) => {
          const { [event.channel_id]: _removed, ...next } = current
          channelReadsRef.current = next
          return next
        })
        if (activeChannelRef.current === event.channel_id) {
          const nextChannel = remaining.find((channel) => channel.kind === 'text') ?? remaining[0] ?? null
          setMessages([]); setPinnedMessages([]); setHasMore(false); setHasNewer(false); setFocusedMessageId(null); setMessagesLoading(nextChannel?.kind === 'text'); setSelectedChannelId(nextChannel?.id ?? null)
        }
      },
      onReadSnapshot: (snapshot) => snapshot.reads.forEach(applyChannelRead),
      onChannelReadSnapshot: (snapshot) => replaceChannelReads(snapshot.channel_id, snapshot.reads),
      onChannelRead: applyChannelRead,
      onVoiceSnapshot: (snapshot) => {
        const next: Record<string, VoiceParticipant> = {}
        snapshot.participants.forEach((participant) => { next[participant.connection_id] = participant })
        setVoiceParticipants(next)
      },
      onVoiceJoined: (event) => {
        const pending = voiceSessionRef.current
        if (!pending || pending.serverId !== event.participant.server_id || pending.channelId !== event.participant.channel_id) return
        setVoiceParticipants((current) => {
          const next: Record<string, VoiceParticipant> = {}
          Object.values(current).forEach((participant) => {
            if (participant.server_id !== event.participant.server_id || participant.channel_id !== event.participant.channel_id) next[participant.connection_id] = participant
          })
          event.participants.forEach((participant) => { next[participant.connection_id] = participant })
          next[event.participant.connection_id] = event.participant
          return next
        })
        const joined = {
          ...pending,
          connectionId: event.participant.connection_id,
          selfMute: event.participant.self_mute,
          selfDeaf: event.participant.self_deaf,
        }
        voiceSessionRef.current = joined
        setVoiceSession(joined)
        setVoiceStatus('signaling')
      },
      onVoiceLeft: (event) => {
        removeVoiceParticipant(event.connection_id)
        const active = voiceSessionRef.current
        if (active?.connectionId === event.connection_id || (!active?.connectionId && active?.serverId === event.server_id && active.channelId === event.channel_id)) closeVoiceLocally()
      },
      onVoiceParticipantJoined: upsertVoiceParticipant,
      onVoiceParticipantLeft: (event) => removeVoiceParticipant(event.connection_id),
      onVoiceStateUpdated: (participant) => {
        upsertVoiceParticipant(participant)
        if (voiceSessionRef.current?.connectionId !== participant.connection_id) return
        const updated = { ...voiceSessionRef.current, selfMute: participant.self_mute, selfDeaf: participant.self_deaf }
        voiceSessionRef.current = updated
        setVoiceSession(updated)
        voiceMediaRef.current?.setState(updated.selfMute, updated.selfDeaf)
      },
      onVoiceWebRTCOffer: (offer) => { void voiceMediaRef.current?.acceptOffer(offer.sdp) },
      onVoiceICECandidate: (candidate) => { void voiceMediaRef.current?.addICECandidate(candidate) },
      onVoiceWebRTCClosed: (event) => {
        setVoiceError(voiceCloseMessage(event.reason))
        closeVoiceLocally()
      },
      onStreamSnapshot: (snapshot) => {
        const next: Record<number, ActiveStream> = {}
        snapshot.streams.forEach((value) => { next[value.channel_id] = value })
        setStreams(next)
      },
      onStreamStarted: (value) => {
        upsertStream(value)
        if (value.publisher_user_id === user?.id && value.mode === 'p2p' && streamRoleRef.current === 'publisher') {
          setStreamStatus('connected')
        }
      },
      onStreamUpdated: upsertStream,
      onStreamStopped: (event) => {
        removeStream(event.channel_id)
        if (voiceSessionRef.current?.channelId === event.channel_id && streamRoleRef.current) {
          if (event.reason && event.reason !== 'stream stopped by user') setStreamError(event.reason)
          closeStreamLocally()
        }
      },
      onStreamLeft: () => closeStreamLocally(),
      onStreamWatching: (event) => upsertStream(event.stream),
      onStreamViewerJoined: (viewer) => { void p2pStreamPublisherRef.current?.addViewer(viewer.connection_id) },
      onStreamViewerLeft: (viewer) => p2pStreamPublisherRef.current?.removeViewer(viewer.connection_id),
      onStreamWebRTCOffer: (offer) => { void serverStreamRef.current?.acceptOffer(offer.sdp) },
      onStreamICECandidate: (candidate) => { void serverStreamRef.current?.addICECandidate(candidate) },
      onStreamWebRTCClosed: (event) => {
        setStreamError(streamCloseMessage(event.reason))
        closeStreamLocally()
      },
      onStreamP2POffer: (event) => { void p2pStreamViewerRef.current?.acceptOffer(event.from_connection_id, event.sdp) },
      onStreamP2PAnswer: (event) => { void p2pStreamPublisherRef.current?.acceptAnswer(event.from_connection_id, event.sdp) },
      onStreamP2PRestart: (viewer) => p2pStreamPublisherRef.current?.restartViewer(viewer.connection_id),
      onStreamP2PICECandidate: (event) => {
        const candidate = {
          candidate: event.candidate,
          sdp_mid: event.sdp_mid,
          sdp_mline_index: event.sdp_mline_index,
          username_fragment: event.username_fragment,
        }
        if (streamRoleRef.current === 'publisher') void p2pStreamPublisherRef.current?.addICECandidate(event.from_connection_id, candidate)
        else void p2pStreamViewerRef.current?.addICECandidate(event.from_connection_id, candidate)
      },
      onError: (event) => {
        if (!event.request_id) return
        const streamKind = streamRequestIdsRef.current.get(event.request_id)
        streamRequestIdsRef.current.delete(event.request_id)
        if (streamKind && streamKind !== 'leave') {
          setStreamError(streamRealtimeError(event.message))
          closeStreamLocally()
          return
        }
        const kind = voiceRequestIdsRef.current.get(event.request_id)
        voiceRequestIdsRef.current.delete(event.request_id)
        if (!kind || kind === 'leave') return
        setVoiceError(voiceRealtimeError(event.message))
        closeVoiceLocally()
      },
    })
    realtimeRef.current = client
    client.connect()
    return () => { client.close(); realtimeRef.current = null }
  }, [token, realtimeBaseUrl, expire, user?.id, applyChannelRead, recordLastMessage, replaceChannelReads, closeStreamLocally, closeVoiceLocally, removeStream, removeVoiceParticipant, upsertStream, upsertVoiceParticipant])

  useEffect(() => {
    if (selectedServerId && selectedChannelId && selectedChannel?.kind === 'text') realtimeRef.current?.subscribe(selectedServerId, selectedChannelId)
    else realtimeRef.current?.unsubscribe()
  }, [selectedServerId, selectedChannelId, selectedChannel?.kind])

  const selectChannel = (id: number) => {
    const channel = channels.find((item) => item.id === id)
    setMessages([]); setPinnedMessages([]); setNextBeforeId(null); setHasMore(false); setHasNewer(false); setMessagesLoading(channel?.kind === 'text'); setSelectedChannelId(id); setMessageTarget(null); setFocusedMessageId(null); setMessagePanel(null); setMobileNav(false)
  }

  const joinVoiceChannel = async (channel: Channel) => {
    const client = realtimeRef.current
    if (!selectedServerId || channel.kind !== 'voice') return
    if (connection !== 'online' || !client) {
      setVoiceError('Сначала дождитесь подключения к realtime-серверу')
      return
    }
    if (!BrowserVoiceSession.supported()) {
      setVoiceError('Голосовые каналы требуют современный браузер и защищённое HTTPS-соединение')
      return
    }
    if (voiceSessionRef.current?.serverId === selectedServerId && voiceSessionRef.current.channelId === channel.id) {
      voiceMediaRef.current?.resumeAudio()
      return
    }

    if (voiceSessionRef.current) {
      trackVoiceRequest(client.leaveVoice(), 'leave')
      closeVoiceLocally()
    }

    setVoiceError('')
    setVoiceStatus('requesting')
    const initialMute = voicePreferencesRef.current.inputMode === 'push_to_talk'
    const pending: ActiveVoiceSession = {
      serverId: selectedServerId,
      channelId: channel.id,
      channelName: channel.name,
      connectionId: null,
      selfMute: initialMute,
      selfDeaf: false,
    }
    voiceSessionRef.current = pending
    setVoiceSession(pending)

    let media: BrowserVoiceSession
    const fail = (error: unknown) => {
      if (voiceMediaRef.current !== media) return
      const activeClient = realtimeRef.current
      if (voiceSessionRef.current?.connectionId) trackVoiceRequest(activeClient?.leaveVoice() ?? null, 'leave')
      setVoiceError(voiceErrorMessage(error))
      closeVoiceLocally()
    }
    media = new BrowserVoiceSession({
      onAnswer: (sdp) => trackVoiceRequest(realtimeRef.current?.answerVoice(sdp) ?? null, 'media'),
      onICECandidate: (candidate) => trackVoiceRequest(realtimeRef.current?.sendVoiceICECandidate(candidate) ?? null, 'media'),
      onConnectionStateChange: (state) => {
        if (voiceMediaRef.current !== media) return
        if (state === 'connected') {
          setVoiceError('')
          setVoiceStatus('connected')
        } else if (state === 'failed' || state === 'disconnected') {
          setVoiceStatus('signaling')
        }
      },
      onError: fail,
      onInputLevel: setVoiceInputLevel,
    })
    voiceMediaRef.current = media

    try {
      await media.start(initialMute, false, voicePreferencesRef.current)
      if (voiceMediaRef.current !== media || voiceSessionRef.current !== pending) return
      const requestId = client.joinVoice(selectedServerId, channel.id, initialMute, false)
      if (!trackVoiceRequest(requestId, 'join')) throw new Error('Realtime-соединение недоступно')
      setVoiceStatus('signaling')
    } catch (error) {
      fail(error)
    }
  }

  const leaveVoiceChannel = () => {
    if (!voiceSessionRef.current) return
    trackVoiceRequest(realtimeRef.current?.leaveVoice() ?? null, 'leave')
    setVoiceError('')
    closeVoiceLocally()
  }

  const updateStreamPreferences = (next: StreamPreferences) => {
    streamPreferencesRef.current = next
    setStreamPreferences(next)
    saveStreamPreferences(next)
  }

  const openStreamSettings = (channelId = voiceSessionRef.current?.channelId) => {
    const activeVoice = voiceSessionRef.current
    if (!activeVoice || !channelId || activeVoice.channelId !== channelId || voiceStatus !== 'connected') {
      setStreamError('Сначала подключитесь к этому голосовому каналу')
      return
    }
    if (streamRoleRef.current || streams[channelId]) return
    if (activeChannelRef.current !== channelId) selectChannel(channelId)
    setMobileNav(false)
    setStreamError('')
    setDialog('streamSettings')
  }

  const failStream = (error: unknown) => {
    const role = streamRoleRef.current
    if (role) {
      trackStreamRequest(
        role === 'publisher'
          ? realtimeRef.current?.stopStream() ?? null
          : realtimeRef.current?.leaveStream() ?? null,
        'leave',
      )
    }
    setStreamError(streamErrorMessage(error))
    closeStreamLocally()
  }

  const startStream = async () => {
    const activeVoice = voiceSessionRef.current
    const client = realtimeRef.current
    const channel = activeVoice
      ? channelsRef.current.find((item) => item.id === activeVoice.channelId && item.server_id === activeVoice.serverId)
      : null
    if (!client || !activeVoice || !channel || channel.kind !== 'voice' || voiceStatus !== 'connected') {

      setStreamError('Сначала подключитесь к этому голосовому каналу')
      return
    }
    if (streamRoleRef.current || streams[channel.id]) return

    setStreamError('')
    setStreamStatus('requesting')
    try {
      const preferences = streamPreferencesRef.current
      const codec = selectedStreamCodec(preferences)
      const capture = await captureScreen(preferences)
      if (streamRoleRef.current) {
        capture.getTracks().forEach((track) => track.stop())
        return
      }
      streamCaptureRef.current = capture
      streamRoleRef.current = 'publisher'
      setStreamRole('publisher')
      setStreamMedia(capture)
      setStreamStatus('signaling')

      const ended = () => {
        if (streamCaptureRef.current !== capture) return
        trackStreamRequest(realtimeRef.current?.stopStream() ?? null, 'leave')
        closeStreamLocally()
      }
      const videoTrack = capture.getVideoTracks()[0]
      if (!videoTrack) throw new Error('Источник экрана не предоставил видеодорожку')
      videoTrack.addEventListener('ended', ended, { once: true })

      const connectionState = (state: RTCPeerConnectionState) => {
        if (streamRoleRef.current !== 'publisher') return
        if (state === 'connected') setStreamStatus('connected')
        else if (state === 'connecting' || state === 'disconnected') setStreamStatus('signaling')
        else if (state === 'failed') setStreamStatus('signaling')
      }
      if (preferences.mode === 'server') {
        serverStreamRef.current = new BrowserServerStreamSession({
          localStream: capture,
          preferences,
          codec,
          onAnswer: (sdp) => trackStreamRequest(realtimeRef.current?.answerStream(sdp) ?? null, 'media'),
          onICECandidate: (candidate) => trackStreamRequest(realtimeRef.current?.sendStreamICECandidate(candidate) ?? null, 'media'),
          onConnectionStateChange: connectionState,
          onQualityStats: setStreamQuality,
          onError: failStream,
        })
      } else {
        p2pStreamPublisherRef.current = new BrowserP2PStreamPublisher({
          localStream: capture,
          preferences,
          codec,
          onOffer: (target, sdp) => trackStreamRequest(realtimeRef.current?.sendStreamP2POffer(target, sdp) ?? null, 'media'),
          onICECandidate: (target, candidate) => trackStreamRequest(realtimeRef.current?.sendStreamP2PICECandidate(target, candidate) ?? null, 'media'),
          onConnectionStateChange: connectionState,
          onQualityStats: setStreamQuality,
          onError: failStream,
        })
      }

      const requestId = client.startStream(
        activeVoice.serverId,
        channel.id,
        preferences.mode,
        codec,
        capture.getAudioTracks().length > 0,
      )
      if (!trackStreamRequest(requestId, 'start')) throw new Error('Realtime-соединение недоступно')
      if (preferences.includeAudio && capture.getAudioTracks().length === 0) {
        setStreamError('Выбранный источник не передал системный звук; видео продолжает транслироваться')
      }
    } catch (error) {
      failStream(error)
    }
  }

  const watchStream = () => {
    const activeVoice = voiceSessionRef.current
    const client = realtimeRef.current
    const channel = selectedChannel
    if (!client || !channel || channel.kind !== 'voice' || !selectedServerId ||
      activeVoice?.serverId !== selectedServerId || activeVoice.channelId !== channel.id ||
      voiceStatus !== 'connected') {

      setStreamError('Сначала подключитесь к этому голосовому каналу')
      return
    }
    const activeStream = streams[channel.id]
    if (!activeStream || streamRoleRef.current) return
    if (!supportedStreamCodecs().includes(activeStream.codec)) {
      setStreamError(`Кодек ${activeStream.codec.toUpperCase()} не поддерживается этим браузером`)
      return
    }

    setStreamError('')
    streamRoleRef.current = 'viewer'
    setStreamRole('viewer')
    setStreamStatus('signaling')
    const connectionState = (state: RTCPeerConnectionState) => {
      if (streamRoleRef.current !== 'viewer') return
      if (state === 'connected') setStreamStatus('connected')
      else if (state === 'connecting' || state === 'disconnected') setStreamStatus('signaling')
      else if (state === 'failed') setStreamStatus('signaling')
    }
    const remoteStream = (media: MediaStream) => setStreamMedia(media)
    if (activeStream.mode === 'server') {
      serverStreamRef.current = new BrowserServerStreamSession({
        preferences: streamPreferencesRef.current,
        codec: activeStream.codec,
        onAnswer: (sdp) => trackStreamRequest(realtimeRef.current?.answerStream(sdp) ?? null, 'media'),
        onICECandidate: (candidate) => trackStreamRequest(realtimeRef.current?.sendStreamICECandidate(candidate) ?? null, 'media'),
        onRemoteStream: remoteStream,
        onConnectionStateChange: connectionState,
        onQualityStats: setStreamQuality,
        onError: failStream,
      })
    } else {
      p2pStreamViewerRef.current = new BrowserP2PStreamViewer({
        onAnswer: (target, sdp) => trackStreamRequest(realtimeRef.current?.sendStreamP2PAnswer(target, sdp) ?? null, 'media'),
        onICECandidate: (target, candidate) => trackStreamRequest(realtimeRef.current?.sendStreamP2PICECandidate(target, candidate) ?? null, 'media'),
        onRestartRequest: (target) => trackStreamRequest(realtimeRef.current?.requestStreamP2PRestart(target) ?? null, 'media'),
        onRemoteStream: remoteStream,
        onConnectionStateChange: connectionState,
        onQualityStats: setStreamQuality,
        onError: failStream,
      })
    }
    if (!trackStreamRequest(client.watchStream(selectedServerId, channel.id), 'watch')) {
      failStream(new Error('Realtime-соединение недоступно'))
    }
  }

  const leaveStream = () => {
    const role = streamRoleRef.current
    if (!role) return
    const channelId = voiceSessionRef.current?.channelId
    trackStreamRequest(
      role === 'publisher'
        ? realtimeRef.current?.stopStream() ?? null
        : realtimeRef.current?.leaveStream() ?? null,
      'leave',
    )
    if (role === 'publisher' && channelId) removeStream(channelId)
    setStreamError('')
    closeStreamLocally()
  }

  const updateLocalVoiceState = (selfMute: boolean, selfDeaf: boolean) => {
    const active = voiceSessionRef.current
    if (!active) return
    const updated = { ...active, selfMute, selfDeaf }
    voiceSessionRef.current = updated
    setVoiceSession(updated)
    voiceMediaRef.current?.setState(selfMute, selfDeaf)
    voiceMediaRef.current?.resumeAudio()
    if (!trackVoiceRequest(realtimeRef.current?.updateVoiceState(selfMute, selfDeaf) ?? null, 'state')) {
      setVoiceError('Realtime-соединение недоступно')
      closeVoiceLocally()
    }
  }

  const updateVoicePreferences = (next: VoicePreferences) => {
    const previous = voicePreferencesRef.current
    voicePreferencesRef.current = next
    setVoicePreferences(next)
    saveVoicePreferences(next)
    void voiceMediaRef.current?.applyPreferences(next).catch((error: unknown) => {
      notify(voiceErrorMessage(error), 'error')
    })

    const active = voiceSessionRef.current
    if (active && previous.inputMode !== next.inputMode) {
      pushToTalkHeldRef.current = false
      updateLocalVoiceState(next.inputMode === 'push_to_talk', active.selfDeaf)
    }
  }

  const openVoiceSettings = () => {
    setDialog('voiceSettings')
    void refreshVoiceDevices(false)
  }

  useEffect(() => {
    const keyDown = (event: KeyboardEvent) => {
      const active = voiceSessionRef.current
      if (!active || isEditableKeyboardTarget(event.target)) return
      const preferences = voicePreferencesRef.current

      if (preferences.inputMode === 'push_to_talk' && shortcutMatches(event, preferences.pushToTalkShortcut)) {
        event.preventDefault()
        if (!pushToTalkHeldRef.current) {
          pushToTalkHeldRef.current = true
          updateLocalVoiceState(false, active.selfDeaf)
        }
        return
      }
      if (event.repeat) return
      if (shortcutMatches(event, preferences.muteShortcut)) {
        event.preventDefault()
        updateLocalVoiceState(!active.selfMute, active.selfDeaf)
      } else if (shortcutMatches(event, preferences.deafenShortcut)) {
        event.preventDefault()
        updateLocalVoiceState(active.selfMute, !active.selfDeaf)
      }
    }

    const releasePushToTalk = (event?: KeyboardEvent) => {
      if (!pushToTalkHeldRef.current) return
      const preferences = voicePreferencesRef.current
      const primaryCode = preferences.pushToTalkShortcut.split('+').at(-1)
      if (event && event.code !== primaryCode) return
      pushToTalkHeldRef.current = false
      const active = voiceSessionRef.current
      if (active) updateLocalVoiceState(true, active.selfDeaf)
    }
    const cancelPushToTalk = () => releasePushToTalk()

    window.addEventListener('keydown', keyDown)
    window.addEventListener('keyup', releasePushToTalk)
    window.addEventListener('blur', cancelPushToTalk)
    return () => {
      window.removeEventListener('keydown', keyDown)
      window.removeEventListener('keyup', releasePushToTalk)
      window.removeEventListener('blur', cancelPushToTalk)
    }
  }, [])

  const openActiveVoiceChannel = () => {
    const active = voiceSessionRef.current
    if (!active) return
    if (active.serverId === selectedServerId) {
      selectChannel(active.channelId)
      return
    }
    setMessages([]); setPinnedMessages([]); setChannels([]); setMembers([]); setNextBeforeId(null); setHasMore(false); setHasNewer(false); setMessagesLoading(false); setSelectedServerId(active.serverId); setSelectedChannelId(active.channelId); setMessageTarget(null); setFocusedMessageId(null); setMessagePanel(null); setMobileNav(false)
  }

  const openMessage = (channelId: number, messageId: number) => {
    const channel = channels.find((item) => item.id === channelId)
    if (!channel || channel.kind !== 'text') {
      notify('Канал для этого сообщения недоступен', 'error')
      return
    }
    setMessages([])
    setNextBeforeId(null)
    setHasMore(false)
    setHasNewer(false)
    setMessagesLoading(true)
    setMessageTarget({ channelId, messageId })
    setFocusedMessageId(messageId)
    setSelectedChannelId(channelId)
    setMessagePanel(null)
    setMobileNav(false)
  }

  const createChannel = async (name: string, kind: ChannelKind) => {
    if (!token || !selectedServerId) return
    const created = await api.channels.create(token, selectedServerId, name, kind)
    setMessages([]); setPinnedMessages([]); setNextBeforeId(null); setHasMore(false); setHasNewer(false); setMessagesLoading(kind === 'text'); setChannels((current) => [...current, { ...created, last_message_id: created.last_message_id ?? 0 }]); setSelectedChannelId(created.id)
    notify('Канал создан', 'success')
  }

  const openChannelSettings = (channel: Channel) => {
    setEditingChannel(channel)
    setDialog('channelSettings')
  }

  const downloadClientDiagnostics = async () => {
    if (!token) return
    await clientDiagnostics.flush()
    const payload = await api.diagnostics.list(token)
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const href = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = href
    anchor.download = `voxhold-diagnostics-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
    document.body.append(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(href)
    notify(`Диагностика выгружена: ${payload.events.length} событий`, 'success')
  }

  const renameChannel = async (name: string) => {
    if (!token || !selectedServerId || !editingChannel) return
    const updated = await api.channels.update(token, selectedServerId, editingChannel.id, name)
    setChannels((current) => current.map((channel) => channel.id === updated.id ? { ...channel, ...updated, last_message_id: updated.last_message_id ?? channel.last_message_id } : channel))
    setEditingChannel((current) => current ? { ...current, ...updated } : updated)
    notify('Канал переименован', 'success')
  }

  const deleteChannel = async () => {
    if (!token || !selectedServerId || !editingChannel) return
    await api.channels.delete(token, selectedServerId, editingChannel.id)
    const remaining = channels.filter((item) => item.id !== editingChannel.id)
    setChannels(remaining)
    if (selectedChannelId === editingChannel.id) {
      const nextChannel = remaining[0] ?? null
      setMessages([]); setPinnedMessages([]); setNextBeforeId(null); setHasMore(false); setHasNewer(false); setMessagesLoading(nextChannel?.kind === 'text'); setSelectedChannelId(nextChannel?.id ?? null)
    }
    setEditingChannel(null)
    notify('Канал удалён', 'success')
  }

  const openUserProfile = async (userId: number, role: ServerRole) => {
    if (!token) return
    if (userId === user?.id) {
      setDialog('profile')
      return
    }
    setViewedProfile(null)
    setViewedProfileRole(role)
    setViewedProfileError('')
    setViewedProfileLoading(true)
    setDialog('userProfile')
    try {
      setViewedProfile(await api.profile.byUser(token, userId))
    } catch (error) {
      setViewedProfileError(humanError(error))
      if (error instanceof ApiError && error.status === 401) expire()
    } finally {
      setViewedProfileLoading(false)
    }
  }

  const changeViewedMemberRole = async (role: Exclude<ServerRole, 'owner'>) => {
    if (!token || !selectedServerId || !viewedProfile) return
    const updated = await api.servers.updateMemberRole(token, selectedServerId, viewedProfile.user_id, role)
    setMembers((current) => current.map((member) => member.user_id === updated.user_id ? updated : member))
    setViewedProfileRole(updated.role)
    notify(`Роль ${updated.username} обновлена`, 'success')
  }

  const banViewedMember = async () => {
    if (!token || !selectedServerId || !viewedProfile) return
    await api.servers.banMember(token, selectedServerId, viewedProfile.user_id)
    setMembers((current) => current.filter((member) => member.user_id !== viewedProfile.user_id))
    setDialog(null)
    notify(`${viewedProfile.username} забанен на инстансе`, 'success')
  }

  const returnToLatest = async () => {
    if (!token || !selectedServerId || !selectedChannelId || newerRequestRef.current) return
    newerRequestRef.current = true
    setLoadingNewer(true)
    try {
      const page = await api.messages.list(token, selectedServerId, selectedChannelId)
      setMessageTarget(null)
      setFocusedMessageId(null)
      setMessages(page.messages)
      setNextBeforeId(page.pagination.next_before_id)
      setHasMore(page.pagination.has_more)
      setHasNewer(false)
    } catch (error) {
      handleError(error, 'Не удалось перейти к новым сообщениям')
    } finally {
      newerRequestRef.current = false
      setLoadingNewer(false)
    }
  }

  const sendMessage = async (content: string) => {
    if (!token || !selectedServerId || !selectedChannelId) return
    try {
      const created = await api.messages.create(token, selectedServerId, selectedChannelId, content)
      recordLastMessage(created.channel_id, created.id)
      if (hasNewerRef.current) await returnToLatest()
      else setMessages((current) => current.some((item) => item.id === created.id) ? current : [...current, created])
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) expire()
      throw new Error(humanError(error))
    }
  }

  const editMessage = async (messageId: number, content: string) => {
    if (!token || !selectedServerId || !selectedChannelId) return
    try {
      const updated = await api.messages.update(token, selectedServerId, selectedChannelId, messageId, content)
      setMessages((current) => current.map((message) => message.id === updated.id ? updated : message))
      setPinnedMessages((current) => current.map((pin) => pin.message.id === updated.id ? { ...pin, message: updated } : pin))
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) expire()
      throw new Error(humanError(error))
    }
  }

  const deleteMessage = async (messageId: number) => {
    if (!token || !selectedServerId || !selectedChannelId) return
    try {
      await api.messages.delete(token, selectedServerId, selectedChannelId, messageId)
      setMessages((current) => current.filter((message) => message.id !== messageId))
      setPinnedMessages((current) => current.filter((pin) => pin.message.id !== messageId))
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) expire()
      throw new Error(humanError(error))
    }
  }

  const toggleMessagePin = async (messageId: number, pinned: boolean) => {
    if (!token || !selectedServerId || !selectedChannelId) return
    try {
      if (pinned) {
        await api.messages.unpin(token, selectedServerId, selectedChannelId, messageId)
        setPinnedMessages((current) => current.filter((pin) => pin.message.id !== messageId))
      } else {
        const pin = await api.messages.pin(token, selectedServerId, selectedChannelId, messageId)
        setPinnedMessages((current) => upsertPinnedMessage(current, pin))
      }
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) expire()
      throw new Error(humanError(error))
    }
  }

  const loadOlder = async () => {
    if (!token || !selectedServerId || !selectedChannelId || !nextBeforeId || loadingOlder) return
    setLoadingOlder(true)
    try {
      const page = await api.messages.list(token, selectedServerId, selectedChannelId, nextBeforeId)
      setMessages((current) => [...page.messages.filter((older) => !current.some((item) => item.id === older.id)), ...current])
      setNextBeforeId(page.pagination.next_before_id); setHasMore(page.pagination.has_more)
    } catch (error) { handleError(error) } finally { setLoadingOlder(false) }
  }

  const loadNewer = async () => {
    if (!token || !selectedServerId || !selectedChannelId || !hasNewer || newerRequestRef.current) return
    const pivot = messages[messages.length - 1]
    if (!pivot) return
    newerRequestRef.current = true
    setLoadingNewer(true)
    try {
      const context = await api.messages.context(token, selectedServerId, selectedChannelId, pivot.id, 1, 50)
      const afterCount = context.messages.length - context.target_index - 1
      setMessages((current) => {
        const known = new Set(current.map((message) => message.id))
        const additions = context.messages.filter((message) => !known.has(message.id))
        return [...current, ...additions].sort((left, right) => left.id - right.id)
      })
      setHasNewer(afterCount >= 50)
      if (afterCount < 50) {
        const latest = await api.messages.list(token, selectedServerId, selectedChannelId)
        setMessages((current) => {
          const merged = new Map(current.map((message) => [message.id, message]))
          latest.messages.forEach((message) => merged.set(message.id, message))
          return [...merged.values()].sort((left, right) => left.id - right.id)
        })
      }
    } catch (error) {
      handleError(error, 'Не удалось загрузить следующие сообщения')
      setHasNewer(false)
    } finally {
      newerRequestRef.current = false
      setLoadingNewer(false)
    }
  }

  const respondInvite = async (invite: IncomingInvite, action: 'accept' | 'decline') => {
    if (!token) return
    if (action === 'accept') await api.invites.accept(token, invite.id)
    else await api.invites.decline(token, invite.id)
    setInvites((current) => current.filter((item) => item.id !== invite.id))
    if (action === 'accept') { await loadServers(); notify(`Вы присоединились к ${invite.server_name}`, 'success') }
  }

  const onlineUserIds = useMemo(() => new Set(selectedServerId ? (onlineByServer[selectedServerId] ?? []) : []), [onlineByServer, selectedServerId])
  const onlineMembers = useMemo(() => members.filter((member) => onlineUserIds.has(member.user_id)), [members, onlineUserIds])
  const offlineMembers = useMemo(() => members.filter((member) => !onlineUserIds.has(member.user_id)), [members, onlineUserIds])
  const voiceParticipantList = useMemo(() => Object.values(voiceParticipants), [voiceParticipants])
  const selectedVoiceParticipants = useMemo(() => selectedChannel?.kind === 'voice'
    ? voiceParticipantList.filter((participant) => participant.server_id === selectedChannel.server_id && participant.channel_id === selectedChannel.id)
    : [], [selectedChannel, voiceParticipantList])
  const activeVoiceChannel = voiceSession ? { id: voiceSession.channelId, name: voiceSession.channelName } : null
  const activeVoiceStream = voiceSession ? (streams[voiceSession.channelId] ?? null) : null
  const streamChannelIsOpen = !!voiceSession && selectedServerId === voiceSession.serverId && selectedChannelId === voiceSession.channelId && selectedChannel?.kind === 'voice'
  const canChangeViewedRole = !!selectedServer && selectedServer.role === 'owner' && !!viewedProfile && viewedProfile.user_id !== user?.id && viewedProfileRole !== 'owner'
  const canBanViewedMember = !!selectedServer && !!viewedProfile && viewedProfile.user_id !== user?.id && viewedProfileRole !== 'owner' && (selectedServer.role === 'owner' || (selectedServer.role === 'admin' && viewedProfileRole === 'member'))

  if (initialLoading) return <div className="app-loader"><Brand/><div className="loader-line"><i/></div><span>Собираем ваши комнаты…</span></div>

  return (
    <main className={`workspace ${workspaceLayout.membersOpen ? 'workspace--members-open' : ''}`} style={workspaceLayout.style}>
      <aside className={`channel-sidebar ${mobileNav ? 'is-mobile-open' : ''}`}>
        {selectedServer ? <>
          <header className="server-header"><div><span className="eyebrow">ПРОСТРАНСТВО</span><h2>{selectedServer.name}</h2></div><button className="icon-button" onClick={() => setDialog('settings')} aria-label="Настройки сервера"><Icon name="settings"/></button></header>
          <div className="channel-scroll">
            <ChannelGroup title="Текстовые каналы" canAdd={!!canManage} onAdd={() => setDialog('channel')}>
              {channels.filter((channel) => channel.kind === 'text').map((channel) => <ChannelButton key={channel.id} channel={channel} active={selectedChannelId === channel.id} unread={channelHasUnreadMessages(channel, user ? channelReads[channel.id]?.[user.id] : undefined)} canManage={!!canManage} onSelect={() => selectChannel(channel.id)} onEdit={() => openChannelSettings(channel)}/>) }
            </ChannelGroup>
            <ChannelGroup title="Голосовые каналы" canAdd={!!canManage} onAdd={() => setDialog('channel')}>
              {channels.filter((channel) => channel.kind === 'voice').map((channel) => <ChannelButton key={channel.id} channel={channel} active={selectedChannelId === channel.id} canManage={!!canManage} canShare={voiceSession?.serverId === channel.server_id && voiceSession.channelId === channel.id && voiceStatus === 'connected' && !streams[channel.id] && !streamRole} participants={voiceParticipantList.filter((participant) => participant.server_id === channel.server_id && participant.channel_id === channel.id)} members={members} currentVoiceConnectionId={voiceSession?.connectionId ?? null} onSelect={() => selectChannel(channel.id)} onEdit={() => openChannelSettings(channel)} onShare={() => openStreamSettings(channel.id)} onOpenProfile={(userId, role) => void openUserProfile(userId, role)}/>) }
            </ChannelGroup>
            {channels.length === 0 && <button className="sidebar-empty" onClick={() => canManage && setDialog('channel')}><span><Icon name="add"/></span><b>Создайте первый канал</b><small>Начните с общего чата</small></button>}
          </div>
          {voiceSession && <VoiceDock channelName={voiceSession.channelName} status={voiceStatus} selfMute={voiceSession.selfMute} selfDeaf={voiceSession.selfDeaf} onOpen={openActiveVoiceChannel} onToggleMute={() => updateLocalVoiceState(!voiceSession.selfMute, voiceSession.selfDeaf)} onToggleDeaf={() => updateLocalVoiceState(voiceSession.selfMute, !voiceSession.selfDeaf)} onLeave={leaveVoiceChannel}/>} 
          <div className="user-dock"><button className="user-dock__profile" onClick={() => setDialog('profile')}><Avatar name={user?.username ?? 'V'} online/><span><b>{user?.username}</b><small><i className={`connection-dot connection-dot--${connection}`}/>{connection === 'online' ? 'В сети' : connection === 'connecting' ? 'Подключение' : 'Не в сети'}</small></span></button><button className="icon-button" onClick={() => setDialog('profile')} title="Настройки профиля" aria-label="Настройки профиля"><Icon name="people"/></button><button className="icon-button" onClick={openVoiceSettings} title="Настройки голоса" aria-label="Настройки голоса"><Icon name="settings"/></button><button className="icon-button" onClick={() => setDialog('logout')} title="Выйти" aria-label="Выйти"><Icon name="logout"/></button></div>
        </> : <div className="sidebar-no-server"><Brand/><p>У вас нет доступа к этому пространству.</p></div>}
        <div className="workspace-resizer workspace-resizer--channels" role="separator" aria-label="Изменить ширину списка каналов" aria-orientation="vertical" tabIndex={0} onPointerDown={(event) => workspaceLayout.beginResize('channels', event)} onKeyDown={(event) => workspaceLayout.handleResizeKey('channels', event)} onDoubleClick={() => workspaceLayout.resetPanel('channels')}/>
      </aside>

      <section className="content-shell">
        {!selectedServer && instance?.initialized && <div className="instance-access-empty"><div className="welcome-art"><span>V</span><i/><i/><i/></div><span className="eyebrow">ДОСТУП ОГРАНИЧЕН</span><h1>Нужно приглашение</h1><p>Ваш аккаунт существует, но пока не состоит в пространстве этого инстанса. Примите приглашение, чтобы войти.</p><button className="button button--primary button--large" onClick={() => setDialog('invites')}><Icon name="inbox"/>Приглашения</button></div>}
        <header className="content-header">
          <div className="content-header__title"><button className="icon-button mobile-menu" onClick={() => setMobileNav((value) => !value)} aria-label="Меню"><Icon name="menu"/></button>{selectedChannel ? <><Icon name={selectedChannel.kind === 'text' ? 'hash' : 'volume'}/><h1>{selectedChannel.name}</h1><span className="header-divider"/><p>{selectedChannel.kind === 'text' ? 'Всё важное — здесь' : 'Голосовая комната'}</p></> : <h1>{selectedServer?.name ?? 'Voxhold'}</h1>}</div>
          <div className="content-header__actions">
            {selectedServer && <button className={`header-action header-action--inbox ${invites.length ? 'has-badge' : ''}`} onClick={() => setDialog('invites')} title="Входящие приглашения"><Icon name="inbox"/><span>Приглашения</span>{invites.length > 0 && <b>{invites.length}</b>}</button>}
            {selectedServer && <button className={`header-action ${messagePanel === 'search' ? 'is-active' : ''}`} onClick={() => setMessagePanel((current) => current === 'search' ? null : 'search')} title="Поиск по серверу"><Icon name="search"/><span>Поиск</span></button>}
            {selectedChannel?.kind === 'text' && <button className={`header-action header-action--pins ${messagePanel === 'pins' ? 'is-active' : ''}`} onClick={() => setMessagePanel((current) => current === 'pins' ? null : 'pins')} title="Закреплённые сообщения"><Icon name="pin"/><span>Закрепы</span>{pinnedMessages.length > 0 && <b>{pinnedMessages.length}</b>}</button>}
            <button className="header-action theme-toggle" onClick={toggleTheme} title={theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'} aria-label={theme === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему'}><Icon name={theme === 'dark' ? 'sun' : 'moon'}/><span>{theme === 'dark' ? 'Светлая' : 'Тёмная'}</span></button>
            {selectedServer && canManage && <button className="header-action" onClick={() => setDialog('invite')}><Icon name="userPlus"/><span>Пригласить</span></button>}
            <button className={`header-action members-toggle ${workspaceLayout.membersOpen ? 'is-active' : ''}`} onClick={workspaceLayout.toggleMembers} title={workspaceLayout.membersOpen ? 'Скрыть участников' : 'Показать участников'}><Icon name="people"/><span>{members.length}</span></button>
          </div>
        </header>

        {selectedServer ? selectedChannel?.kind === 'voice' ? <VoicePanel channel={selectedChannel} activeChannel={activeVoiceChannel} participants={selectedVoiceParticipants} members={members} currentUserId={user?.id ?? 0} connectionStatus={voiceSession?.channelId === selectedChannel.id ? voiceStatus : 'idle'} realtimeOnline={connection === 'online'} selfMute={voiceSession?.channelId === selectedChannel.id ? voiceSession.selfMute : false} selfDeaf={voiceSession?.channelId === selectedChannel.id ? voiceSession.selfDeaf : false} error={voiceError} onJoin={() => joinVoiceChannel(selectedChannel)} onLeave={leaveVoiceChannel} onToggleMute={() => voiceSession && updateLocalVoiceState(!voiceSession.selfMute, voiceSession.selfDeaf)} onToggleDeaf={() => voiceSession && updateLocalVoiceState(voiceSession.selfMute, !voiceSession.selfDeaf)} onOpenProfile={(userId, role) => void openUserProfile(userId, role)} stream={streams[selectedChannel.id] ?? null} streamStatus={voiceSession?.channelId === selectedChannel.id ? streamStatus : 'idle'} streamError={voiceSession?.channelId === selectedChannel.id ? streamError : ''} streamMedia={voiceSession?.channelId === selectedChannel.id && !streamExpanded ? streamMedia : null} streamPreferences={streamPreferences} streamQuality={streamQuality} onStreamPreferencesChange={updateStreamPreferences} onOpenStreamSettings={() => openStreamSettings(selectedChannel.id)} onWatchStream={watchStream} onLeaveStream={leaveStream} onExpandStream={() => setStreamExpanded(true)}/> : <ChatPanel channel={selectedChannel} messages={messages} loading={messagesLoading} loadingOlder={loadingOlder} hasMore={hasMore} loadingNewer={loadingNewer} hasNewer={hasNewer} currentUserId={user?.id ?? 0} canManage={!!canManage} members={members} pinnedMessageIds={pinnedMessageIds} focusedMessageId={focusedMessageId} channelReads={selectedChannelId ? (channelReads[selectedChannelId] ?? {}) : {}} onLoadOlder={loadOlder} onLoadNewer={loadNewer} onReturnToLatest={returnToLatest} onReadThrough={markReadThrough} onSend={sendMessage} onEdit={editMessage} onDelete={deleteMessage} onTogglePin={toggleMessagePin} onOpenProfile={(userId, _username, role) => void openUserProfile(userId, role)}/> : <div className="welcome-empty"><div className="welcome-art"><span>V</span><i/><i/><i/></div><span className="eyebrow">ВАШЕ ПРОСТРАНСТВО</span><h1>Начните с сервера</h1><p>Создайте место для команды, друзей или проекта. Каналы и разговоры приложатся.</p><button className="button button--primary button--large" onClick={() => setDialog('server')}><Icon name="add"/>Создать сервер</button></div>}
        {selectedServer && token && <MessageSearchPanel open={messagePanel === 'search'} api={api} token={token} serverId={selectedServer.id} onClose={() => setMessagePanel(null)} onOpenMessage={openMessage}/>} 
        {selectedChannel?.kind === 'text' && <PinnedMessagesPanel open={messagePanel === 'pins'} pins={pinnedMessages} loading={pinsLoading} canManage={!!canManage} onClose={() => setMessagePanel(null)} onOpenMessage={openMessage} onUnpin={(messageId) => toggleMessagePin(messageId, true)}/>} 
        {messagePanel && <button className="message-panel-scrim" aria-label="Закрыть панель" onClick={() => setMessagePanel(null)}/>} 
      </section>

      {selectedServer && workspaceLayout.membersOpen && <aside className="members-sidebar is-open">
        <div className="workspace-resizer workspace-resizer--members" role="separator" aria-label="Изменить ширину списка участников" aria-orientation="vertical" tabIndex={0} onPointerDown={(event) => workspaceLayout.beginResize('members', event)} onKeyDown={(event) => workspaceLayout.handleResizeKey('members', event)} onDoubleClick={() => workspaceLayout.resetPanel('members')}/>
        <header><span className="eyebrow">УЧАСТНИКИ · {members.length}</span><button className="icon-button members-close" onClick={workspaceLayout.closeMembers} title="Скрыть участников"><Icon name="close"/></button></header>
        <div className="members-sidebar__scroll"><MemberGroup title={`В сети — ${onlineMembers.length}`} members={onlineMembers} online onOpenProfile={(member) => void openUserProfile(member.user_id, member.role)}/>
        <MemberGroup title={`Не в сети — ${offlineMembers.length}`} members={offlineMembers} online={false} onOpenProfile={(member) => void openUserProfile(member.user_id, member.role)}/></div>
      </aside>}

      {mobileNav && <button className="mobile-scrim" aria-label="Закрыть меню" onClick={() => setMobileNav(false)}/>} 

      {streamRole && streamMedia && voiceSession && (streamExpanded || !streamChannelIsOpen) && <PersistentStreamPlayer
        mode={streamExpanded ? 'expanded' : 'mini'}
        stream={activeVoiceStream}
        role={streamRole}
        status={streamStatus}
        media={streamMedia}
        channelName={voiceSession.channelName}
        preferences={streamPreferences}
        quality={streamQuality}
        onPreferencesChange={updateStreamPreferences}
        onExpand={() => setStreamExpanded(true)}
        onCollapse={() => setStreamExpanded(false)}
        onLeave={leaveStream}
      />}

      <CreateChannelDialog open={dialog === 'channel'} onClose={() => setDialog(null)} onSubmit={createChannel}/>
      <ChannelSettingsDialog open={dialog === 'channelSettings'} onClose={() => { setDialog(null); setEditingChannel(null) }} channel={editingChannel} onRename={renameChannel} onRemove={deleteChannel}/>
      <InviteUserDialog open={dialog === 'invite'} onClose={() => setDialog(null)} server={selectedServer} onSubmit={async (username) => { if (token && selectedServerId) { await api.invites.create(token, selectedServerId, username); notify('Приглашение отправлено', 'success') } }} onCreateLink={async (input) => { if (!token || !selectedServerId) throw new Error('Сервер не выбран'); const link = await api.inviteLinks.create(token, selectedServerId, input); notify('Ссылка создана', 'success'); return link }}/>
      <InvitesDialog open={dialog === 'invites'} onClose={() => setDialog(null)} invites={invites} onRespond={respondInvite}/>
      <ProfileDialog open={dialog === 'profile'} onClose={() => setDialog(null)} profile={profile} onSubmit={async (patch) => { if (!token) return; const updated = await api.profile.update(token, patch); setProfile(updated); notify('Профиль обновлён', 'success') }}/>
      <MemberProfileDialog open={dialog === 'userProfile'} onClose={() => setDialog(null)} profile={viewedProfile} role={viewedProfileRole} loading={viewedProfileLoading} error={viewedProfileError} canChangeRole={canChangeViewedRole} canBan={canBanViewedMember} onRoleChange={changeViewedMemberRole} onBan={banViewedMember}/>
      <VoiceSettingsDialog open={dialog === 'voiceSettings'} onClose={() => setDialog(null)} preferences={voicePreferences} devices={voiceDevices} inputLevel={voiceInputLevel} voiceActive={!!voiceSession} loadingDevices={voiceDevicesLoading} onChange={updateVoicePreferences} onRefreshDevices={refreshVoiceDevices}/>
      <StreamSettingsDialog open={dialog === 'streamSettings'} busy={streamStatus !== 'idle'} preferences={streamPreferences} onChange={updateStreamPreferences} onClose={() => setDialog(null)} onStart={() => { setDialog(null); void startStream() }}/>
      <LogoutConfirmDialog open={dialog === 'logout'} onClose={() => setDialog(null)} onConfirm={logout}/>
      <ServerSettingsDialog open={dialog === 'settings'} onClose={() => setDialog(null)} server={selectedServer} onRename={async (name) => { if (!token || !selectedServer) return; const updated = await api.servers.update(token, selectedServer.id, name); setServers((current) => current.map((item) => item.id === selectedServer.id ? { ...item, ...updated } : item)); notify('Название обновлено', 'success') }} onDeleteAccount={async () => { if (!token) return; await api.account.delete(token); expire() }} onDownloadDiagnostics={downloadClientDiagnostics}/>
    </main>
  )
}

function ChannelGroup({ title, canAdd, onAdd, children }: { title: string; canAdd: boolean; onAdd: () => void; children: React.ReactNode }) {
  return <section className="channel-group"><header><span>{title}</span>{canAdd && <button onClick={onAdd} aria-label={`Добавить: ${title}`}><Icon name="add" size={15}/></button>}</header>{children}</section>
}

function ChannelButton({ channel, active, unread = false, canManage, canShare = false, participants = [], members = [], currentVoiceConnectionId = null, onSelect, onEdit, onShare, onOpenProfile }: { channel: Channel; active: boolean; unread?: boolean; canManage: boolean; canShare?: boolean; participants?: VoiceParticipant[]; members?: ServerMember[]; currentVoiceConnectionId?: string | null; onSelect: () => void; onEdit: () => void; onShare?: () => void; onOpenProfile?: (userId: number, role: ServerRole) => void }) {
  return <div className="channel-entry"><div className={`channel-row ${active ? 'is-active' : ''} ${unread ? 'is-unread' : ''}`}><button className="channel-row__main" onClick={onSelect} aria-label={`${channel.name}${unread ? ', есть непрочитанные сообщения' : ''}`}><Icon name={channel.kind === 'text' ? 'hash' : 'volume'} size={17}/><span>{channel.name}</span>{unread && <b className="channel-row__unread" aria-hidden="true"/>}{channel.kind === 'voice' && participants.length > 0 && <i>{participants.length}</i>}</button>{canShare && <button className="channel-row__share" onClick={onShare} title="Поделиться экраном" aria-label={`Поделиться экраном в ${channel.name}`}><Icon name="monitor" size={14}/></button>}{canManage && <button className="channel-row__edit" onClick={onEdit} title="Изменить канал" aria-label={`Изменить ${channel.name}`}><Icon name="edit" size={14}/></button>}</div>{channel.kind === 'voice' && participants.length > 0 && <div className="channel-voice-users">{participants.map((participant) => {
    const member = members.find((item) => item.user_id === participant.user_id)
    const username = member?.username ?? `Пользователь #${participant.user_id}`
    return <button key={participant.connection_id} className={participant.connection_id === currentVoiceConnectionId ? 'is-me' : ''} onClick={() => onOpenProfile?.(participant.user_id, member?.role ?? 'member')}><Avatar name={username} size="small"/><span>{username}</span>{participant.self_deaf ? <Icon name="headphones" size={12}/> : participant.self_mute ? <Icon name="mic" size={12}/> : <i/>}</button>
  })}</div>}</div>
}

function VoiceDock({ channelName, status, selfMute, selfDeaf, onOpen, onToggleMute, onToggleDeaf, onLeave }: { channelName: string; status: VoiceConnectionStatus; selfMute: boolean; selfDeaf: boolean; onOpen: () => void; onToggleMute: () => void; onToggleDeaf: () => void; onLeave: () => void }) {
  return <section className="voice-dock"><button className="voice-dock__room" onClick={onOpen}><span><i className={status === 'connected' ? 'is-connected' : ''}/><b>{status === 'connected' ? 'Голос подключён' : 'Подключение…'}</b></span><small><Icon name="volume" size={12}/>{channelName}</small></button><div><button className={selfMute ? 'is-disabled' : ''} onClick={onToggleMute} title={selfMute ? 'Включить микрофон' : 'Выключить микрофон'}><Icon name="mic" size={16}/></button><button className={selfDeaf ? 'is-disabled' : ''} onClick={onToggleDeaf} title={selfDeaf ? 'Включить звук' : 'Выключить звук'}><Icon name="headphones" size={16}/></button><button className="is-leave" onClick={onLeave} title="Отключиться"><Icon name="logout" size={16}/></button></div></section>
}

function MemberGroup({ title, members, online, onOpenProfile }: { title: string; members: ServerMember[]; online: boolean; onOpenProfile: (member: ServerMember) => void }) {
  if (!members.length) return null
  return <section className="member-group"><h3>{title}</h3>{members.map((member) => <button className={`member-row member-row--${member.role}`} key={member.user_id} onClick={() => onOpenProfile(member)}><Avatar name={member.username} size="small" online={online}/><span><b className={`member-name member-name--${member.role}`}>{member.username}</b><small><span className={`role-dot role-dot--${member.role}`}/>{roleMeta[member.role].label}{!online && ` · ${relativeTime(member.last_seen_at)}`}</small></span>{member.country_code && <em>{member.country_code}</em>}</button>)}</section>
}

function voiceRealtimeError(message: string) {
  const translations: Record<string, string> = {
    'voice channel is full': 'Голосовой канал заполнен',
    'not allowed to join voice channel': 'Недостаточно прав для подключения к голосовому каналу',
    'channel is not a voice channel': 'Выбранный канал не является голосовым',
    'failed to start voice media session': 'Сервер не смог запустить голосовую сессию',
    'WebRTC voice session is not active': 'Голосовая сессия уже завершена',
    'invalid WebRTC signaling payload': 'Ошибка согласования WebRTC-соединения',
  }
  return translations[message] ?? message
}

function streamRealtimeError(message: string) {
  const translations: Record<string, string> = {
    'join the same voice channel first': 'Сначала подключитесь к этому голосовому каналу',
    'stream is already active': 'В этом канале уже идёт трансляция',
    'stream is not available': 'Трансляция уже завершена или недоступна',
    'stream viewer limit reached': 'Достигнут лимит зрителей трансляции',
    'P2P stream peer is not allowed': 'Сервер отклонил небезопасный P2P-сигнал',
    'failed to start stream media session': 'Сервер не смог запустить передачу трансляции',
    'failed to start stream viewer session': 'Сервер не смог подключить зрителя',
    'stream WebRTC session is not active': 'Медиасессия трансляции уже завершена',
    'invalid stream WebRTC signaling payload': 'Ошибка согласования трансляции',
  }
  return translations[message] ?? message
}

function streamCloseMessage(reason: string) {
  const translations: Record<string, string> = {
    'stream video bitrate limit exceeded': 'Трансляция превысила допустимые 16 Мбит/с видео',
    'stream audio bitrate limit exceeded': 'Звук трансляции превысил допустимые 320 Кбит/с',
    'stream WebRTC connection failed': 'WebRTC-соединение трансляции потеряно',
    'stream signaling connection was lost': 'Realtime-соединение трансляции потеряно',
    'duplicate stream media track': 'Источник отправил лишнюю медиадорожку',
  }
  return translations[reason] ?? reason
}
