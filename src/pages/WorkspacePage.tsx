import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { useAuth } from '../auth/AuthContext'
import { useServerMembers } from '../hooks/useServerMembers'
import { AvatarProvider } from '../components/AvatarProvider'
import { CallControls } from '../components/CallControls'
import { useCallRecordings } from '../hooks/useCallRecordings'
import { Avatar } from '../components/Avatar'
import { MembersSidebar } from '../components/MembersSidebar'
import { Brand } from '../components/Brand'
import { ChatPanel } from '../components/ChatPanel'
import { VoiceSettingsDialog } from '../components/LazyWorkspaceDialogs'
import { WorkspaceDialogBoundary } from '../components/WorkspaceDialogBoundary'
import { WorkspaceContentBoundary } from '../components/WorkspaceContentBoundary'
import { MemberCard } from '../components/LazyWorkspaceDialogs'
import { CommunityProvider, CommunityNavigation, CommunitySidebar, CommunityContent, openCommunityChannels } from '../components/Community'
import { NewsComments } from '../components/NewsComments'
import { NewsChannelSettings } from '../components/NewsChannelSettings'
import { ContextMenu, type ContextMenuItem, type ContextMenuState } from '../components/ContextMenu'
import { Icon } from '../components/Icon'
import { ModalLoading } from '../components/ModalLoading'
import type { ReactorLoader } from '../components/MessageReactions'
import { MessageSearchPanel, PinnedMessagesPanel } from '../components/LazyWorkspaceDialogs'
import { MessageNotificationCenter } from '../services/messageNotifications'
import { MessageNotifications } from '../components/MessageNotifications'
import type { PersistentStreamPlayer as StreamPlayer } from '../components/PersistentStreamPlayer'
import type { ComponentProps } from 'react'
import { useToast } from '../components/Toast'
import type { VoiceConnectionStatus } from '../components/VoicePanel'
import { VoicePanel } from '../components/LazyWorkspaceDialogs'
import {
  ChannelSettingsDialog,
  ConfirmDialog,
  CreateChannelDialog,
  InviteUserDialog,
  LogoutConfirmDialog,
  MemberProfileDialog,
  ProfileDialog,
  ServerSettingsDialog,
} from '../components/LazyWorkspaceDialogs'
import type { Message, MessageReply, MessageNotification, NotificationSettings, ActiveStream, Channel, ChannelKind, ChannelRead, InstanceMetadata, PinnedMessage, Profile, RecordingStorage, Server, ServerMember, ServerRole, StreamDynamicRange, StreamRendition, VoiceParticipant } from '../domain/types'
import { useChannelHistory } from '../hooks/useChannelHistory'
import { createMediaActivity, MediaActivityProvider, useSpeakingUsers } from '../components/MediaActivity'
import { useWorkspaceLayout } from '../hooks/useWorkspaceLayout'
import { newerMessage, resolveReplyReferences, withReactions } from '../lib/messageRevisions'
import { pickDefaultChannel } from '../lib/channels'
import { channelHasUnreadMessages } from '../lib/channelUnread'
import { mergeServerMember } from '../lib/serverMembers'
import { downloadBlob } from '../lib/downloadBlob'
import { humanError } from '../lib/format'
import type { VoxholdApi } from '../services/api'
import { RealtimeClient, type ConnectionState } from '../services/realtime'
import type { BrowserP2PStreamPublisher, BrowserP2PStreamViewer, BrowserServerStreamSession, StreamQualityStats } from '../services/stream'
import { streamErrorMessage } from '../services/streamErrors'
import type { StreamAudioGain } from '../services/streamAudioGain'
import type { StreamPublishPipeline } from '../services/hdrPipeline'
import { loadStreamPreferences, saveStreamPreferences, type StreamPreferences } from '../services/streamSettings'
import { BrowserVoiceSession, enumerateVoiceDevices, voiceCloseMessage, voiceErrorMessage } from '../services/voice'
import { BrowserVoiceInput } from '../services/voiceInput'
import { RetryBudget, SignallingRecoveryCoordinator } from '../services/mediaRecovery'
import { uiSounds, type UISound } from '../services/uiSounds'
import { createWebRTCConfigService } from '../services/webrtcConfig'
import { isEditableKeyboardTarget, loadUserVolumes, loadVoicePreferences, saveUserVolumes, saveVoicePreferences, shortcutMatches, type VoicePreferences } from '../services/voiceSettings'
import { clientDiagnostics } from '../platform/clientDiagnostics'
import { useTheme } from '../theme/ThemeContext'

const LazyStreamPlayer = lazy(() => import('../components/PersistentStreamPlayer').then((module) => ({ default: module.PersistentStreamPlayer })))
function PersistentStreamPlayer(props: ComponentProps<typeof StreamPlayer>) { return <Suspense fallback={null}><LazyStreamPlayer {...props}/></Suspense> }
const ForwardMessageDialog = lazy(() => import('../components/ForwardMessageDialog').then((module) => ({ default: module.ForwardMessageDialog })))
const ChannelNotificationsDialog = lazy(() => import('../components/ChannelNotificationsDialog').then((module) => ({ default: module.ChannelNotificationsDialog })))
const ChannelAccessSettings = lazy(() => import('../components/ChannelAccessSettings').then((module) => ({ default: module.ChannelAccessSettings })))
const loadRecordingsDialog = () => import('../components/RecordingsDialog').then((module) => ({ default: module.RecordingsDialog }))
const RecordingsDialog = lazy(loadRecordingsDialog)
const StreamSettingsDialog = lazy(() => import('../components/StreamSettingsDialog').then((module) => ({ default: module.StreamSettingsDialog })))

type Dialog = 'server' | 'channel' | 'channelSettings' | 'invite' | 'profile' | 'userProfile' | 'settings' | 'voiceSettings' | 'streamSettings' | 'logout' | null
type MessagePanel = 'search' | 'pins' | null
type MessageTarget = { channelId: number; messageId: number }
type ActiveVoiceSession = { serverId: number; channelId: number; channelName: string; connectionId: string | null; selfMute: boolean; selfDeaf: boolean }
type StreamStatus = 'idle' | 'requesting' | 'signaling' | 'connected'

interface WorkspaceProps {
  api: VoxholdApi
  realtimeBaseUrl?: string
}

function upsertPinnedMessage(current: PinnedMessage[], value: PinnedMessage) {
  const existing = current.find((pin) => pin.message.id === value.message.id)
  value = { ...value, message: newerMessage(existing?.message, value.message) }
  return [value, ...current.filter((pin) => pin.message.id !== value.message.id)]
    .sort((left, right) => right.pinned_at - left.pinned_at || right.message.id - left.message.id)
}

export function WorkspacePage({ api, realtimeBaseUrl }: WorkspaceProps) {
  const { user, token, logout, expire } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const notify = useToast()
  const workspaceLayout = useWorkspaceLayout()
  const [instance, setInstance] = useState<InstanceMetadata | null>(null)
  const [corsOrigins, setCorsOrigins] = useState<string[]>([])
  const [corsOriginsLoading, setCorsOriginsLoading] = useState(false)
  const [recordingStorage, setRecordingStorage] = useState<RecordingStorage | null>(null)
  const [servers, setServers] = useState<Server[]>([])
  const [selectedServerId, setSelectedServerId] = useState<number | null>(null)
  const [channels, setChannels] = useState<Channel[]>([])
  const [notificationChannel, setNotificationChannel] = useState<Channel | null>(null)
  const [notificationSettings, setNotificationSettings] = useState<NotificationSettings | null>(null)
  const [selectedChannelId, setSelectedChannelId] = useState<number | null>(null)
  const [rosterRevision, setRosterRevision] = useState(0)
  const [pinnedMessages, setPinnedMessages] = useState<PinnedMessage[]>([])
  const [pinsLoading, setPinsLoading] = useState(false)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [initialLoading, setInitialLoading] = useState(true)
  const [connection, setConnection] = useState<ConnectionState>('connecting')
  const [dialog, setDialog] = useState<Dialog>(null)
  const [messagePanel, setMessagePanel] = useState<MessagePanel>(null)
  const [messageTarget, setMessageTarget] = useState<MessageTarget | null>(null)
  const [messageFocusVersion, setMessageFocusVersion] = useState(0)
  const [focusedMessageId, setFocusedMessageId] = useState<number | null>(null)
  const [onlineByServer, setOnlineByServer] = useState<Record<number, number[]>>({})
  const [channelReads, setChannelReads] = useState<Record<number, Record<number, ChannelRead>>>({})
  const [voiceParticipants, setVoiceParticipants] = useState<Record<string, VoiceParticipant>>({})
  const [voiceSession, setVoiceSession] = useState<ActiveVoiceSession | null>(null)
  const [voiceStatus, setVoiceStatus] = useState<VoiceConnectionStatus>('idle')
  const [voiceError, setVoiceError] = useState('')
  const [micUnavailable, setMicUnavailable] = useState(false)
  const [voicePlaybackBlocked, setVoicePlaybackBlocked] = useState(false)
  const [mediaRecovering, setMediaRecovering] = useState(false)
  const [voicePreferences, setVoicePreferences] = useState(loadVoicePreferences)
  const [voiceDevices, setVoiceDevices] = useState<MediaDeviceInfo[]>([])
  const [voiceDevicesLoading, setVoiceDevicesLoading] = useState(false)
  const [streams, setStreams] = useState<Record<number, ActiveStream>>({})
  const [streamStatus, setStreamStatus] = useState<StreamStatus>('idle')
  const [streamError, setStreamError] = useState('')
  const [streamMedia, setStreamMedia] = useState<MediaStream | null>(null)
  const [streamPreferences, setStreamPreferences] = useState(loadStreamPreferences)
  const [streamRole, setStreamRole] = useState<'publisher' | 'viewer' | null>(null)
  const [streamExpanded, setStreamExpanded] = useState(false)
  // The expanded player opens straight in fullscreen cinema mode.
  const [streamCinema, setStreamCinema] = useState(false)
  const [streamAudioMuted, setStreamAudioMuted] = useState(false)
  const [voiceChatOpen, setVoiceChatOpen] = useState(false)
  const [recordingsOpen, setRecordingsOpen] = useState(false)
  const [forwardSource, setForwardSource] = useState<{ serverId: number; message: Message } | null>(null)
  const pendingWatch = useRef<number | null>(null)
  const [mobileNav, setMobileNav] = useState(false)
  const [personalOpen, setPersonalOpen] = useState(false)
  const [memberCardOpen, setMemberCardOpen] = useState(false)
  const [memberCardAnchor, setMemberCardAnchor] = useState({ x: 0, y: 0 })
  const memberAnchor = useRef({ x: 0, y: 0 })
  const profileGeneration = useRef(0)
  const personalOpenRef = useRef(false)
  const [editingChannel, setEditingChannel] = useState<Channel | null>(null)
  const [viewedProfile, setViewedProfile] = useState<Profile | null>(null)
  const [viewedProfileRole, setViewedProfileRole] = useState<ServerRole>('member')
  const [viewedProfileLoading, setViewedProfileLoading] = useState(false)
  const [viewedProfileError, setViewedProfileError] = useState('')
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [confirmRequest, setConfirmRequest] = useState<{ title: string; description: string; confirmLabel: string; action: () => Promise<void> } | null>(null)
  const [userVolumes, setUserVolumes] = useState<Record<number, number>>(loadUserVolumes)
  const [mediaActivity] = useState(createMediaActivity)
  const setSpeakingUserIds = mediaActivity.speakers.set
  const setStreamQuality = mediaActivity.quality.set
  const history = useChannelHistory(api, token, selectedServerId, selectedChannelId, user?.id ?? 0)
  const { store: historyStore, messages, hasMore, hasNewer, loadingOlder, loadingNewer, loading: messagesLoading } = history

  const realtimeRef = useRef<RealtimeClient | null>(null)
  const workspaceActive = useRef(true), activeToken = useRef(token); activeToken.current = token
  useEffect(() => { workspaceActive.current = true; return () => { workspaceActive.current = false } }, [])
  const voiceMediaRef = useRef<BrowserVoiceSession | null>(null)
  const voiceSessionRef = useRef<ActiveVoiceSession | null>(voiceSession)
  const recording = useCallRecordings({ api, token, scope: `${realtimeBaseUrl || window.location.origin}:${user?.id ?? 0}`, serverId: selectedServerId, voice: voiceSession, voiceMedia: voiceMediaRef, stream: streamMedia, notify, mediaVersion: voiceStatus })
  const notificationActions = useRef({ sound: () => {}, open: (_event: MessageNotification) => {} })
  const notificationReading = useRef<() => { serverId: number | null; channelId: number | null; following: boolean }>(() => ({ serverId: null, channelId: null, following: false }))
  const notificationCenter = useMemo(() => new MessageNotificationCenter(`${realtimeBaseUrl || window.location.origin}:${user?.id ?? 0}`, user?.id ?? 0, { reading: () => notificationReading.current(), sound: () => notificationActions.current.sound(), open: (event) => notificationActions.current.open(event) }), [realtimeBaseUrl, user?.id])
  useEffect(() => notificationCenter.start(), [notificationCenter])
  const channelRefreshRef = useRef<(serverId: number) => void>(() => {})
  const channelRequestsRef = useRef(new Map<number, number>())
  const counterRefreshRef = useRef<(serverId: number) => void>(() => {})
  const counterTimersRef = useRef(new Map<number, number>())
  const counterRequestsRef = useRef(new Map<number, AbortController>())
  useEffect(() => () => {
    counterTimersRef.current.forEach((timer) => window.clearTimeout(timer)); counterTimersRef.current.clear()
    counterRequestsRef.current.forEach((request) => request.abort()); counterRequestsRef.current.clear()
  }, [token])
  const recordingMerge = recording.merge
  const recordingSyncRef = useRef(recording.retry); recordingSyncRef.current = recording.retry
  const voicePreferencesRef = useRef(voicePreferences)
  const pushToTalkHeldRef = useRef(false)
  const voiceRequestIdsRef = useRef(new Map<string, 'join' | 'state' | 'media' | 'leave'>())
  const streamAttemptRef = useRef(0)
  const streamRequestIdsRef = useRef(new Map<string, { kind: 'start' | 'watch' | 'media' | 'leave'; attempt: number }>())
  const streamRoleRef = useRef<'publisher' | 'viewer' | null>(streamRole)
  const streamPreferencesRef = useRef(streamPreferences)
  const streamCaptureRef = useRef<MediaStream | null>(null)
  const streamAudioGainRef = useRef<StreamAudioGain | null>(null)
  const streamPipelineRef = useRef<StreamPublishPipeline | null>(null)
  const serverStreamRef = useRef<BrowserServerStreamSession | null>(null)
  const p2pStreamPublisherRef = useRef<BrowserP2PStreamPublisher | null>(null)
  const p2pStreamViewerRef = useRef<BrowserP2PStreamViewer | null>(null)
  const streamDynamicRangeRef = useRef<StreamDynamicRange>('sdr')
  const pendingStreamRewatchRef = useRef<{ forceSDR: boolean; requestId?: string } | null>(null)
  const streamWatchActionRef = useRef<(forceSDR: boolean, rewatch: boolean, restoring?: boolean) => void>(() => undefined)
	const streamStartActionRef = useRef<(restoring?: boolean) => void>(() => undefined)
  const streamsRef = useRef(streams)
  const serversRef = useRef<Server[]>(servers)
  const channelsRef = useRef<Channel[]>(channels)
  const channelReadsRef = useRef(channelReads)
  const voiceParticipantsRef = useRef(voiceParticipants)
  const speakingStatesRef = useRef(new Map<string, boolean>())
  const speakingUserIdsRef = useRef<number[]>([])
  const voiceInputLevelRef = useRef(0)
  const getVoiceInputLevel = useCallback(() => voiceInputLevelRef.current, [])
  const viewedProfileRef = useRef<Profile | null>(viewedProfile)
  const pendingReadMarksRef = useRef(new Map<number, { serverId: number; messageId: number; timer: number }>())
  const activeChannelRef = useRef<number | null>(selectedChannelId)
  const activeServerRef = useRef<number | null>(selectedServerId)
  const hasNewerRef = useRef(false)
  const messageTargetRef = useRef<MessageTarget | null>(messageTarget)
  const syncLatestRef = useRef<() => void>(() => undefined)
  const syncPinsRef = useRef<() => void>(() => undefined)
  const webrtcConfigPromiseRef = useRef<Promise<{ configuration: RTCConfiguration; degraded: boolean }> | null>(null)
  const webrtcConfigRef = useRef<RTCConfiguration | null>(null)
  const voiceInputRef = useRef<BrowserVoiceInput | null>(null)
  const recoveryRef = useRef<SignallingRecoveryCoordinator | null>(null)
  // Assigned after the recovery callbacks are declared below (TDZ-safe bridge
  // for the realtime effect that is defined earlier in the component).
  const recoveryActionsRef = useRef<{
    offline: () => void
    ready: () => void
    voiceClosed: () => void
  }>({ offline: () => undefined, ready: () => undefined, voiceClosed: () => undefined })
  // Server-side media closures are retried automatically, but only a few
  // times: a server that keeps closing the session must not cause a loop.
  const voiceRejoinBudgetRef = useRef(new RetryBudget(3, 5 * 60_000))
  const streamRewatchBudgetRef = useRef(new RetryBudget(2, 2 * 60_000))
  // Unexpected signalling offline keeps the publisher screen capture alive for
  // a bounded grace period so restoring the stream never needs a new
  // getDisplayMedia permission gesture.
  const captureStashRef = useRef<{ stream: MediaStream; serverId: number; channelId: number; hasAudio: boolean; expiresAt: number } | null>(null)
  const captureStashTimerRef = useRef<number | null>(null)

  const clearCapturedStreamStash = useCallback((stopTracks: boolean) => {
    if (captureStashTimerRef.current !== null) {
      window.clearTimeout(captureStashTimerRef.current)
      captureStashTimerRef.current = null
    }
    const stash = captureStashRef.current
    captureStashRef.current = null
    if (stash && stopTracks) stash.stream.getTracks().forEach((track) => track.stop())
  }, [])

  const stashCapturedStream = useCallback((reason: string) => {
    const role = streamRoleRef.current
    const session = voiceSessionRef.current
    const capture = streamCaptureRef.current
    if (role !== 'publisher' || !capture || !session) return
    const videoTrack = capture.getVideoTracks()[0]
    if (!videoTrack || videoTrack.readyState !== 'live') {
      clearCapturedStreamStash(true)
      return
    }
    clientDiagnostics.record('media', 'stream_capture_stashed', 'warn', { reason })
    clearCapturedStreamStash(false)
    captureStashRef.current = {
      stream: capture,
      serverId: session.serverId,
      channelId: session.channelId,
      hasAudio: capture.getAudioTracks().length > 0,
      expiresAt: Date.now() + 60_000,
    }
    captureStashTimerRef.current = window.setTimeout(() => {
      clearCapturedStreamStash(true)
      // A dead capture removes the stream part of a pending recovery, but the
      // voice rejoin is still allowed.
      recoveryRef.current?.dropStreamIntent()
      clientDiagnostics.record('media', 'stream_capture_grace_expired', 'info')
    }, 60_000)
  }, [clearCapturedStreamStash])
  activeChannelRef.current = selectedChannelId
  activeServerRef.current = selectedServerId
  serversRef.current = servers
  channelsRef.current = channels
  channelReadsRef.current = channelReads
  voiceParticipantsRef.current = voiceParticipants
  voiceSessionRef.current = voiceSession
  voicePreferencesRef.current = voicePreferences
  streamRoleRef.current = streamRole
  streamPreferencesRef.current = streamPreferences
  streamsRef.current = streams
  viewedProfileRef.current = viewedProfile
  hasNewerRef.current = hasNewer
  messageTargetRef.current = messageTarget

  const chatVisible = voiceChatOpen || channels.some((channel) => channel.id === selectedChannelId && channel.kind !== 'voice')
  const notificationChatVisible = chatVisible && !personalOpen && !streamExpanded && !dialog && !notificationChannel && !recordingsOpen && !forwardSource && !messagePanel && !confirmRequest && !mobileNav
  useEffect(() => notificationCenter.contextChanged(), [notificationCenter, selectedServerId, selectedChannelId, notificationChatVisible])
  syncLatestRef.current = () => {
    const serverId = activeServerRef.current, channelId = activeChannelRef.current
    if (!chatVisible || !token || !serverId || !channelId) return
    void historyStore.sync(serverId, channelId).catch(() => undefined)
  }

  syncPinsRef.current = () => {
    const serverId = activeServerRef.current
    const channelId = activeChannelRef.current
    if (!chatVisible || !token || !serverId || !channelId) return
    void api.messages.pins(token, serverId, channelId).then((pins) => {
      if (activeServerRef.current === serverId && activeChannelRef.current === channelId) setPinnedMessages((current) => pins.map((pin) => ({ ...pin, message: newerMessage(current.find((item) => item.message.id === pin.message.id)?.message, pin.message) })))
    }).catch(() => undefined)
  }

  const handleError = useCallback((error: unknown, fallback = 'Не удалось выполнить действие') => {
    // 401 handled centrally: api.unwrap() notifies AuthProvider, which
    // expires the session (see authEvents).
    notify(error instanceof Error ? humanError(error) : fallback, 'error')
  }, [notify])

  const { members, setMembers, refreshMembers } = useServerMembers(api, token, selectedServerId, handleError)
  const [lastSeenByUser, setLastSeenByUser] = useState<Readonly<Record<number, number>>>({})
  const membersById = useMemo(() => new Map(members.map((member) => [member.user_id, member])), [members])

  const selectedServer = servers.find((server) => server.id === selectedServerId) ?? null
  const selectedChannel = channels.find((channel) => channel.id === selectedChannelId) ?? null
  const canManage = selectedServer?.role === 'owner' || selectedServer?.role === 'admin'
  // Avatars are requested only for members whose list entry names a version.
  const avatarVersions = useMemo(() => new Map(members.map((member) => [member.user_id, member.avatar_version ?? null] as const)), [members])
  const setMemberAvatar = useCallback((userId: number, version: string | null) => {
    window.dispatchEvent(new CustomEvent('voxhold:avatar-version', { detail: { user_id: userId, version } }))
    setMembers((current) => current.map((member) => member.user_id === userId ? { ...member, avatar_version: version } : member))
  }, [setMembers])
  const pinnedMessageIds = useMemo(() => new Set(pinnedMessages.map((pin) => pin.message.id)), [pinnedMessages])

  // The backend is the single runtime source of ICE configuration. Media start
  // awaits this promise so peers never get created in an undefined race.
  const ensureWebRTCConfig = useCallback(async (): Promise<RTCConfiguration> => {
    if (!token) return {}
    if (!webrtcConfigPromiseRef.current) {
      const service = createWebRTCConfigService({ fetcher: () => api.webrtc.config(token) })
      webrtcConfigPromiseRef.current = service.load().then((state) => {
        webrtcConfigRef.current = state.configuration
        if (state.degraded) {
          notify('TURN недоступен, соединение может не работать в закрытой сети', 'error')
        }
        return state
      })
    }
    await webrtcConfigPromiseRef.current
    return webrtcConfigRef.current ?? {}
  }, [api, token, notify])

  // Speaking detection uses hysteresis: audio above 7% RMS marks a participant
  // as speaking, and they stay marked until it drops below 4%.
  /** Local join/leave/mute cues; they follow the voice output device. */
  const playUISound = useCallback((sound: UISound) => {
    const preferences = voicePreferencesRef.current
    if (preferences.uiSounds) uiSounds.play(sound, preferences.uiSoundVolume, preferences.outputDeviceId)
  }, [])

  /** Another participant of the channel this client is connected to. */
  const isRoommate = useCallback((participant: Pick<VoiceParticipant, 'server_id' | 'channel_id' | 'connection_id' | 'user_id'>) => {
    const active = voiceSessionRef.current
    return !!active?.connectionId
      && participant.server_id === active.serverId
      && participant.channel_id === active.channelId
      && participant.connection_id !== active.connectionId
      && participant.user_id !== user?.id
  }, [user?.id])

  const recomputeSpeakingUsers = useCallback(() => {
    const session = voiceSessionRef.current
    const speaking = new Set<number>()
    if (session?.connectionId && !session.selfMute && voiceInputLevelRef.current >= 0.07 && user?.id) {
      speaking.add(user.id)
    }
    speakingStatesRef.current.forEach((isSpeaking, connectionId) => {
      if (!isSpeaking) return
      const participant = voiceParticipantsRef.current[connectionId]
      if (participant) speaking.add(participant.user_id)
    })
    const previous = speakingUserIdsRef.current
    if (previous.length === speaking.size && [...speaking].every((id) => previous.includes(id))) return
    const list = [...speaking].sort((left, right) => left - right)
    speakingUserIdsRef.current = list
    setSpeakingUserIds(list)
  }, [user?.id, setSpeakingUserIds])

  const applyRemoteLevels = useCallback((levels: Array<{ connectionId: string; level: number }>) => {
    const states = speakingStatesRef.current
    const seen = new Set(levels.map((entry) => entry.connectionId))
    levels.forEach(({ connectionId, level }) => {
      if (level >= 0.07) states.set(connectionId, true)
      else if (level < 0.04) states.set(connectionId, false)
      else if (!states.has(connectionId)) states.set(connectionId, false)
    })
    Array.from(states.keys()).forEach((connectionId) => { if (!seen.has(connectionId)) states.delete(connectionId) })
    recomputeSpeakingUsers()
  }, [recomputeSpeakingUsers])

  const applyChannelRead = useCallback((read: ChannelRead) => {
    if (read.user_id === user?.id) counterRefreshRef.current(read.server_id)
    setChannelReads((current) => {
      const channelState = current[read.channel_id] ?? {}
      const existing = channelState[read.user_id]
      if (existing && existing.last_read_message_id >= read.last_read_message_id) return current
      const next = { ...current, [read.channel_id]: { ...channelState, [read.user_id]: read } }
      channelReadsRef.current = next
      return next
    })
  }, [user?.id])

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
    if (personalOpenRef.current || !token || !serverId || !channelId || !userId || messageId <= 0) return
    const currentCursor = channelReadsRef.current[channelId]?.[userId]?.last_read_message_id ?? 0
    if (messageId <= currentCursor) return

    const pending = pendingReadMarksRef.current.get(channelId)
    if (pending) window.clearTimeout(pending.timer)
    const target = Math.max(messageId, pending?.messageId ?? 0)
    const timer = window.setTimeout(() => {
      const queued = pendingReadMarksRef.current.get(channelId)
      if (!queued) return
      pendingReadMarksRef.current.delete(channelId)
      if (personalOpenRef.current) return
      void api.reads.mark(token, queued.serverId, channelId, queued.messageId)
        .then(applyChannelRead)
        .catch(() => {
          // 401 is handled centrally via authEvents.
        })
    }, 220)
    pendingReadMarksRef.current.set(channelId, { serverId, messageId: target, timer })
  }, [api, token, user?.id, applyChannelRead])

  useEffect(() => () => {
    pendingReadMarksRef.current.forEach((pending) => window.clearTimeout(pending.timer))
    pendingReadMarksRef.current.clear()
    // Unmount releases a stashed capture immediately: nobody can consume it.
    if (captureStashTimerRef.current !== null) window.clearTimeout(captureStashTimerRef.current)
    captureStashRef.current?.stream.getTracks().forEach((track) => track.stop())
    captureStashRef.current = null
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
    streamRequestIdsRef.current.set(requestId, { kind, attempt: streamAttemptRef.current })
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
    streamAttemptRef.current++
    streamAudioGainRef.current?.close()
    streamAudioGainRef.current = null
    streamPipelineRef.current?.close()
    streamPipelineRef.current = null
    serverStreamRef.current?.close()
    p2pStreamPublisherRef.current?.close()
    p2pStreamViewerRef.current?.close()
    serverStreamRef.current = null
    p2pStreamPublisherRef.current = null
    p2pStreamViewerRef.current = null
    // While a stashed capture is inside its grace period the tracks stay
    // alive and the ref keeps pointing at them; the stash owner stops the
    // tracks when it expires or consumes them.
    if (streamRoleRef.current === 'publisher' && !captureStashRef.current) {
      streamCaptureRef.current?.getTracks().forEach((track) => track.stop())
      streamCaptureRef.current = null
    }
    streamRoleRef.current = null
    setStreamRole(null)
    setStreamMedia(null)
    setStreamQuality(null)
    streamDynamicRangeRef.current = 'sdr'
    setStreamStatus('idle')
    setStreamExpanded(false)
    setStreamCinema(false)
    setStreamAudioMuted(false)
  }, [setStreamQuality])

  /**
   * Closes stream/voice peer connections and remote outputs but deliberately
   * keeps the microphone input and the stashed screen capture alive. This is
   * the "unexpected signalling offline" path, not a user leave.
   */
  const detachMediaPeers = useCallback(() => {
    streamAttemptRef.current++
    streamAudioGainRef.current?.close()
    streamAudioGainRef.current = null
    streamPipelineRef.current?.close()
    streamPipelineRef.current = null
    serverStreamRef.current?.close()
    p2pStreamPublisherRef.current?.close()
    p2pStreamViewerRef.current?.close()
    serverStreamRef.current = null
    p2pStreamPublisherRef.current = null
    p2pStreamViewerRef.current = null
    streamRoleRef.current = null
    setStreamRole(null)
    setStreamMedia(null)
    setStreamQuality(null)
    setStreamStatus('idle')
    setStreamExpanded(false)
    setStreamCinema(false)
    setStreamAudioMuted(false)

    const media = voiceMediaRef.current
    voiceMediaRef.current = null
    media?.close()
    pushToTalkHeldRef.current = false
    voiceInputLevelRef.current = 0
    speakingStatesRef.current.clear()
    recomputeSpeakingUsers()
  }, [recomputeSpeakingUsers, setStreamQuality])

  const closeVoiceLocally = useCallback(() => {
    // An explicit close cancels any pending automatic recovery and releases
    // every captured resource immediately.
    recoveryRef.current?.cancel('closed locally')
    setMediaRecovering(false)
    clearCapturedStreamStash(true)
    streamCaptureRef.current?.getTracks().forEach((track) => track.stop())
    streamCaptureRef.current = null
    detachMediaPeers()
    voiceInputRef.current?.close()
    voiceInputRef.current = null
    const connectionId = voiceSessionRef.current?.connectionId
    if (connectionId) removeVoiceParticipant(connectionId)
    voiceSessionRef.current = null
    setVoiceSession(null)
    setVoiceStatus('idle')
    setMicUnavailable(false)
  }, [clearCapturedStreamStash, detachMediaPeers, removeVoiceParticipant])

  useEffect(() => () => closeVoiceLocally(), [closeVoiceLocally])

  /**
   * Returns the shared microphone capture, creating or rebuilding it when
   * needed. The input intentionally outlives individual peer sessions so a
   * signalling reconnect never asks for permission again.
   */
  const ensureVoiceInput = useCallback(async (): Promise<BrowserVoiceInput | null> => {
    let input = voiceInputRef.current
    if (!input) {
      input = new BrowserVoiceInput({
        onLevel: (level) => {
          voiceInputLevelRef.current = level
          recomputeSpeakingUsers()
        },
        onUnavailable: () => {
          // Sending stops; receiving other participants continues working.
          const active = voiceSessionRef.current
          if (active && !active.selfMute) {
            const updated = { ...active, selfMute: true }
            voiceSessionRef.current = updated
            setVoiceSession(updated)
            input?.setState(false)
          }
          setMicUnavailable(true)
          setVoiceError('Микрофон недоступен. Проверьте подключение устройства и попробуйте снова')
        },
        onReplaced: () => {
          setMicUnavailable(false)
        },
      })
      voiceInputRef.current = input
    }
    if (!input.isHealthy) {
      try {
        await input.start(voicePreferencesRef.current)
      } catch (error) {
        setVoiceError(voiceErrorMessage(error))
        closeVoiceLocally()
        return null
      }
    }
    return input
  }, [recomputeSpeakingUsers, closeVoiceLocally])

  const refreshVoiceDevices = useCallback(async (requestPermission = false) => {
    setVoiceDevicesLoading(true)
    try {
      setVoiceDevices(await enumerateVoiceDevices(requestPermission && !voiceInputRef.current?.isHealthy))
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

  notificationReading.current = () => ({ serverId: activeServerRef.current, channelId: activeChannelRef.current, following: notificationChatVisible && historyStore.viewport(activeChannelRef.current)?.following !== false })
  notificationActions.current.sound = () => playUISound('message_notification')
  notificationActions.current.open = (event) => {
    if (!token) return
    void api.channels.list(token, event.server_id).then((visible) => {
      if (!notificationCenter.isAvailable(event)) return
      if (!visible.some((channel) => channel.id === event.channel_id && channel.kind !== 'voice')) throw new Error('Доступ к этому каналу больше недоступен')
      openCommunityChannels()
      setStreamExpanded(false); setStreamCinema(false); setDialog(null); setNotificationChannel(null); setRecordingsOpen(false); setForwardSource(null)
      if (document.fullscreenElement && document.exitFullscreen) void document.exitFullscreen().catch(() => undefined)
      if (activeServerRef.current !== event.server_id) { setChannels([]); setMembers([]) }
      setSelectedServerId(event.server_id); setSelectedChannelId(event.channel_id); setMessageTarget({ channelId: event.channel_id, messageId: event.message.id }); setFocusedMessageId(event.message.id); setMessagePanel(null); setMobileNav(false)
    }).catch((error: unknown) => handleError(error))
  }

  counterRefreshRef.current = (serverId: number) => {
    if (!token || serverId !== activeServerRef.current) return
    const pending = counterTimersRef.current.get(serverId)
    if (pending) return
    // Bound network work during bursts and keep older responses from restoring
    // a badge that was already cleared on another tab.
    counterRequestsRef.current.get(serverId)?.abort()
    counterTimersRef.current.set(serverId, window.setTimeout(() => {
      counterTimersRef.current.delete(serverId)
      const request = new AbortController(); counterRequestsRef.current.set(serverId, request)
      void api.channels.unreadCounts(token, serverId, request.signal).then((counts) => {
        if (request.signal.aborted || activeServerRef.current !== serverId) return
        const values = new Map(counts.map((item) => [item.channel_id, item.unread_count]))
        setChannels((current) => { const next = current.map((channel) => channel.server_id === serverId ? { ...channel, unread_count: values.get(channel.id) ?? 0 } : channel); channelsRef.current = next; return next })
      }).catch(() => undefined)
    }, 80))
  }

  useEffect(() => {
    const refresh = () => { if (document.visibilityState === 'visible' && activeServerRef.current) counterRefreshRef.current(activeServerRef.current) }
    window.addEventListener('focus', refresh); document.addEventListener('visibilitychange', refresh)
    return () => { window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh) }
  }, [])

  channelRefreshRef.current = (serverId: number) => {
    if (!token) return
    const request = (channelRequestsRef.current.get(serverId) ?? 0) + 1
    channelRequestsRef.current.set(serverId, request)
    void api.channels.list(token, serverId).then((snapshot) => {
      if (channelRequestsRef.current.get(serverId) !== request) return
      const allowed = new Set(snapshot.map((channel) => channel.id))
      setForwardSource((current) => current?.serverId === serverId && !allowed.has(current.message.channel_id) ? null : current)
      historyStore.retainChannels(serverId, allowed)
      notificationCenter.retainChannels(serverId, allowed)
      setNotificationChannel((current) => current?.server_id === serverId && !allowed.has(current.id) ? null : current)
      if (voiceSessionRef.current?.serverId === serverId && !allowed.has(voiceSessionRef.current.channelId)) closeVoiceLocally()
      if (activeServerRef.current !== serverId) return
      const removed = new Set(channelsRef.current.filter((channel) => channel.server_id === serverId && !allowed.has(channel.id)).map((channel) => channel.id))
      const next = snapshot.map((channel) => ({ ...channel, access_revision: request })).sort((a, b) => a.position - b.position || a.id - b.id)
      channelsRef.current = next; setChannels(next)
      counterRefreshRef.current(serverId)
      setEditingChannel((current) => current ? next.find((channel) => channel.id === current.id) ?? null : null)
      if (activeChannelRef.current && !allowed.has(activeChannelRef.current)) { setMessagePanel(null); setMessageTarget(null); setFocusedMessageId(null); setPinnedMessages([]) }
      setSelectedChannelId((current) => current && allowed.has(current) ? current : pickDefaultChannel(next)?.id ?? null)
      setChannelReads((current) => Object.fromEntries(Object.entries(current).filter(([id]) => !removed.has(Number(id)))))
      recordingSyncRef.current()
    }).catch((error: unknown) => handleError(error, 'Не удалось обновить доступ к каналам'))
  }

  const loadServers = useCallback(async (signal?: AbortSignal) => {
    if (!token) return []
    const data = await api.servers.list(token, signal)
    setServers(data)
    setSelectedServerId((current) => data.some((item) => item.id === current) ? current : (data[0]?.id ?? null))
    return data
  }, [api, token])

  useEffect(() => {
    if (!token) return
    const controller = new AbortController()
    const load = async () => {
      setInitialLoading(true)
      try {
        const [, ownProfile, metadata] = await Promise.all([
          loadServers(controller.signal),
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
  }, [api, token, loadServers, handleError])

  useEffect(() => {
    if (!token || !selectedServerId) {
      setChannels([]); setMembers([]); setSelectedChannelId(null)
      return
    }
    const controller = new AbortController()
    const load = async () => {
      const request = (channelRequestsRef.current.get(selectedServerId) ?? 0) + 1
      channelRequestsRef.current.set(selectedServerId, request)
      try {
        const nextChannels = await api.channels.list(token, selectedServerId, controller.signal)
        if (controller.signal.aborted) return
        if (channelRequestsRef.current.get(selectedServerId) !== request) return
        historyStore.retainChannels(selectedServerId, new Set(nextChannels.map((channel) => channel.id)))
        nextChannels.sort((left, right) => left.position - right.position || left.id - right.id)
        setChannels(nextChannels)
        const currentChannelId = activeChannelRef.current
        const nextChannelId = nextChannels.some((item) => item.id === currentChannelId)
          ? currentChannelId
          : (pickDefaultChannel(nextChannels)?.id ?? null)
        if (nextChannelId !== currentChannelId) {
          setPinnedMessages([])
        }
        setSelectedChannelId(nextChannelId)
      } catch (error) {
        if (!(error instanceof DOMException && error.name === 'AbortError')) handleError(error, 'Не удалось загрузить сервер')
      }
    }
    void load()
    return () => controller.abort()
  }, [api, token, selectedServerId, handleError, historyStore, setMembers])

  useEffect(() => {
    if (!token || !selectedServerId || !selectedChannelId || !chatVisible) return
    const target = messageTarget?.channelId === selectedChannelId ? messageTarget : null
    const request = target
      ? historyStore.context(selectedServerId, selectedChannelId, target.messageId)
      : historyStore.sync(selectedServerId, selectedChannelId)
    void request.catch((error: unknown) => {
      if (!(error instanceof DOMException && error.name === 'AbortError')) handleError(error, 'Не удалось загрузить сообщения')
    })
  }, [token, selectedServerId, selectedChannelId, chatVisible, messageTarget, historyStore, handleError])

  useEffect(() => {
    if (!token || !selectedServerId || !selectedChannelId || !chatVisible) {
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
  }, [api, token, selectedServerId, selectedChannelId, chatVisible, handleError])

  useEffect(() => {
    if (!token) return
    const client = new RealtimeClient({
      token,
      baseUrl: realtimeBaseUrl,
      onStateChange: (state) => {
        setConnection(state)
        if (state === 'offline') {
          setOnlineByServer({})
          recoveryActionsRef.current.offline()
        }
      },
      onUnauthorized: () => {
        // AuthProvider resolves rotation races; a real logout unmounts and releases media.
        expire(token)
      },
      onRecordingUpdated: recordingMerge,
      onAvatarUpdated: ({ user_id, version }) => setMemberAvatar(user_id, version ?? null),
      onReady: () => {
        setRosterRevision((current) => current + 1)
        const serverId = activeServerRef.current
        if (serverId) void refreshMembers()
        if (serverId) channelRefreshRef.current(serverId)
        if (voiceSessionRef.current && voiceSessionRef.current.serverId !== serverId) channelRefreshRef.current(voiceSessionRef.current.serverId)
        recordingSyncRef.current()
        syncLatestRef.current(); syncPinsRef.current()
        // Allow the next media start to fetch fresh runtime ICE values.
        webrtcConfigPromiseRef.current = null
        recoveryActionsRef.current.ready()
      },
      onSubscribed: () => { syncLatestRef.current(); syncPinsRef.current() },
      onSyncRequired: ({ server_id, channel_id }) => {
        counterRefreshRef.current(server_id)
        void historyStore.sync(server_id, channel_id).catch(() => undefined)
        if (channel_id === activeChannelRef.current) syncPinsRef.current()
      },
      onNotification: (event) => {
        counterRefreshRef.current(event.server_id)
        recordLastMessage(event.channel_id, event.message.id)
        void notificationCenter.receive(event)
      },
      onNotificationSettings: (value) => { notificationCenter.setSettings(value); setNotificationSettings(value) },
      onMessage: (message) => {
        recordLastMessage(message.channel_id, message.id)
        historyStore.receive(message)
      },
      onMessageReactions: (event) => {
        historyStore.reactions(event)
        if (event.channel_id === activeChannelRef.current) setPinnedMessages((current) => current.map((pin) => pin.message.id === event.message_id ? { ...pin, message: withReactions(pin.message, event) } : pin))
      },
      onMessageUpdated: (message) => {
        historyStore.receive(message)
        if (message.channel_id !== activeChannelRef.current) return
        setPinnedMessages((current) => current.map((pin) => pin.message.id === message.id ? { ...pin, message: newerMessage(pin.message, message) } : pin))
      },
      onMessageDeleted: (event) => {
        const serverId = activeServerRef.current; if (serverId) counterRefreshRef.current(serverId)
        historyStore.remove(event.channel_id, event.message_id)
        if (event.channel_id !== activeChannelRef.current) return
        setPinnedMessages((current) => { const kept = current.filter((pin) => pin.message.id !== event.message_id); const resolved = resolveReplyReferences(kept.map((pin) => pin.message), [], new Set([event.message_id])); return kept.map((pin, index) => ({ ...pin, message: resolved[index]! })) })
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
        if (update.server_id === activeServerRef.current && update.last_seen_at) {
          const at = update.last_seen_at
          setLastSeenByUser((current) => (current[update.user_id] ?? 0) >= at ? current : { ...current, [update.user_id]: at })
          setViewedProfile((current) => current?.user_id === update.user_id ? { ...current, last_seen_at: Math.max(current.last_seen_at ?? 0, at) } : current)
        }
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
          ? current.map((member) => member.user_id === event.member.user_id ? mergeServerMember(member, event.member) : member)
          : [...current, event.member])
      },
      onServerMemberRoleUpdated: (event) => {
        if (event.server_id === activeServerRef.current) {
          setMembers((current) => current.map((member) => member.user_id === event.member.user_id ? mergeServerMember(member, event.member) : member))
          setViewedProfileRole((current) => viewedProfileRef.current?.user_id === event.member.user_id ? event.member.role : current)
        }
        if (event.member.user_id === user?.id) {
          setServers((current) => current.map((server) => server.id === event.server_id ? { ...server, role: event.member.role } : server))
        }
      },
      onServerMemberRemoved: (event) => {
        if (event.user_id === user?.id && voiceSessionRef.current?.serverId === event.server_id) closeVoiceLocally()
        if (event.user_id === user?.id) {
          historyStore.removeServer(event.server_id)
          setForwardSource((current) => current?.serverId === event.server_id ? null : current)
          notificationCenter.removeServer(event.server_id)
          const remaining = serversRef.current.filter((server) => server.id !== event.server_id)
          serversRef.current = remaining
          setServers(remaining)
          if (activeServerRef.current === event.server_id) {
            setPinnedMessages([]); setChannels([]); setMembers([]); setSelectedChannelId(null); setSelectedServerId(remaining[0]?.id ?? null)
          }
        } else if (event.server_id === activeServerRef.current) {
          setMembers((current) => current.filter((member) => member.user_id !== event.user_id))
          // Membership cascades remove reactions in SQLite; refresh the journal
          // because a departing member can have reacted in any cached channel.
          void historyStore.syncCached(event.server_id)
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
        setForwardSource((current) => current?.serverId === event.server_id ? null : current)
        historyStore.removeServer(event.server_id)
        notificationCenter.removeServer(event.server_id)
        if (voiceSessionRef.current?.serverId === event.server_id) closeVoiceLocally()
        setStreams((current) => Object.fromEntries(
          Object.entries(current).filter(([, value]) => value.server_id !== event.server_id),
        ))
        const remaining = serversRef.current.filter((server) => server.id !== event.server_id)
        serversRef.current = remaining
        setServers(remaining)
        if (activeServerRef.current === event.server_id) {
          setPinnedMessages([]); setChannels([]); setMembers([]); setSelectedChannelId(null); setSelectedServerId(remaining[0]?.id ?? null)
        }
      },
      onChannelsChanged: ({ server_id }) => {
        if (server_id === activeServerRef.current) setRosterRevision((current) => current + 1)
        channelRefreshRef.current(server_id)
      },
      onChannelCreated: (channel) => {
        notificationCenter.allowChannel(channel.server_id, channel.id)
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
        historyStore.removeChannel(event.channel_id)
        notificationCenter.removeChannel(event.channel_id)
        setNotificationChannel((current) => current?.id === event.channel_id ? null : current)
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
          const nextChannel = pickDefaultChannel(remaining)
          setPinnedMessages([]); setFocusedMessageId(null); setMessageTarget(null); setSelectedChannelId(nextChannel?.id ?? null)
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
        // An automatic rejoin stays silent: the user never left the channel.
        const recoveryPhase = recoveryRef.current?.phase
        if (recoveryPhase !== 'signalling_lost' && recoveryPhase !== 'rejoining_voice' && recoveryPhase !== 'restoring_stream') {
          playUISound('self_join')
        }
        // Confirm the automatic rejoin with the new server-side connection id;
        // stale ids from the dead generation are ignored by the coordinator.
        // A viewer has no capture to lose: its stream intent stays restorable.
        recoveryRef.current?.markVoiceJoined(
          event.participant.connection_id,
          recoveryRef.current?.intent?.streamRole === 'viewer'
            || (!!streamCaptureRef.current
              && streamCaptureRef.current.getVideoTracks().every((track) => track.readyState === 'live')),
        )
      },
      onVoiceLeft: (event) => {
        removeVoiceParticipant(event.connection_id)
        // Teardown events of the old connection must not cancel the new intent.
        if (recoveryRef.current?.staleConnectionId() === event.connection_id) return
        const active = voiceSessionRef.current
        if (active?.connectionId === event.connection_id || (!active?.connectionId && active?.serverId === event.server_id && active.channelId === event.channel_id)) {
          playUISound('self_leave')
          closeVoiceLocally()
        }
      },
      onVoiceParticipantJoined: (participant) => {
        upsertVoiceParticipant(participant)
        if (isRoommate(participant) && !voiceSessionRef.current?.selfDeaf) playUISound('user_join')
      },
      onVoiceParticipantLeft: (event) => {
        const participant = voiceParticipantsRef.current[event.connection_id]
        removeVoiceParticipant(event.connection_id)
        if (participant && isRoommate(participant) && !voiceSessionRef.current?.selfDeaf) playUISound('user_leave')
      },
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
        if (event.reason === 'channel access was revoked') {
          setVoiceError(voiceCloseMessage(event.reason)); closeVoiceLocally(); return
        }
        // Old-generation teardown during recovery is ignored, except when the
        // server explicitly says the session moved to another connection.
        const stale = recoveryRef.current?.staleConnectionId()
        if (stale && event.reason !== 'voice session moved to another connection') {
          clientDiagnostics.record('webrtc', 'voice_closed_ignored_stale_generation', 'debug', {
            reason: event.reason,
          })
          return
        }
        const replaced = event.reason === 'voice session moved to another connection'
        const rejoin = !replaced && !!voiceSessionRef.current && voiceRejoinBudgetRef.current.take()
        clientDiagnostics.record('webrtc', 'voice_closed_by_server', 'warn', {
          reason: event.reason,
          action: rejoin ? 'rejoin' : 'leave',
        })
        if (rejoin) {
          // The signalling connection is healthy: rejoin with the same
          // microphone instead of dropping the user out of the channel.
          recoveryActionsRef.current.voiceClosed()
          return
        }
        setVoiceError(voiceCloseMessage(event.reason))
        playUISound('self_leave')
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
        // During recovery a stream.stopped belongs to the dead generation.
        if (recoveryRef.current?.staleConnectionId()) return
        removeStream(event.channel_id)
        if (voiceSessionRef.current?.channelId === event.channel_id && streamRoleRef.current) {
          if (event.reason && event.reason !== 'stream stopped by user') setStreamError(event.reason)
          closeStreamLocally()
        }
      },
      onStreamLeft: (_event, requestId) => {
        if (recoveryRef.current?.staleConnectionId()) return
        const pendingRewatch = pendingStreamRewatchRef.current
        if (pendingRewatch?.requestId && requestId !== pendingRewatch.requestId) return
        const request = requestId ? streamRequestIdsRef.current.get(requestId) : undefined
        if (request && request.attempt !== streamAttemptRef.current) return
        if (requestId) streamRequestIdsRef.current.delete(requestId)
        pendingStreamRewatchRef.current = null
        closeStreamLocally()
        if (pendingRewatch) {
          queueMicrotask(() => streamWatchActionRef.current(pendingRewatch.forceSDR, true))
        }
      },
      onStreamWatching: (event) => {
        upsertStream(event.stream)
        const selected = event.stream.renditions?.find((value) => value.id === event.selected_rendition_id)
        streamDynamicRangeRef.current = selected?.dynamic_range ?? 'sdr'
      },
      onStreamViewerJoined: (viewer) => { void p2pStreamPublisherRef.current?.addViewer(viewer.connection_id) },
      onStreamViewerLeft: (viewer) => p2pStreamPublisherRef.current?.removeViewer(viewer.connection_id),
      onStreamWebRTCOffer: (offer) => { void serverStreamRef.current?.acceptOffer(offer.sdp) },
      onStreamICECandidate: (candidate) => { void serverStreamRef.current?.addICECandidate(candidate) },
      onStreamWebRTCClosed: (event) => {
        if (!streamRoleRef.current) return
        if (recoveryRef.current?.staleConnectionId()) return
        if (pendingStreamRewatchRef.current) return
        // A viewer whose media session failed (recovery exhausted, rendition
        // restarted) simply watches again; the publisher's limits are final.
        const rewatch = streamRoleRef.current === 'viewer'
          && !STREAM_FINAL_CLOSE_REASONS.has(event.reason)
          && streamRewatchBudgetRef.current.take()
        clientDiagnostics.record('webrtc', 'stream_closed_by_server', 'warn', {
          reason: event.reason,
          role: streamRoleRef.current,
          action: rewatch ? 'rewatch' : 'close',
        })
        closeStreamLocally()
        if (rewatch) {
          const attempt = streamAttemptRef.current
          window.setTimeout(() => {
            if (streamAttemptRef.current === attempt) streamWatchActionRef.current(false, true)
          }, 1_000)
          return
        }
        setStreamError(streamCloseMessage(event.reason))
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
        const request = streamRequestIdsRef.current.get(event.request_id)
        streamRequestIdsRef.current.delete(event.request_id)
        if (request && request.attempt !== streamAttemptRef.current) return
        const streamKind = request?.kind
        if (streamKind === 'leave' && pendingStreamRewatchRef.current) {
          const pendingRewatch = pendingStreamRewatchRef.current
          pendingStreamRewatchRef.current = null
          closeStreamLocally()
          // Older servers can remove the dead viewer before processing leave.
          // That response acknowledges the desired state just like stream.left.
          if (event.message === 'stream is not active on this connection') {
            clientDiagnostics.record('media', 'stream_rewatch_after_closed_session', 'info')
            queueMicrotask(() => streamWatchActionRef.current(pendingRewatch.forceSDR, true))
          } else setStreamError(streamRealtimeError(event.message))
          return
        }
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
    return () => {
      const replacing = workspaceActive.current
      client.close()
      realtimeRef.current = null
      const phase = recoveryRef.current?.phase
      const recovering = phase === 'signalling_lost' || phase === 'rejoining_voice' || phase === 'restoring_stream'
      if (replacing && voiceSessionRef.current && !recovering) recoveryActionsRef.current.offline()
    }
  }, [api.servers, refreshMembers, setMembers, historyStore, notificationCenter, recordingMerge, setMemberAvatar, token, realtimeBaseUrl, expire, user?.id, applyChannelRead, recordLastMessage, replaceChannelReads, closeStreamLocally, closeVoiceLocally, removeStream, removeVoiceParticipant, upsertStream, upsertVoiceParticipant, playUISound, isRoommate])

  useEffect(() => {
    if (selectedServerId && selectedChannelId && chatVisible) realtimeRef.current?.subscribe(selectedServerId, selectedChannelId)
    else realtimeRef.current?.unsubscribe()
  }, [selectedServerId, selectedChannelId, chatVisible])

  const selectChannel = (id: number) => {
    openCommunityChannels()
    if (id === selectedChannelId) {
      setMessagePanel(null)
      setMobileNav(false)
      return
    }
    setPinnedMessages([]); setSelectedChannelId(id); setMessageTarget(null); setFocusedMessageId(null); setMessagePanel(null); setMobileNav(false)
  }

  const joinVoiceChannel = async (channel: Channel) => {
 window.dispatchEvent(new Event('voxhold:channel-call-starting'))
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

    // Media start waits for the runtime ICE configuration (or a fixed
    // host-only fallback) before any peer is created.
    const iceConfiguration = await ensureWebRTCConfig()
    if (voiceSessionRef.current !== pending) return

    const input = await ensureVoiceInput()
    if (!input) return
    if (voiceSessionRef.current !== pending) return

    // Function declaration (not arrow) so it can close over `media`
    // before initialization; only invoked after construction.
    function fail(error: unknown) {
      if (voiceMediaRef.current !== media) return
      const activeClient = realtimeRef.current
      if (voiceSessionRef.current?.connectionId) trackVoiceRequest(activeClient?.leaveVoice() ?? null, 'leave')
      setVoiceError(voiceErrorMessage(error))
      closeVoiceLocally()
    }
    const media = new BrowserVoiceSession({
      input,
      iceConfiguration,
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
      onInputError: (error) => { if (voiceMediaRef.current === media) { setMicUnavailable(true); setVoiceError(voiceErrorMessage(error)) } },
      onError: fail,
      onInputLevel: (level) => {
        voiceInputLevelRef.current = level
        recomputeSpeakingUsers()
      },
      onRemoteLevels: applyRemoteLevels,
      onPlaybackBlocked: () => setVoicePlaybackBlocked(true),
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
    playUISound('self_leave')
    closeVoiceLocally()
  }

  const updateStreamPreferences = (next: StreamPreferences) => {
    streamPreferencesRef.current = next
    setStreamPreferences(next)
    saveStreamPreferences(next)
    streamAudioGainRef.current?.setVolume(next.publishVolume)
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

  // `restoring` comes from signalling recovery: voice.joined already confirmed
  // the new session, but the voice peer has not reported `connected` yet.
  const startStream = async (restoring = false) => {
    const activeVoice = voiceSessionRef.current
    const client = realtimeRef.current
    const channel = activeVoice
      ? channelsRef.current.find((item) => item.id === activeVoice.channelId && item.server_id === activeVoice.serverId)
      : null
    if (!client || !activeVoice || !channel || channel.kind !== 'voice' || (voiceStatus !== 'connected' && !restoring)) {

      setStreamError('Сначала подключитесь к этому голосовому каналу')
      return
    }
    if (streamRoleRef.current || streamsRef.current[channel.id]) return

    setStreamError('')
    setStreamStatus('requesting')
    try {
      const preferences = streamPreferencesRef.current
      const [{ BrowserServerStreamSession, BrowserP2PStreamPublisher, selectedStreamCodec, captureScreen, capturedAudioIncludesOwnPlayback }, { capturedHDRProbe }, { createHDRPublishPipeline, createSDRPublishPipeline }, { StreamAudioGain }] = await Promise.all([
        import('../services/stream'), import('../services/hdrCapabilities'), import('../services/hdrPipeline'), import('../services/streamAudioGain'),
      ])
      if (voiceSessionRef.current?.channelId !== channel.id || streamRoleRef.current) return
      const codec = selectedStreamCodec(preferences, 'send')
      const iceConfiguration = await ensureWebRTCConfig()
      // Reuse a capture kept alive during the signalling-loss grace period:
      // restoring the stream must not require a new getDisplayMedia gesture.
      const stash = captureStashRef.current
      let capture: MediaStream
      const stashLive = stash
        && stash.channelId === channel.id
        && Date.now() < stash.expiresAt
        && stash.stream.getVideoTracks().every((track) => track.readyState === 'live')
      if (stash && !stashLive) clearCapturedStreamStash(true)
      if (stashLive && stash) {
        clearCapturedStreamStash(false)
        capture = stash.stream
        streamCaptureRef.current = capture
        clientDiagnostics.record('media', 'stream_capture_reused', 'info')
      } else {
        capture = await captureScreen(preferences)
      }
      // The screen picker can stay open for a long time: the user may have left
      // the voice channel or started watching something in the meantime.
      const currentVoice = voiceSessionRef.current
      if (
        streamRoleRef.current
        || currentVoice?.serverId !== activeVoice.serverId
        || currentVoice.channelId !== activeVoice.channelId
      ) {
        capture.getTracks().forEach((track) => track.stop())
        if (streamCaptureRef.current === capture) streamCaptureRef.current = null
        if (!streamRoleRef.current) setStreamStatus('idle')
        return
      }
      streamCaptureRef.current = capture
      // A reused capture may still carry a mute from the previous stream.
      capture.getAudioTracks().forEach((track) => { track.enabled = true })
      setStreamAudioMuted(false)
      streamAttemptRef.current++
      streamRoleRef.current = 'publisher'
      setStreamRole('publisher')
      setStreamStatus('signaling')

      const publisherAttempt = streamAttemptRef.current
      const pipelineRepairBudget = new RetryBudget(2, 2 * 60_000)
      let repairingPipeline = false
      const repairSDRPipeline = async (error = new Error('Видеокодер перестал выдавать кадры')) => {
        if (repairingPipeline || streamAttemptRef.current !== publisherAttempt || streamRoleRef.current !== 'publisher' || streamCaptureRef.current !== capture) return
        if (preferences.mode !== 'server' || preferences.dynamicRange === 'hdr') { failStream(error); return }
        if (!pipelineRepairBudget.take()) { clientDiagnostics.record('media', 'stream_publisher_repair_rate_limited', 'warn'); return }
        repairingPipeline = true
        const session = serverStreamRef.current
        try {
          if (!session) { failStream(error); return }
          clientDiagnostics.record('media', 'stream_publisher_pipeline_repair', 'warn', { reason: error.message })
          // Reuse the existing display capture and PeerConnection. Replacing
          // only its video input preserves audio, viewers and capture permission.
          const pipeline = await createSDRPublishPipeline(capture, codec, (failure) => { void repairSDRPipeline(failure) }, { preferCanvas: true })
          if (streamAttemptRef.current !== publisherAttempt || serverStreamRef.current !== session || streamRoleRef.current !== 'publisher') { pipeline.close(); return }
          try { await session.replacePublisherVideoTrack(pipeline.stream.getVideoTracks()[0]!) }
          catch (failure) { pipeline.close(); throw failure }
          if (streamAttemptRef.current !== publisherAttempt || serverStreamRef.current !== session) { pipeline.close(); return }
          const previous = streamPipelineRef.current
          streamPipelineRef.current = pipeline
          setStreamMedia(pipeline.stream)
          previous?.close()
          clientDiagnostics.record('media', 'stream_publisher_pipeline_repaired', 'info')
        } catch (failure) {
          if (streamAttemptRef.current === publisherAttempt && streamRoleRef.current === 'publisher') { clientDiagnostics.record('media', 'stream_publisher_pipeline_repair_failed', 'warn', { error_name: failure instanceof Error ? failure.name : 'Error' }); setStreamError('Не удалось автоматически восстановить видеодорожку. Можно повторно включить показ без перезагрузки страницы.') }
        } finally { repairingPipeline = false }
      }
      let publishStream = capture
      let renditions: StreamRendition[] | undefined
      if (preferences.mode === 'server' && preferences.dynamicRange === 'hdr') {
        const probe = capturedHDRProbe(capture)
        if (!probe?.supported) {
          throw new Error(probe?.reason || 'HDR-источник не прошёл проверку 10-bit BT.2020 PQ/HLG')
        }
        const pipeline = await createHDRPublishPipeline(capture, codec, probe, (error) => {
          clientDiagnostics.record('media', 'hdr_pipeline_failed', 'error', { reason: error.message })
          failStream(error)
        })
        if (streamRoleRef.current !== 'publisher') {
          pipeline.close()
          return
        }
        streamPipelineRef.current = pipeline
        publishStream = pipeline.stream
        renditions = pipeline.renditions
      } else {
        // Auto/SDR must transform the pixels into an 8-bit sRGB surface before
        // WebRTC encoding. Passing a Windows HDR capture straight to H.264 and
        // merely declaring BT.709 produces the blown-out image seen by viewers.
        const pipeline = await createSDRPublishPipeline(capture, codec, (error) => {
          clientDiagnostics.record('media', 'sdr_pipeline_failed', 'error', { reason: error.message })
          void repairSDRPipeline(error)
        })
        if (streamRoleRef.current !== 'publisher') {
          pipeline.close()
          return
        }
        streamPipelineRef.current = pipeline
        publishStream = pipeline.stream
        if (preferences.mode === 'server') renditions = pipeline.renditions
      }
      const audioGain = new StreamAudioGain(publishStream, preferences.publishVolume)
      streamAudioGainRef.current = audioGain
      publishStream = audioGain.stream
      await audioGain.resume()
      if (streamAudioGainRef.current !== audioGain || streamRoleRef.current !== 'publisher') return
      setStreamMedia(publishStream)

      const ended = () => {
        if (streamCaptureRef.current !== capture) return
        // The browser button stops the share: no grace period applies.
        clearCapturedStreamStash(true)
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
          localStream: publishStream,
          onPublisherStalled: preferences.dynamicRange !== 'hdr' ? repairSDRPipeline : undefined,
          renditions,
          preferences,
          codec,
          iceConfiguration,
          onAnswer: (sdp) => trackStreamRequest(realtimeRef.current?.answerStream(sdp) ?? null, 'media'),
          onICECandidate: (candidate) => trackStreamRequest(realtimeRef.current?.sendStreamICECandidate(candidate) ?? null, 'media'),
          onConnectionStateChange: connectionState,
          onQualityStats: setStreamQuality,
          onError: failStream,
        })
      } else {
        p2pStreamPublisherRef.current = new BrowserP2PStreamPublisher({
          localStream: publishStream,
          preferences,
          codec,
          iceConfiguration,
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
        renditions,
      )
      if (!trackStreamRequest(requestId, 'start')) throw new Error('Realtime-соединение недоступно')
      if (preferences.includeAudio && capture.getAudioTracks().length === 0) {
        setStreamError('Выбранный источник не передал системный звук; видео продолжает транслироваться')
      } else if (capturedAudioIncludesOwnPlayback(capture)) {
        setStreamError('Браузер не смог убрать голоса из Voxhold из звука экрана — друзья услышат себя. Покажите отдельную вкладку или отключите звук трансляции')
      }
    } catch (error) {
      failStream(error)
    }
  }

  // The stream always belongs to the active voice channel, not to the channel
  // that is currently open: recovery and SDR rewatch run while the viewer
  // browses other channels with the mini player.
  const watchStream = async (forceSDR = false, rewatch = false, restoring = false) => {
    const activeVoice = voiceSessionRef.current
    const client = realtimeRef.current
    const channel = activeVoice
      ? channelsRef.current.find((item) => item.id === activeVoice.channelId && item.server_id === activeVoice.serverId)
      : null
    if (!client || !activeVoice || !channel || channel.kind !== 'voice' || (voiceStatus !== 'connected' && !restoring)) {

      setStreamError('Сначала подключитесь к этому голосовому каналу')
      return
    }
    const streamServerId = activeVoice.serverId
    const activeStream = streamsRef.current[channel.id]
    if (!activeStream || streamRoleRef.current) return
    let runtime: typeof import('../services/stream')
    let hdr: typeof import('../services/hdrCapabilities')
    try { [runtime, hdr] = await Promise.all([import('../services/stream'), import('../services/hdrCapabilities')]) }
    catch (error) { failStream(error); return }
    if (voiceSessionRef.current?.channelId !== channel.id || streamRoleRef.current) return
    const { BrowserServerStreamSession, BrowserP2PStreamViewer, supportedStreamCodecs } = runtime
    const { detectHDRCapabilities, streamWatchCapabilities } = hdr
    if (!supportedStreamCodecs('receive').includes(activeStream.codec)) {
      setStreamError(`Кодек ${activeStream.codec.toUpperCase()} не поддерживается этим браузером`)
      return
    }

    if (!rewatch && !restoring) { streamRewatchBudgetRef.current = new RetryBudget(2, 2 * 60_000); setStreamCinema(false); setStreamExpanded(true) }
    setStreamError('')
    const viewerAttempt = ++streamAttemptRef.current
    streamRoleRef.current = 'viewer'
    setStreamRole('viewer')
    setStreamStatus('signaling')
    const iceConfiguration = await ensureWebRTCConfig()
    if (streamRoleRef.current !== 'viewer' || streamAttemptRef.current !== viewerAttempt) return
    const connectionState = (state: RTCPeerConnectionState) => {
      if (streamRoleRef.current !== 'viewer' || streamAttemptRef.current !== viewerAttempt) return
      if (state === 'connected') setStreamStatus('connected')
      else if (state === 'connecting' || state === 'disconnected') setStreamStatus('signaling')
      else if (state === 'failed') setStreamStatus('signaling')
    }
    const remoteStream = (media: MediaStream) => { if (streamAttemptRef.current === viewerAttempt && streamRoleRef.current === 'viewer') setStreamMedia(media) }
    const reportQuality = (stats: StreamQualityStats) => { if (streamAttemptRef.current !== viewerAttempt || streamRoleRef.current !== 'viewer') return; setStreamQuality({
      ...stats,
      dynamicRange: streamDynamicRangeRef.current,
    }) }
    const watchCapabilities = activeStream.mode === 'server'
      ? streamWatchCapabilities(await detectHDRCapabilities(), forceSDR)
      : undefined
    if (streamRoleRef.current !== 'viewer' || streamAttemptRef.current !== viewerAttempt) return
    if (activeStream.mode === 'server') {
      serverStreamRef.current = new BrowserServerStreamSession({
        preferences: streamPreferencesRef.current,
        codec: activeStream.codec,
        iceConfiguration,
        onAnswer: (sdp) => { if (streamAttemptRef.current === viewerAttempt) trackStreamRequest(realtimeRef.current?.answerStream(sdp) ?? null, 'media') },
        onICECandidate: (candidate) => { if (streamAttemptRef.current === viewerAttempt) trackStreamRequest(realtimeRef.current?.sendStreamICECandidate(candidate) ?? null, 'media') },
        onRequestRecovery: (action) => {
          if (streamAttemptRef.current !== viewerAttempt || streamRoleRef.current !== 'viewer') return
          trackStreamRequest(
            realtimeRef.current?.requestStreamRecovery(streamServerId, channel.id, action) ?? null,
            'media',
          )
        },
        onRequestRewatch: () => {
          if (streamAttemptRef.current !== viewerAttempt || streamRoleRef.current !== 'viewer') return
          const client = realtimeRef.current
          if (pendingStreamRewatchRef.current) return
          if (!streamRewatchBudgetRef.current.take()) {
            failStream(new Error('Не удалось восстановить трансляцию. Подключитесь к просмотру ещё раз.'))
            return
          }
          pendingStreamRewatchRef.current = {
            forceSDR: streamDynamicRangeRef.current !== 'sdr',
          }
          serverStreamRef.current?.close()
          serverStreamRef.current = null
          const requestId = client?.leaveStream() ?? null
          if (pendingStreamRewatchRef.current) pendingStreamRewatchRef.current.requestId = requestId ?? undefined
          if (!trackStreamRequest(requestId, 'leave')) {
            pendingStreamRewatchRef.current = null
            failStream(new Error('Realtime-соединение недоступно для восстановления трансляции'))
          }
        },
        onRemoteStream: remoteStream,
        onConnectionStateChange: connectionState,
        onQualityStats: reportQuality,
        onError: (error) => { if (streamAttemptRef.current === viewerAttempt) failStream(error) },
      })
    } else {
      p2pStreamViewerRef.current = new BrowserP2PStreamViewer({
        iceConfiguration,
        onAnswer: (target, sdp) => trackStreamRequest(realtimeRef.current?.sendStreamP2PAnswer(target, sdp) ?? null, 'media'),
        onICECandidate: (target, candidate) => trackStreamRequest(realtimeRef.current?.sendStreamP2PICECandidate(target, candidate) ?? null, 'media'),
        onRestartRequest: (target) => trackStreamRequest(realtimeRef.current?.requestStreamP2PRestart(target) ?? null, 'media'),
        onRemoteStream: remoteStream,
        onConnectionStateChange: connectionState,
        onQualityStats: reportQuality,
        onError: (error) => { if (streamAttemptRef.current === viewerAttempt) failStream(error) },
      })
    }
    if (!trackStreamRequest(client.watchStream(streamServerId, channel.id, watchCapabilities), 'watch')) {
      failStream(new Error('Realtime-соединение недоступно'))
    }
  }

  streamWatchActionRef.current = (forceSDR, rewatch, restoring) => {
    void watchStream(forceSDR, rewatch, restoring)
  }
	streamStartActionRef.current = (restoring) => {
		void startStream(restoring)
	}

  const finishFailedRecovery = useCallback((message: string) => {
    playUISound('self_leave')
    setMediaRecovering(false)
    setVoiceError(message)
    clearCapturedStreamStash(true)
    streamCaptureRef.current?.getTracks().forEach((track) => track.stop())
    streamCaptureRef.current = null
    detachMediaPeers()
    voiceInputRef.current?.close()
    voiceInputRef.current = null
    voiceSessionRef.current = null
    setVoiceSession(null)
    setVoiceStatus('idle')
  }, [clearCapturedStreamStash, detachMediaPeers, playUISound])

  /** Recreates the voice session on the new connection with the same mic. */
  const resumeAfterReconnect = useCallback(async (generation: number) => {
    const coordinator = recoveryRef.current
    if (!coordinator || coordinator.generation !== generation) return
    const intent = coordinator.intent
    const client = realtimeRef.current
    if (!intent || !client) {
      coordinator.fail('realtime client unavailable')
      finishFailedRecovery('Realtime-соединение недоступно. Подключитесь к голосовому каналу заново')
      return
    }

    const input = voiceInputRef.current
    if ((!input || !input.isHealthy) && input) await input.retry().catch(() => undefined)
    if (!input || !input.isHealthy) {
      coordinator.fail('microphone lost during disconnect')
      finishFailedRecovery('Не удалось восстановить микрофон после обрыва. Подключитесь к голосовому каналу заново')
      return
    }

    const pending: ActiveVoiceSession = {
      serverId: intent.serverId,
      channelId: intent.channelId,
      channelName: intent.channelName,
      connectionId: null,
      selfMute: intent.selfMute,
      selfDeaf: intent.selfDeaf,
    }
    voiceSessionRef.current = pending
    setVoiceSession(pending)
    setVoiceStatus('signaling')

    try {
      const iceConfiguration = await ensureWebRTCConfig()
      if (recoveryRef.current !== coordinator || coordinator.generation !== generation) return
      const media = new BrowserVoiceSession({
        input,
        iceConfiguration,
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
        onInputError: (error) => { if (voiceMediaRef.current === media) { setMicUnavailable(true); setVoiceError(voiceErrorMessage(error)) } },
        onError: () => undefined,
        onRemoteLevels: applyRemoteLevels,
        onPlaybackBlocked: () => setVoicePlaybackBlocked(true),
      })
      voiceMediaRef.current = media
      await media.start(pending.selfMute, pending.selfDeaf, voicePreferencesRef.current)
      if (recoveryRef.current !== coordinator || coordinator.generation !== generation) return

      // Sending the request is not success: the rejoin completes when the
      // server confirms it via voice.joined -> markVoiceJoined.
      const requestId = client.joinVoice(pending.serverId, pending.channelId, pending.selfMute, pending.selfDeaf)
      if (!trackVoiceRequest(requestId, 'join')) throw new Error('Realtime-соединение недоступно')
    } catch {
      coordinator.fail('voice rejoin failed')
      finishFailedRecovery('Не удалось восстановить голосовой канал после обрыва. Подключитесь заново')
    }
  }, [finishFailedRecovery, ensureWebRTCConfig, applyRemoteLevels, trackVoiceRequest])

  /**
   * Unexpected WebSocket loss: close peers only, keep the microphone and the
   * screen capture alive for a bounded grace period, then wait for `ready`.
   * `voice_closed`: the server ended the media session while signalling is
   * still up, so the same connection rejoins at once.
   */
  const beginSignallingRecovery = useCallback((cause: 'signalling' | 'voice_closed' = 'signalling') => {
    const active = voiceSessionRef.current
    if (!active) return
    // Read before detachMediaPeers() resets it: the intent decides whether
    // the stream is restored after the voice rejoin.
    const streamRole = streamRoleRef.current
    recoveryRef.current?.cancel('superseded by newer disconnect')
    stashCapturedStream(cause === 'signalling' ? 'signalling_offline' : 'voice_closed_by_server')
    detachMediaPeers()

    const coordinator = new SignallingRecoveryCoordinator(
      {
        beginVoiceRejoin: (generation) => { void resumeAfterReconnect(generation) },
        restoreStream: (_generation, intent) => {
          try {
			if (intent.streamRole === 'viewer') streamWatchActionRef.current(false, false, true)
			else if (intent.streamRole === 'publisher' && streamCaptureRef.current) streamStartActionRef.current(true)
          } finally {
            recoveryRef.current?.markStreamRestored()
          }
        },
        finished: (phase) => {
          setMediaRecovering(false)
          if (phase === 'expired') {
            finishFailedRecovery('')
            // Shown after cleanup so the reason is not overwritten.
            setVoiceError('Не удалось восстановить соединение за минуту. Подключитесь к голосовому каналу заново')
          }
        },
      },
      undefined,
      60_000,
    )
    coordinator.begin({
      serverId: active.serverId,
      channelId: active.channelId,
      channelName: active.channelName,
      // An in-place rejoin keeps the WebSocket connection id, so the new
      // voice.joined must not be mistaken for the dead generation.
      staleConnectionId: cause === 'signalling' ? active.connectionId : null,
      selfMute: active.selfMute,
      selfDeaf: active.selfDeaf,
      streamRole,
    })
    recoveryRef.current = coordinator
    setMediaRecovering(true)
    setVoiceError('')
    clientDiagnostics.record('media', 'media_recovery_started', 'warn', {
      cause,
      stream_role: streamRole ?? null,
    })
    if (cause === 'voice_closed') coordinator.handleReady()
  }, [resumeAfterReconnect, stashCapturedStream, detachMediaPeers, finishFailedRecovery])

  recoveryActionsRef.current.offline = () => beginSignallingRecovery('signalling')
  recoveryActionsRef.current.voiceClosed = () => beginSignallingRecovery('voice_closed')
  recoveryActionsRef.current.ready = () => { recoveryRef.current?.handleReady() }

  const retryMicrophone = async () => {
    const input = voiceInputRef.current
    if (!input) return
    await input.retry()
    if (input.isHealthy) {
      setMicUnavailable(false)
      setVoiceError('')
    }
  }


  /** Silences the shared system audio for viewers without restarting. */
  const toggleStreamAudio = () => {
    const capture = streamCaptureRef.current
    if (!capture || streamRoleRef.current !== 'publisher') return
    const muted = !streamAudioMuted
    // The publish pipeline forwards these same track objects.
    capture.getAudioTracks().forEach((track) => { track.enabled = !muted })
    setStreamAudioMuted(muted)
  }

  const leaveStream = () => {
    const role = streamRoleRef.current
    if (!role) return
    // An explicit stop releases the stashed capture immediately.
    clearCapturedStreamStash(true)
    pendingStreamRewatchRef.current = null
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

  const updateLocalVoiceState = useCallback((selfMute: boolean, selfDeaf: boolean) => {
    const active = voiceSessionRef.current
    if (!active) return
    const updated = { ...active, selfMute, selfDeaf }
    voiceSessionRef.current = updated
    setVoiceSession(updated)
    voiceMediaRef.current?.setState(selfMute, selfDeaf)
    if (active.selfDeaf && !selfDeaf) voiceMediaRef.current?.resumeAudio()
    if (!trackVoiceRequest(realtimeRef.current?.updateVoiceState(selfMute, selfDeaf) ?? null, 'state')) {
      setVoiceError('Realtime-соединение недоступно')
      closeVoiceLocally()
    }
  }, [closeVoiceLocally, trackVoiceRequest])

  // Explicit toggles (buttons, shortcuts) confirm themselves with a cue;
  // push-to-talk drives updateLocalVoiceState directly and stays silent.
  const toggleSelfMute = useCallback(() => {
    const active = voiceSessionRef.current
    if (!active) return
    playUISound(active.selfMute ? 'unmute' : 'mute')
    updateLocalVoiceState(!active.selfMute, active.selfDeaf)
  }, [playUISound, updateLocalVoiceState])

  const toggleSelfDeaf = useCallback(() => {
    const active = voiceSessionRef.current
    if (!active) return
    playUISound(active.selfDeaf ? 'undeafen' : 'deafen')
    updateLocalVoiceState(active.selfMute, !active.selfDeaf)
  }, [playUISound, updateLocalVoiceState])

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
    clientDiagnostics.record('media', 'voice_settings_opened', 'info', { voice_active: !!voiceSessionRef.current, stream_role: streamRoleRef.current ?? null })
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
        toggleSelfMute()
      } else if (shortcutMatches(event, preferences.deafenShortcut)) {
        event.preventDefault()
        toggleSelfDeaf()
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
  }, [updateLocalVoiceState, toggleSelfMute, toggleSelfDeaf])

  const openActiveVoiceChannel = () => {
    const active = voiceSessionRef.current
    if (!active) return
    openCommunityChannels()
    if (active.serverId === selectedServerId) {
      selectChannel(active.channelId)
      return
    }
    setPinnedMessages([]); setChannels([]); setMembers([]); setSelectedServerId(active.serverId); setSelectedChannelId(active.channelId); setMessageTarget(null); setFocusedMessageId(null); setMessagePanel(null); setMobileNav(false)
  }

  const openMessage = (channelId: number, messageId: number) => {
    const channel = channels.find((item) => item.id === channelId)
    if (!channel) {
      notify('Канал для этого сообщения недоступен', 'error')
      return
    }
    openCommunityChannels()
    if (channel.kind === 'voice') setVoiceChatOpen(true)
    setMessageTarget({ channelId, messageId })
    setMessageFocusVersion((value) => value + 1)
    setFocusedMessageId(messageId)
    setSelectedChannelId(channelId)
    setMessagePanel(null)
    setMobileNav(false)
  }

  const createChannel = async (name: string, kind: ChannelKind) => {
    if (!token || !selectedServerId) return
    const created = await api.channels.create(token, selectedServerId, name, kind)
    setPinnedMessages([]); setChannels((current) => {
      const nextChannel = { ...created, last_message_id: created.last_message_id ?? current.find((item) => item.id === created.id)?.last_message_id ?? 0 }
      const next = [...current.filter((item) => item.id !== created.id), nextChannel]
        .sort((left, right) => left.position - right.position || left.id - right.id)
      channelsRef.current = next
      return next
    }); setSelectedChannelId(created.id)
    notify('Канал создан', 'success')
  }

  const openChannelSettings = (channel: Channel) => {
    setEditingChannel(channel)
    setDialog('channelSettings')
  }

  const openServerSettings = () => {
    setDialog('settings')
    if (!token || selectedServer?.role !== 'owner') return

    setCorsOriginsLoading(true)
    void api.corsOrigins.get(token)
      .then((payload) => setCorsOrigins(payload.origins))
      .catch((error: unknown) => handleError(error, 'Не удалось загрузить CORS-настройки'))
      .finally(() => setCorsOriginsLoading(false))
    setRecordingStorage(null)
    void api.recordings.storage(token)
      .then(setRecordingStorage)
      .catch((error: unknown) => handleError(error, 'Не удалось загрузить лимит записей'))
  }

  const saveRecordingQuota = async (quotaBytes: number) => {
    if (!token || selectedServer?.role !== 'owner') throw new Error('Настройки доступны только владельцу')
    const storage = await api.recordings.setQuota(token, quotaBytes)
    setRecordingStorage(storage)
    notify('Лимит записей сохранён', 'success')
  }

  const saveCorsOrigins = async (origins: string[]) => {
    if (!token || selectedServer?.role !== 'owner') throw new Error('Настройки доступны только владельцу')
    const payload = await api.corsOrigins.replace(token, origins)
    setCorsOrigins(payload.origins)
    notify('CORS-настройки сохранены', 'success')
    return payload.origins
  }

  const downloadClientDiagnostics = async () => {
    if (!token) return
    await clientDiagnostics.flush()
    const payload = await api.diagnostics.list(token)
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    downloadBlob(blob, `voxhold-diagnostics-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
    notify(`Диагностика выгружена: ${payload.events.length} событий`, 'success')
  }

  const renameChannel = async (name: string) => {
    if (!token || !selectedServerId || !editingChannel) return
    const updated = await api.channels.update(token, selectedServerId, editingChannel.id, name)
    setChannels((current) => current.map((channel) => channel.id === updated.id ? { ...channel, ...updated, last_message_id: updated.last_message_id ?? channel.last_message_id } : channel))
    setEditingChannel((current) => current ? { ...current, ...updated } : updated)
    notify('Канал переименован', 'success')
  }

  const removeChannel = async (channel: Channel) => {
    if (!token || !selectedServerId) return
    await api.channels.delete(token, selectedServerId, channel.id)
    const remaining = channelsRef.current.filter((item) => item.id !== channel.id)
    channelsRef.current = remaining
    setChannels(remaining)
    if (activeChannelRef.current === channel.id) {
      const nextChannel = pickDefaultChannel(remaining)
      setPinnedMessages([]); setFocusedMessageId(null); setMessageTarget(null); setSelectedChannelId(nextChannel?.id ?? null)
    }
    notify('Канал удалён', 'success')
  }

  const deleteChannel = async () => {
    if (!editingChannel) return
    await removeChannel(editingChannel)
    setEditingChannel(null)
  }

  const openUserProfile = async (userId: number, role: ServerRole) => {
    if (!token) return
    if (userId === user?.id) {
      setDialog('profile')
      return
    }
    const generation = ++profileGeneration.current
    setMemberCardAnchor({ ...memberAnchor.current })
    setMemberCardOpen(true)
    setViewedProfile(null)
    setViewedProfileRole(role)
    setViewedProfileError('')
    setViewedProfileLoading(true)
    setDialog(null)
    try {
      const next = await api.profile.byUser(token, userId)
      if (generation === profileGeneration.current) setViewedProfile(next)
    } catch (error) {
      if (generation === profileGeneration.current) setViewedProfileError(humanError(error))
    } finally {
      if (generation === profileGeneration.current) setViewedProfileLoading(false)
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

  const changeMemberRole = async (userId: number, username: string, role: 'member' | 'admin') => {
    if (!token || !selectedServerId) return
    const updated = await api.servers.updateMemberRole(token, selectedServerId, userId, role)
    setMembers((current) => current.map((member) => member.user_id === updated.user_id ? updated : member))
    setViewedProfileRole((current) => viewedProfileRef.current?.user_id === userId ? updated.role : current)
    notify(`Роль ${username} обновлена`, 'success')
  }

  const banMemberOnInstance = async (userId: number, username: string) => {
    if (!token || !selectedServerId) return
    await api.servers.banMember(token, selectedServerId, userId)
    setMembers((current) => current.filter((member) => member.user_id !== userId))
    notify(`${username} забанен на инстансе`, 'success')
  }

  const updateUserVolume = useCallback((userId: number, volume: number) => {
    const value = Math.min(200, Math.max(0, volume))
    setUserVolumes((current) => {
      const next = { ...current, [userId]: value }
      saveUserVolumes(next)
      return next
    })
    // Menu items are snapshots created on right-click. Keep only this user's
    // open slider in sync with the same value applied to live remote audio.
    const key = `volume-${userId}`
    setContextMenu((current) => {
      if (!current?.items.some((item) => item.kind === 'volume' && item.key === key)) return current
      return { ...current, items: current.items.map((item) => item.kind === 'volume' && item.key === key ? { ...item, value } : item) }
    })
  }, [])

  // Per-user loudness is applied to the live WebRTC session as soon as the
  // participant map or the stored overrides change.
  useEffect(() => {
    const media = voiceMediaRef.current
    if (!media) return
    Object.values(voiceParticipants).forEach((participant) => {
      const volume = userVolumes[participant.user_id]
      if (volume !== undefined) media.setRemoteGain(participant.connection_id, volume / 100)
    })
  }, [userVolumes, voiceParticipants])

  const openMenu = (event: ReactMouseEvent, items: ContextMenuItem[], title?: string) => {
    event.preventDefault()
    event.stopPropagation()
    setContextMenu({ x: event.clientX, y: event.clientY, ...(title ? { title } : {}), items })
  }

  const memberPermissions = (target: ServerMember) => ({
    canChangeRole: !!selectedServer && selectedServer.role === 'owner' && target.role !== 'owner' && target.user_id !== user?.id,
    canRemove: !!selectedServer && target.user_id !== user?.id && target.role !== 'owner'
      && (selectedServer.role === 'owner' || (selectedServer.role === 'admin' && target.role === 'member')),
  })

  const openChannelMenu = (event: ReactMouseEvent, channel: Channel) => {
    const items: ContextMenuItem[] = [
      {
        key: 'open',
        kind: 'action',
        icon: channel.kind === 'news' ? 'news' : channel.kind === 'text' ? 'hash' : 'volume',
        label: channel.kind !== 'voice' ? 'Открыть канал' : 'Зайти в канал',
        onSelect: () => selectChannel(channel.id),
      },
    ]
    if (channel.kind !== 'voice') items.push({ key: 'notifications', kind: 'action', icon: 'bell', label: 'Уведомления', onSelect: () => { setNotificationSettings(null); setNotificationChannel(channel) } })
    if (canManage) {
      items.push({ key: 'sep-manage', kind: 'separator' })
      items.push({ key: 'edit', kind: 'action', icon: 'edit', label: 'Изменить канал', onSelect: () => openChannelSettings(channel) })
      items.push({
        key: 'delete',
        kind: 'action',
        icon: 'trash',
        label: 'Удалить канал',
        danger: true,
        onSelect: () => setConfirmRequest({
          title: `Удалить «${channel.name}»?`,
          description: 'Канал и его история исчезнут для всех участников. Это действие нельзя отменить.',
          confirmLabel: 'Удалить канал',
          action: () => removeChannel(channel),
        }),
      })
    }
    openMenu(event, items, channel.name)
  }

  const openMemberMenu = (event: ReactMouseEvent, member: ServerMember, options?: { volume?: boolean }) => {
    const { canChangeRole, canRemove } = memberPermissions(member)
    const items: ContextMenuItem[] = [
      { key: 'profile', kind: 'action', icon: 'people', label: 'Просмотреть профиль', onSelect: () => void openUserProfile(member.user_id, member.role) },
    ]
    if (canChangeRole) items.push({ key: 'roles', kind: 'roles', currentRole: member.role === 'admin' ? 'admin' : 'member', onChange: (role) => void changeMemberRole(member.user_id, member.username, role).catch((error: unknown) => handleError(error)) })
    if (canRemove) items.push({
      key: 'remove',
      kind: 'action',
      icon: 'warning',
      label: 'Забанить на инстансе',
      danger: true,
      onSelect: () => setConfirmRequest({
        title: `Забанить ${member.username} на инстансе?`,
        description: `${member.username} потеряет доступ к пространству и будет забанен на этом инстансе.`,
        confirmLabel: 'Забанить',
        action: () => banMemberOnInstance(member.user_id, member.username),
      }),
    })
    if (options?.volume) {
      items.push({ key: 'sep-volume', kind: 'separator' })
      items.push({ key: `volume-${member.user_id}`, kind: 'volume', value: userVolumes[member.user_id] ?? 100, onChange: (value) => updateUserVolume(member.user_id, value) })
    }
    openMenu(event, items, member.username)
  }

  const openVoiceParticipantMenu = (event: ReactMouseEvent, participant: VoiceParticipant, member: ServerMember | undefined) => {
    openMemberMenu(event, member ?? {
      user_id: participant.user_id, username: `Пользователь #${participant.user_id}`, role: 'member',
      created_at: 0, joined_at: 0, about: '', country_code: null, last_seen_at: null,
    }, { volume: true })
  }

  const listInviteLinks = useCallback((beforeId?: number, signal?: AbortSignal) => {
    if (!token || !selectedServerId) throw new Error('Сервер не выбран')
    return api.inviteLinks.list(token, selectedServerId, beforeId, signal)
  }, [api, token, selectedServerId])

  const revokeInviteLink = useCallback(async (id: number) => {
    if (!token || !selectedServerId) throw new Error('Сервер не выбран')
    await api.inviteLinks.revoke(token, selectedServerId, id)
    notify('Ссылка закрыта', 'success')
  }, [api, token, selectedServerId, notify])

  const returnToLatest = async () => {
    if (!selectedServerId || !selectedChannelId) return
    setMessageTarget(null); setFocusedMessageId(null)
    await historyStore.latest(selectedServerId, selectedChannelId).catch((error) => handleError(error))
  }

  const setMessageReaction = useCallback(async (messageId: number, emoji: string, active: boolean) => {
    if (!token || !selectedServerId || !selectedChannelId) throw new Error('Канал не выбран')
    try {
      const event = await api.messages.setReaction(token, selectedServerId, selectedChannelId, messageId, emoji, active)
      historyStore.reactions(event)
      if (event.channel_id === activeChannelRef.current) setPinnedMessages((current) => current.map((pin) => pin.message.id === event.message_id ? { ...pin, message: withReactions(pin.message, event) } : pin))
    } catch (caught) { throw new Error(humanError(caught)) }
  }, [api, token, selectedServerId, selectedChannelId, historyStore])
  const loadMessageReactors = useCallback<ReactorLoader>((messageId, emoji, signal, after) => {
    if (!token || !selectedServerId || !selectedChannelId) return Promise.reject(new Error('Канал не выбран'))
    return api.messages.reactors(token, selectedServerId, selectedChannelId, messageId, emoji, signal, after)
  }, [api, token, selectedServerId, selectedChannelId])
  const forwardMessage = async (serverId: number, channel: Channel, key: string) => {
    const source = forwardSource, credentials = token
    if (!source || !credentials) throw new Error('Сообщение недоступно')
    await historyStore.forward(serverId, channel.id, { server_id: source.serverId, channel_id: source.message.channel_id, message_id: source.message.id, author: source.message.author, content: source.message.content, created_at: source.message.created_at, forward: source.message.forward }, key)
    if (workspaceActive.current && activeToken.current === credentials) notify(`Сообщение переслано в «${channel.name}»`, 'success')
  }
  const sendMessage = async (content: string, reply?: MessageReply, attachmentIds?: string[]) => {
    if (!token || !selectedServerId || !selectedChannelId) return
    const created = await historyStore.send(selectedServerId, selectedChannelId, content, undefined, reply, undefined, undefined, undefined, attachmentIds)
    if (created) recordLastMessage(created.channel_id, created.id)
  }

  const editMessage = async (messageId: number, content: string) => {
    if (!token || !selectedServerId || !selectedChannelId) return
    try {
      const updated = await api.messages.update(token, selectedServerId, selectedChannelId, messageId, content)
      historyStore.receive(updated)
      setPinnedMessages((current) => current.map((pin) => pin.message.id === updated.id ? { ...pin, message: newerMessage(pin.message, updated) } : pin))
    } catch (error) {
      throw new Error(humanError(error))
    }
  }

  const deleteMessage = async (messageId: number) => {
    if (!token || !selectedServerId || !selectedChannelId) return
    try {
      await api.messages.delete(token, selectedServerId, selectedChannelId, messageId)
      historyStore.remove(selectedChannelId, messageId)
      setPinnedMessages((current) => current.filter((pin) => pin.message.id !== messageId))
    } catch (error) {
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
      throw new Error(humanError(error))
    }
  }

  const loadOlder = async () => {
    if (selectedServerId && selectedChannelId) await historyStore.older(selectedServerId, selectedChannelId).catch((error) => handleError(error))
  }
  const loadNewer = async () => {
    if (selectedServerId && selectedChannelId) await historyStore.newer(selectedServerId, selectedChannelId).catch((error) => handleError(error))
  }

  const memberActions = useRef({ openUserProfile, openMemberMenu })
  memberActions.current = { openUserProfile, openMemberMenu }
  const openMemberFromList = useCallback((member: ServerMember) => { void memberActions.current.openUserProfile(member.user_id, member.role) }, [])
  const contextMemberFromList = useCallback((event: ReactMouseEvent, member: ServerMember) => memberActions.current.openMemberMenu(event, member), [])

  const onlineUserIds = useMemo(() => new Set(selectedServerId ? (onlineByServer[selectedServerId] ?? []) : []), [onlineByServer, selectedServerId])
  const recoverStreamPlayback = useCallback(() => {
    if (streamRoleRef.current === 'viewer') serverStreamRef.current?.recoverPlayback()
  }, [])

  const loadChannelMembers = useCallback((channelId: number, signal: AbortSignal) => {
    if (!token || !selectedServerId) return Promise.reject(new Error('Сервер не выбран'))
    return api.channels.members(token, selectedServerId, channelId, signal)
  }, [api, token, selectedServerId])
  const voiceParticipantList = useMemo(() => Object.values(voiceParticipants), [voiceParticipants])
  const selectedVoiceParticipants = useMemo(() => selectedChannel?.kind === 'voice'
    ? voiceParticipantList.filter((participant) => participant.server_id === selectedChannel.server_id && participant.channel_id === selectedChannel.id)
    : [], [selectedChannel, voiceParticipantList])
  const activeVoiceChannel = voiceSession ? { id: voiceSession.channelId, name: voiceSession.channelName } : null
  const activeVoiceStream = voiceSession ? (streams[voiceSession.channelId] ?? null) : null
  useEffect(() => {
    if (!pendingWatch.current || voiceStatus !== 'connected' || voiceSession?.channelId !== pendingWatch.current) return
    pendingWatch.current = null
    void watchStream()
    // The intent is consumed exactly when the requested voice session connects.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceStatus, voiceSession?.channelId])
  const openPublisherStream = (channel: Channel) => {
    selectChannel(channel.id)
    if (voiceSession?.channelId === channel.id && voiceStatus === 'connected') { if (!streamRole) void watchStream(); return }
    pendingWatch.current = channel.id
    // A rejected join must not auto-watch on some later connection to this room.
    void joinVoiceChannel(channel).finally(() => { if (voiceSessionRef.current?.channelId !== channel.id) pendingWatch.current = null })
  }
  const callControls = voiceSession && <CallControls connecting={voiceStatus !== 'connected'} selfMute={voiceSession.selfMute} selfDeaf={voiceSession.selfDeaf} recording={!!recording.activeId} recordBusy={recording.busy} canRecord={!!recording.activeId || (voiceStatus === 'connected' && !recording.records.some((item) => item.channel_id === voiceSession.channelId && item.status === 'recording'))} canShare={voiceStatus === 'connected' && !activeVoiceStream && !streamRole} chatOpen={voiceChatOpen} onMute={toggleSelfMute} onDeaf={toggleSelfDeaf} onRecord={() => { if (recording.activeId) void recording.stop(); else void recording.start() }} onRecordings={() => { recordingSyncRef.current(); setRecordingsOpen(true) }} onChat={() => {
    // From another channel or the expanded player the button opens the room chat; in the room it toggles.
    const inRoom = !streamExpanded && selectedServerId === voiceSession.serverId && selectedChannelId === voiceSession.channelId
    openActiveVoiceChannel(); setStreamExpanded(false); setVoiceChatOpen((value) => inRoom ? !value : true)
  }} onShare={() => openStreamSettings(voiceSession.channelId)} onLeave={leaveVoiceChannel}/>
  const leaveForDirectCall = useRef(leaveVoiceChannel); leaveForDirectCall.current = leaveVoiceChannel
  useEffect(() => { const leave = () => leaveForDirectCall.current(); window.addEventListener('voxhold:direct-call-starting', leave); return () => window.removeEventListener('voxhold:direct-call-starting', leave) }, [])
  const channelChat = <ChatPanel renderComments={token && selectedChannel ? (post, onClose) => <NewsComments key={`${selectedChannel.id}:${post.id}`} api={api} token={token} store={historyStore} channel={selectedChannel} post={post} currentUserId={user?.id ?? 0} currentRole={selectedServer?.role} canManage={!!canManage || ((selectedChannel?.permissions ?? 0) & 16) !== 0} members={members} pending={history.pending} focusId={focusedMessageId} onClose={onClose} onOpenProfile={(id, _username, role) => { void openUserProfile(id, role) }}/> : undefined} key={selectedChannel?.id ?? 0} channel={selectedChannel} messages={messages} loading={messagesLoading} loadingOlder={loadingOlder} hasMore={hasMore} loadingNewer={loadingNewer} hasNewer={hasNewer} currentUserId={user?.id ?? 0} currentRole={selectedServer?.role} canManage={!!canManage || ((selectedChannel?.permissions ?? 0) & 16) !== 0} members={members} pinnedMessageIds={pinnedMessageIds} focusVersion={messageFocusVersion} focusedMessageId={focusedMessageId} channelReads={selectedChannelId ? (channelReads[selectedChannelId] ?? {}) : {}} onLoadOlder={loadOlder} onLoadNewer={loadNewer} onReturnToLatest={returnToLatest} onReadThrough={markReadThrough} pendingMessages={history.pending} onRetryPending={(item) => { if (selectedServerId && selectedChannelId) void historyStore.send(selectedServerId, selectedChannelId, item.content, item.id) }} onDismissPending={(id) => { if (selectedChannelId) historyStore.dismiss(selectedChannelId, id) }} initialViewport={historyStore.viewport(selectedChannelId)} onViewport={(value) => { historyStore.viewport(selectedChannelId, value); notificationCenter.contextChanged() }} onSend={sendMessage} onSetReaction={setMessageReaction} onLoadReactors={loadMessageReactors} onForward={(message) => { if (selectedServerId) setForwardSource({ serverId: selectedServerId, message }) }} onOpenMessage={(id) => { if (selectedChannelId) void openMessage(selectedChannelId, id) }} isMessageDeleted={(id) => !!selectedChannelId && historyStore.isDeleted(selectedChannelId, id)} onEdit={editMessage} onDelete={deleteMessage} onTogglePin={toggleMessagePin} onOpenProfile={(userId, _username, role) => void openUserProfile(userId, role)}/>
  const streamChannelIsOpen = !personalOpen && !!voiceSession && selectedServerId === voiceSession.serverId && selectedChannelId === voiceSession.channelId && selectedChannel?.kind === 'voice'
  const canChangeViewedRole = !!selectedServer && selectedServer.role === 'owner' && !!viewedProfile && viewedProfile.user_id !== user?.id && viewedProfileRole !== 'owner'
  const canBanViewedMember = !!selectedServer && !!viewedProfile && viewedProfile.user_id !== user?.id && viewedProfileRole !== 'owner' && (selectedServer.role === 'owner' || (selectedServer.role === 'admin' && viewedProfileRole === 'member'))

  if (initialLoading) return <div className="app-loader"><Brand/><div className="loader-line"><i/></div><span>Собираем ваши комнаты…</span></div>

  return (
    <CommunityProvider onOpenProfile={(id, _name, role) => void openUserProfile(id, role)} onViewChange={(active) => { personalOpenRef.current = active; setPersonalOpen(active); setMobileNav(false); setMessagePanel(null) }} api={api} token={token ?? ''} userId={user?.id ?? 0} serverId={selectedServerId} owner={selectedServer?.role === 'owner'} members={members} onMessage={(message) => historyStore.receive(message)} onNavigate={(item) => { setSelectedServerId(item.server_id); setSelectedChannelId(item.channel_id); setMessageTarget({ channelId: item.channel_id, messageId: item.message_id }); setFocusedMessageId(item.message_id); setMessagePanel(null); setMobileNav(false) }}><MediaActivityProvider value={mediaActivity}><AvatarProvider api={api} token={token ?? ''} userId={user?.id ?? 0} versions={avatarVersions}><main className={`workspace ${workspaceLayout.membersOpen ? 'workspace--members-open' : ''}`} style={workspaceLayout.style} onContextMenu={(event) => event.preventDefault()} onPointerDownCapture={(event) => { memberAnchor.current = { x: event.clientX, y: event.clientY } }}>
      <CommunityNavigation/>
      <aside className={`channel-sidebar ${mobileNav ? 'is-mobile-open' : ''}`}>
        {selectedServer ? <>
          <CommunitySidebar><header className="server-header"><div><span className="eyebrow">ПРОСТРАНСТВО</span><h2>{selectedServer.name}</h2></div><button className="icon-button" onClick={openServerSettings} aria-label="Настройки сервера"><Icon name="settings"/></button></header>
          <div className="channel-scroll">
            {channels.some((channel) => channel.kind === 'news') && <ChannelGroup title="Новостные каналы" canAdd={!!canManage} onAdd={() => setDialog('channel')}>
              {channels.filter((channel) => channel.kind === 'news').map((channel) => <ChannelButton key={channel.id} channel={channel} active={selectedChannelId === channel.id} unread={channelHasUnreadMessages(channel, user ? channelReads[channel.id]?.[user.id] : undefined)} canManage={!!canManage} onSelect={() => selectChannel(channel.id)} onEdit={() => openChannelSettings(channel)} onContextMenu={(event) => openChannelMenu(event, channel)}/>)}
            </ChannelGroup>}
            <ChannelGroup title="Текстовые каналы" canAdd={!!canManage} onAdd={() => setDialog('channel')}>
              {channels.filter((channel) => channel.kind === 'text').map((channel) => <ChannelButton key={channel.id} channel={channel} active={selectedChannelId === channel.id} unread={channelHasUnreadMessages(channel, user ? channelReads[channel.id]?.[user.id] : undefined)} canManage={!!canManage} onSelect={() => selectChannel(channel.id)} onEdit={() => openChannelSettings(channel)} onContextMenu={(event) => openChannelMenu(event, channel)}/>)}
            </ChannelGroup>
            <ChannelGroup title="Голосовые каналы" canAdd={!!canManage} onAdd={() => setDialog('channel')}>
              {channels.filter((channel) => channel.kind === 'voice').map((channel) => <ChannelButton key={channel.id} channel={channel} active={selectedChannelId === channel.id} canManage={!!canManage} canShare={voiceSession?.serverId === channel.server_id && voiceSession.channelId === channel.id && voiceStatus === 'connected' && !streams[channel.id] && !streamRole} participants={voiceParticipantList.filter((participant) => participant.server_id === channel.server_id && participant.channel_id === channel.id)} livePublisherId={streams[channel.id]?.publisher_user_id ?? null} membersById={membersById} currentVoiceConnectionId={voiceSession?.connectionId ?? null}  recording={recording.records.some((item) => item.channel_id === channel.id && item.status === 'recording')} unread={channelHasUnreadMessages(channel, user ? channelReads[channel.id]?.[user.id] : undefined)} onWatch={() => openPublisherStream(channel)} onSelect={() => selectChannel(channel.id)} onEdit={() => openChannelSettings(channel)} onShare={() => openStreamSettings(channel.id)} onOpenProfile={(userId, role) => void openUserProfile(userId, role)} onContextMenu={(event) => openChannelMenu(event, channel)} onParticipantContextMenu={openVoiceParticipantMenu}/>)}
            </ChannelGroup>
            {channels.length === 0 && <button className="sidebar-empty" onClick={() => canManage && setDialog('channel')}><span><Icon name="add"/></span><b>{canManage ? 'Создайте первый канал' : 'Нет доступных каналов'}</b><small>{canManage ? 'Начните с общего чата' : 'Попросите администратора предоставить доступ'}</small></button>}
          </div></CommunitySidebar>
          {voiceSession && <VoiceDock channelName={voiceSession.channelName} status={voiceStatus} selfMute={voiceSession.selfMute} selfDeaf={voiceSession.selfDeaf} onOpen={openActiveVoiceChannel} onToggleMute={toggleSelfMute} onToggleDeaf={toggleSelfDeaf} onLeave={leaveVoiceChannel}/>}
          <div className="user-dock"><button className="user-dock__profile" onClick={() => setDialog('profile')}><Avatar userId={user?.id} name={user?.username ?? 'V'} online/><span><b>{user?.username}</b><small><i className={`connection-dot connection-dot--${connection}`}/>{connection === 'online' ? 'В сети' : connection === 'connecting' ? 'Подключение' : 'Не в сети'}</small></span></button><button className="icon-button" onClick={() => setDialog('profile')} title="Настройки профиля" aria-label="Настройки профиля"><Icon name="people"/></button><button className="icon-button" onClick={openVoiceSettings} title="Настройки голоса" aria-label="Настройки голоса"><Icon name="settings"/></button><button className="icon-button" onClick={() => setDialog('logout')} title="Выйти" aria-label="Выйти"><Icon name="logout"/></button></div>
        </> : <CommunitySidebar><div className="sidebar-no-server"><Brand/><p>У вас нет доступа к этому пространству.</p></div></CommunitySidebar>}
        <div className="workspace-resizer workspace-resizer--channels" role="separator" aria-label="Изменить ширину списка каналов" aria-orientation="vertical" tabIndex={0} onPointerDown={(event) => workspaceLayout.beginResize('channels', event)} onKeyDown={(event) => workspaceLayout.handleResizeKey('channels', event)} onDoubleClick={() => workspaceLayout.resetPanel('channels')}/>
      </aside>

      <WorkspaceContentBoundary resetKey={`${selectedServerId}:${selectedChannelId}:${personalOpen}`}><CommunityContent onMenu={() => setMobileNav((value) => !value)}><section className="content-shell">
        {!selectedServer && instance?.initialized && <div className="instance-access-empty"><div className="welcome-art"><span>V</span><i/><i/><i/></div><span className="eyebrow">ДОСТУП ОГРАНИЧЕН</span><h1>Нужно приглашение</h1><p>Ваш аккаунт пока не имеет доступа к этому инстансу. Обратитесь к администратору за ссылкой-приглашением.</p></div>}
        <header className="content-header">
          <div className="content-header__title"><button className="icon-button mobile-menu" onClick={() => setMobileNav((value) => !value)} aria-label="Меню"><Icon name="menu"/></button>{selectedChannel ? <><Icon name={selectedChannel.kind === 'news' ? 'news' : selectedChannel.kind === 'text' ? 'hash' : 'volume'}/><h1>{selectedChannel.name}</h1><span className="header-divider"/><p>{selectedChannel.kind === 'news' ? 'Новости и объявления' : selectedChannel.kind === 'text' ? 'Всё важное — здесь' : 'Голосовая комната'}</p></> : <h1>{selectedServer?.name ?? 'Voxhold'}</h1>}</div>
          <div className="content-header__actions">
            {selectedServer && <button className={`header-action ${messagePanel === 'search' ? 'is-active' : ''}`} onClick={() => setMessagePanel((current) => current === 'search' ? null : 'search')} title="Поиск по серверу"><Icon name="search"/><span>Поиск</span></button>}
            {selectedServer && <button className="header-action" onMouseEnter={() => { void loadRecordingsDialog().catch(() => undefined) }} onFocus={() => { void loadRecordingsDialog().catch(() => undefined) }} onClick={() => { recordingSyncRef.current(); setRecordingsOpen(true) }} title="Список записей" aria-label="Список записей"><Icon name="inbox"/><span>Записи</span></button>}
            {chatVisible && selectedChannel?.kind !== 'voice' && <button className={`header-action header-action--pins ${messagePanel === 'pins' ? 'is-active' : ''}`} onClick={() => setMessagePanel((current) => current === 'pins' ? null : 'pins')} title="Закреплённые сообщения"><Icon name="pin"/><span>Закрепы</span>{pinnedMessages.length > 0 && <b>{pinnedMessages.length}</b>}</button>}
            <button className="header-action theme-toggle" onClick={toggleTheme} title={theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'} aria-label={theme === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему'}><Icon name={theme === 'dark' ? 'sun' : 'moon'}/><span>{theme === 'dark' ? 'Светлая' : 'Тёмная'}</span></button>
            {selectedServer && canManage && <button className="header-action" onClick={() => setDialog('invite')}><Icon name="userPlus"/><span>Пригласить</span></button>}
            <button className={`header-action members-toggle ${workspaceLayout.membersOpen ? 'is-active' : ''}`} onClick={workspaceLayout.toggleMembers} title={workspaceLayout.membersOpen ? 'Скрыть участников' : 'Показать участников'}><Icon name="people"/><span>{members.length}</span></button>
          </div>
        </header>

        {selectedServer ? selectedChannel?.kind === 'voice' ? <VoicePanel onPlaybackRecovery={recoverStreamPlayback} onParticipantContextMenu={openVoiceParticipantMenu} controls={callControls} recordingLabel={recording.records.find((item) => item.channel_id === selectedChannel.id && item.status === 'recording')?.owner_username} chat={voiceChatOpen ? <aside className="voice-channel-chat"><header><div className="voice-channel-chat__tabs" aria-label="Раздел чата канала"><button aria-pressed={messagePanel !== 'pins'} onClick={() => setMessagePanel(null)}>Чат</button><button aria-pressed={messagePanel === 'pins'} onClick={() => setMessagePanel('pins')}><Icon name="pin" size={14}/>Закрепы{pinnedMessages.length > 0 && <small>{pinnedMessages.length}</small>}</button></div><button className="icon-button" onClick={() => { setVoiceChatOpen(false); if (messagePanel === 'pins') setMessagePanel(null) }} aria-label="Закрыть чат"><Icon name="close"/></button></header>{messagePanel === 'pins' ? <PinnedMessagesPanel members={members} currentUserId={user?.id ?? 0} currentRole={selectedServer?.role} docked open pins={pinnedMessages} loading={pinsLoading} canManage={!!canManage} onClose={() => setMessagePanel(null)} onOpenMessage={openMessage} onUnpin={(messageId) => toggleMessagePin(messageId, true)}/> : channelChat}</aside> : null} channel={selectedChannel} activeChannel={activeVoiceChannel} participants={selectedVoiceParticipants} members={members} currentUserId={user?.id ?? 0}  connectionStatus={voiceSession?.channelId === selectedChannel.id ? voiceStatus : 'idle'} realtimeOnline={connection === 'online'} selfMute={voiceSession?.channelId === selectedChannel.id ? voiceSession.selfMute : false} selfDeaf={voiceSession?.channelId === selectedChannel.id ? voiceSession.selfDeaf : false} error={voiceError} recovering={mediaRecovering} micUnavailable={micUnavailable} onRetryMic={() => void retryMicrophone()} playbackBlocked={voicePlaybackBlocked} onEnablePlayback={() => { voiceMediaRef.current?.resumeAudio(); setVoicePlaybackBlocked(false) }} onJoin={() => joinVoiceChannel(selectedChannel)} onLeave={leaveVoiceChannel} onToggleMute={toggleSelfMute} onToggleDeaf={toggleSelfDeaf} onOpenProfile={(userId, role) => void openUserProfile(userId, role)} stream={streams[selectedChannel.id] ?? null} streamStatus={voiceSession?.channelId === selectedChannel.id ? streamStatus : 'idle'} streamError={voiceSession?.channelId === selectedChannel.id ? streamError : ''} streamMedia={voiceSession?.channelId === selectedChannel.id && !streamExpanded ? streamMedia : null} streamPreferences={streamPreferences}  onStreamPreferencesChange={updateStreamPreferences} onOpenStreamSettings={() => openStreamSettings(selectedChannel.id)} onWatchStream={() => void watchStream()} onLeaveStream={leaveStream} onExpandStream={() => { setStreamCinema(false); setStreamExpanded(true) }} onFullscreenStream={() => { setStreamCinema(true); setStreamExpanded(true) }} streamAudioMuted={streamAudioMuted} onToggleStreamAudio={toggleStreamAudio}/> : channelChat : <div className="welcome-empty"><div className="welcome-art"><span>V</span><i/><i/><i/></div><span className="eyebrow">ВАШЕ ПРОСТРАНСТВО</span><h1>Начните с сервера</h1><p>Создайте место для команды, друзей или проекта. Каналы и разговоры приложатся.</p><button className="button button--primary button--large" onClick={() => setDialog('server')}><Icon name="add"/>Создать сервер</button></div>}
        {selectedServer && token && <MessageSearchPanel members={members} currentUserId={user?.id ?? 0} currentRole={selectedServer?.role} key={`${selectedServer.id}:${channels.map((channel) => channel.id).join(',')}`} open={messagePanel === 'search'} api={api} token={token} serverId={selectedServer.id} onClose={() => setMessagePanel(null)} onOpenMessage={openMessage}/>}
        {selectedChannel && !(selectedChannel.kind === 'voice' && voiceChatOpen) && <PinnedMessagesPanel members={members} currentUserId={user?.id ?? 0} currentRole={selectedServer?.role} open={messagePanel === 'pins'} pins={pinnedMessages} loading={pinsLoading} canManage={!!canManage} onClose={() => setMessagePanel(null)} onOpenMessage={openMessage} onUnpin={(messageId) => toggleMessagePin(messageId, true)}/>}
        {messagePanel && !(messagePanel === 'pins' && selectedChannel?.kind === 'voice' && voiceChatOpen) && <button className="message-panel-scrim" aria-label="Закрыть панель" onClick={() => setMessagePanel(null)}/>}
      </section>

      {selectedServer && workspaceLayout.membersOpen && <aside className="members-sidebar is-open">
        <div className="workspace-resizer workspace-resizer--members" role="separator" aria-label="Изменить ширину списка участников" aria-orientation="vertical" tabIndex={0} onPointerDown={(event) => workspaceLayout.beginResize('members', event)} onKeyDown={(event) => workspaceLayout.handleResizeKey('members', event)} onDoubleClick={() => workspaceLayout.resetPanel('members')}/>
        <MembersSidebar lastSeenByUser={lastSeenByUser} refreshKey={rosterRevision} channel={selectedChannel} members={members} onlineUserIds={onlineUserIds} onLoadMembers={loadChannelMembers} onClose={workspaceLayout.closeMembers} onOpenProfile={openMemberFromList} onMemberContextMenu={contextMemberFromList}/>

      </aside>}

      </CommunityContent></WorkspaceContentBoundary>
      {memberCardOpen && <WorkspaceDialogBoundary resetKey={`member:${profileGeneration.current}`} onClose={() => setMemberCardOpen(false)}><MemberCard key={profileGeneration.current} profile={viewedProfile} role={viewedProfileRole} loading={viewedProfileLoading} error={viewedProfileError} online={onlineUserIds.has(viewedProfile?.user_id ?? 0)} anchor={memberCardAnchor} onClose={() => setMemberCardOpen(false)} onOpenProfile={() => { setMemberCardOpen(false); setDialog('userProfile') }} onMessage={() => { if (viewedProfile) window.dispatchEvent(new CustomEvent('voxhold:open-direct', { detail: viewedProfile.user_id })); setMemberCardOpen(false) }}/></WorkspaceDialogBoundary>}
      {mobileNav && <button className="mobile-scrim" aria-label="Закрыть меню" onClick={() => setMobileNav(false)}/>}

      {/* Mini and expanded layouts render different <video> elements; the key
          remounts the player so the new element gets srcObject attached. */}
      {streamRole && streamMedia && voiceSession && (streamExpanded || !streamChannelIsOpen) && <PersistentStreamPlayer
        onPlaybackRecovery={recoverStreamPlayback}
        participants={streamExpanded ? <StreamParticipantStrip participants={voiceParticipantList.filter((participant) => participant.server_id === voiceSession.serverId && participant.channel_id === voiceSession.channelId)} members={members} currentUserId={user?.id ?? 0} onOpenProfile={(userId, role) => { setStreamExpanded(false); void openUserProfile(userId, role) }}/> : undefined}
        key={streamExpanded ? 'expanded' : 'mini'}
        mode={streamExpanded ? 'expanded' : 'mini'}
        stream={activeVoiceStream}
        role={streamRole}
        audioMuted={streamAudioMuted}
        onToggleAudio={toggleStreamAudio}
        status={streamStatus}
        media={streamMedia}
        channelName={voiceSession.channelName}
        preferences={streamPreferences}

        onPreferencesChange={updateStreamPreferences}
        callControls={callControls}
        startInCinema={streamCinema}
        onExpand={() => { setStreamCinema(false); setStreamExpanded(true) }}
        onCollapse={() => { setStreamCinema(false); setStreamExpanded(false) }}
        onLeave={leaveStream}
      />}

      <WorkspaceDialogBoundary resetKey={`${dialog}:${recordingsOpen}:${notificationChannel?.id ?? ''}:${forwardSource?.message.id ?? ''}`} onClose={() => { setDialog(null); setRecordingsOpen(false); setNotificationChannel(null); setForwardSource(null) }}>
      {recordingsOpen && <Suspense fallback={<ModalLoading title="Записи сервера" eyebrow="ЗАПИСИ ЗВОНКОВ" onClose={() => setRecordingsOpen(false)}/>}> <RecordingsDialog limits={recordingStorage ?? recording.limits} channels={channels} open={recordingsOpen} onClose={() => setRecordingsOpen(false)} records={recording.records} locals={recording.locals} serverId={selectedServerId} progress={recording.progress} voiceActive={!!voiceSession} onDownload={recording.download} onRemoveLocal={recording.removeLocal} onRetry={recording.retry} loadPreview={recording.loadPreview} currentUserId={user?.id} onRemoveServer={recording.removeServer}/> </Suspense>}
      <MessageNotifications center={notificationCenter} userId={user?.id ?? 0}/>
      {notificationChannel && token && <Suspense fallback={null}><ChannelNotificationsDialog key={notificationChannel.id} open channel={notificationChannel} api={api} token={token} liveSettings={notificationSettings} onSaved={(value) => { notificationCenter.setSettings(value); setNotificationSettings(value) }} onClose={() => setNotificationChannel(null)} onPreviewSound={() => uiSounds.play('message_notification', voicePreferencesRef.current.uiSoundVolume || 50, voicePreferencesRef.current.outputDeviceId)}/></Suspense>}
      {forwardSource && token && <Suspense fallback={<ModalLoading title="Переслать сообщение" onClose={() => setForwardSource(null)}/>}><ForwardMessageDialog key={`${forwardSource.serverId}:${forwardSource.message.id}`} source={forwardSource} servers={servers} members={members} api={api} token={token} onClose={() => setForwardSource(null)} onForward={forwardMessage}/></Suspense>}
      <CreateChannelDialog open={dialog === 'channel'} onClose={() => setDialog(null)} onSubmit={createChannel}/>
      <ChannelSettingsDialog open={dialog === 'channelSettings'} onClose={() => { setDialog(null); setEditingChannel(null) }} channel={editingChannel} accessPanel={dialog === 'channelSettings' && editingChannel && token ? <Suspense fallback={<p>Загружаем…</p>}>{editingChannel.kind === 'news' && <NewsChannelSettings key={`news-${editingChannel.id}`} api={api} token={token} channel={editingChannel} members={members} onSaved={() => channelRefreshRef.current(editingChannel.server_id)}/>}<ChannelAccessSettings key={editingChannel.id} api={api} token={token} channel={editingChannel} members={members} onSaved={() => channelRefreshRef.current(editingChannel.server_id)}/></Suspense> : null} onRename={renameChannel} onRemove={deleteChannel}/>
      <InviteUserDialog onListLinks={listInviteLinks} onRevokeLink={revokeInviteLink} open={dialog === 'invite'} onClose={() => setDialog(null)} server={selectedServer} onCreateLink={async (input) => { if (!token || !selectedServerId) throw new Error('Сервер не выбран'); const link = await api.inviteLinks.create(token, selectedServerId, input); notify('Ссылка создана', 'success'); return link }}/>
      <ProfileDialog open={dialog === 'profile'} onClose={() => setDialog(null)} profile={profile} hasAvatar={!!user && !!avatarVersions.get(user.id)} onAvatar={async (file, crop) => { if (!token || !user) return; if (file) setMemberAvatar(user.id, (await api.profile.uploadAvatar(token, file, crop)).etag); else { await api.profile.removeAvatar(token); setMemberAvatar(user.id, null) } }} onSubmit={async (patch) => { if (!token) return; const updated = await api.profile.update(token, patch); setProfile(updated); notify('Профиль обновлён', 'success') }}/>
      <MemberProfileDialog onMessage={viewedProfile && viewedProfile.user_id !== user?.id ? () => { window.dispatchEvent(new CustomEvent('voxhold:open-direct', { detail: viewedProfile.user_id })); setDialog(null) } : undefined} online={onlineUserIds.has(viewedProfile?.user_id ?? 0)} open={dialog === 'userProfile'} onClose={() => setDialog(null)} profile={viewedProfile} role={viewedProfileRole} loading={viewedProfileLoading} error={viewedProfileError} canChangeRole={canChangeViewedRole} canBan={canBanViewedMember} onRoleChange={changeViewedMemberRole} onBan={banViewedMember}/>
      {dialog === 'voiceSettings' && <VoiceSettingsDialog open onClose={() => setDialog(null)} preferences={voicePreferences} devices={voiceDevices} getInputLevel={getVoiceInputLevel} voiceActive={!!voiceSession} loadingDevices={voiceDevicesLoading} onChange={updateVoicePreferences} onRefreshDevices={refreshVoiceDevices}/>}
      {dialog === 'streamSettings' && <Suspense fallback={<ModalLoading title="Трансляция экрана" onClose={() => setDialog(null)}/>}> <StreamSettingsDialog open={dialog === 'streamSettings'} busy={streamStatus !== 'idle'} preferences={streamPreferences} onChange={updateStreamPreferences} onClose={() => setDialog(null)} onStart={() => { setDialog(null); void startStream() }}/> </Suspense>}
      <LogoutConfirmDialog open={dialog === 'logout'} onClose={() => setDialog(null)} onConfirm={logout}/>
      {contextMenu && <ContextMenu menu={contextMenu} onClose={() => setContextMenu(null)}/>}
      {confirmRequest && <ConfirmDialog open title={confirmRequest.title} description={confirmRequest.description} confirmLabel={confirmRequest.confirmLabel} onClose={() => setConfirmRequest(null)} onConfirm={confirmRequest.action}/>}
      <ServerSettingsDialog storageApi={api} storageToken={token ?? undefined} open={dialog === 'settings'} onClose={() => setDialog(null)} server={selectedServer} corsOrigins={corsOrigins} corsOriginsLoading={corsOriginsLoading} onRename={async (name) => { if (!token || !selectedServer) return; const updated = await api.servers.update(token, selectedServer.id, name); setServers((current) => current.map((item) => item.id === selectedServer.id ? { ...item, ...updated } : item)); notify('Название обновлено', 'success') }} onDeleteAccount={async () => { if (!token) return; await api.account.delete(token); expire() }} onDownloadDiagnostics={downloadClientDiagnostics} onSaveCorsOrigins={saveCorsOrigins} recordingStorage={recordingStorage} onSaveRecordingQuota={saveRecordingQuota}/>
      </WorkspaceDialogBoundary>
    </main></AvatarProvider></MediaActivityProvider></CommunityProvider>
  )
}

function ChannelGroup({ title, canAdd, onAdd, children }: { title: string; canAdd: boolean; onAdd: () => void; children: React.ReactNode }) {
  return <section className="channel-group"><header><span>{title}</span>{canAdd && <button onClick={onAdd} aria-label={`Добавить: ${title}`}><Icon name="add" size={15}/></button>}</header>{children}</section>
}

function ChannelButton({ recording = false, onWatch, channel, active, unread = false, canManage, canShare = false, participants = [], livePublisherId = null, membersById = new Map<number, ServerMember>(), currentVoiceConnectionId = null, speakingUserIds, onSelect, onEdit, onShare, onOpenProfile, onContextMenu, onParticipantContextMenu }: { recording?: boolean; onWatch?: () => void; channel: Channel; active: boolean; unread?: boolean; canManage: boolean; canShare?: boolean; participants?: VoiceParticipant[]; livePublisherId?: number | null; membersById?: ReadonlyMap<number, ServerMember>; currentVoiceConnectionId?: string | null; speakingUserIds?: number[]; onSelect: () => void; onEdit: () => void; onShare?: () => void; onOpenProfile?: (userId: number, role: ServerRole) => void; onContextMenu?: (event: ReactMouseEvent) => void; onParticipantContextMenu?: (event: ReactMouseEvent, participant: VoiceParticipant, member: ServerMember | undefined) => void }) {
  const speakers = useSpeakingUsers(speakingUserIds)
  const speakingUsers = useMemo(() => new Set(speakers), [speakers])
  return <div className="channel-entry"><div className={`channel-row ${active ? 'is-active' : ''} ${unread ? 'is-unread' : ''}`} onContextMenu={onContextMenu}><button className="channel-row__main" onClick={onSelect} aria-label={`${channel.name}${channel.access_restricted ? ', закрытый канал' : ''}${channel.unread_count ? `, непрочитанных уведомлений: ${channel.unread_count}` : unread ? ', есть непрочитанные сообщения' : ''}`}><Icon name={channel.kind === 'news' ? 'news' : channel.kind === 'text' ? 'hash' : 'volume'} size={17}/>{channel.access_restricted && <span className="channel-row__lock" title="Закрытый канал" aria-label="Закрытый канал"><Icon name="lock" size={17}/></span>}<span className="channel-row__name">{channel.name}</span>{recording && <span className="record-dot is-active" title="Канал записывается" aria-label="Канал записывается"/>}{(channel.unread_count ?? 0) > 0 ? <b className="channel-row__badge" title={`Непрочитанных уведомлений: ${channel.unread_count}`} aria-hidden="true">{channel.unread_count! > 99 ? '99+' : channel.unread_count}</b> : unread && <b className="channel-row__unread" aria-hidden="true"/>}{channel.kind === 'voice' && participants.length > 0 && <i>{participants.length}</i>}</button>{canShare && <button className="channel-row__share" onClick={onShare} title="Поделиться экраном" aria-label={`Поделиться экраном в ${channel.name}`}><Icon name="monitor" size={14}/></button>}{canManage && <button className="channel-row__edit" onClick={onEdit} title="Изменить канал" aria-label={`Изменить ${channel.name}`}><Icon name="edit" size={14}/></button>}</div>{channel.kind === 'voice' && participants.length > 0 && <div className="channel-voice-users">{participants.map((participant) => {
    const member = membersById.get(participant.user_id)
    const username = member?.username ?? `Пользователь #${participant.user_id}`
    const isSpeaking = !participant.self_mute && speakingUsers.has(participant.user_id)
    return <button key={participant.connection_id} className={`${participant.connection_id === currentVoiceConnectionId ? 'is-me' : ''} ${isSpeaking ? 'is-speaking' : ''}`} onClick={() => participant.user_id === livePublisherId ? onWatch?.() : onOpenProfile?.(participant.user_id, member?.role ?? 'member')} onContextMenu={(event) => onParticipantContextMenu?.(event, participant, member)} title={username}><Avatar userId={participant.user_id} name={username} size="small"/><span>{username}</span>{participant.user_id === livePublisherId && <b className="channel-voice-users__live" title="Показывает экран">LIVE</b>}{participant.self_deaf ? <Icon name="headphonesOff" size={12}/> : participant.self_mute ? <Icon name="micOff" size={12}/> : <i/>}</button>
  })}</div>}</div>
}

function VoiceDock({ channelName, status, selfMute, selfDeaf, onOpen, onToggleMute, onToggleDeaf, onLeave }: { channelName: string; status: VoiceConnectionStatus; selfMute: boolean; selfDeaf: boolean; onOpen: () => void; onToggleMute: () => void; onToggleDeaf: () => void; onLeave: () => void }) {
  return <section className="voice-dock"><button className="voice-dock__room" onClick={onOpen}><span><i className={status === 'connected' ? 'is-connected' : ''}/><b>{status === 'connected' ? 'Голос подключён' : 'Подключение…'}</b></span><small><Icon name="volume" size={12}/>{channelName}</small></button><div><button className={selfMute ? 'is-disabled' : ''} onClick={onToggleMute} title={selfMute ? 'Включить микрофон' : 'Выключить микрофон'}><Icon name="mic" size={16}/></button><button className={selfDeaf ? 'is-disabled' : ''} onClick={onToggleDeaf} title={selfDeaf ? 'Включить звук' : 'Выключить звук'}><Icon name="headphones" size={16}/></button><button className="is-leave" onClick={onLeave} title="Отключиться"><Icon name="logout" size={16}/></button></div></section>
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

/** Server reasons that a new watch attempt cannot fix. */
const STREAM_FINAL_CLOSE_REASONS = new Set([
  'stream video bitrate limit exceeded',
  'stream audio bitrate limit exceeded',
  'duplicate stream media track',
  'too many pending ICE candidates',
])

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

function StreamParticipantStrip({ participants, members, currentUserId, onOpenProfile }: { participants: VoiceParticipant[]; members: ServerMember[]; currentUserId: number; onOpenProfile: (userId: number, role: ServerRole) => void }) {
  const speaking = useSpeakingUsers()
  return participants.map((participant) => {
    const member = members.find((candidate) => candidate.user_id === participant.user_id)
    const name = member?.username ?? `Пользователь #${participant.user_id}`
    return <button key={participant.connection_id} className={`stream-focused-participant ${!participant.self_mute && speaking.includes(participant.user_id) ? 'is-speaking' : ''}`} onClick={() => onOpenProfile(participant.user_id, member?.role ?? 'member')}><Avatar userId={participant.user_id} name={name} size="small"/><span>{name}{participant.user_id === currentUserId && <small> · вы</small>}</span>{participant.self_mute && <Icon name="micOff" size={12}/>}</button>
  })
}
