import type {
  Channel,
  ChannelDeletedEvent,
  ChannelRead,
  ChannelReadSnapshot,
  InvitationReceivedEvent,
  Message,
  MessageDeletedEvent,
  MessagePinnedEvent,
  PresenceSnapshot,
  PresenceUpdate,
  ReadSnapshot,
  ServerDeletedEvent,
  ServerMemberChangedEvent,
  ServerMemberRemovedEvent,
  ActiveStream,
  StreamICECandidate,
  StreamMode,
  StreamCodec,
  StreamP2PICECandidate,
  StreamP2PSession,
  StreamSnapshot,
  StreamStopped,
  StreamViewer,
  StreamWatching,
  StreamWebRTCClosed,
  StreamWebRTCOffer,
  VoiceICECandidate,
  VoiceJoined,
  VoiceLeft,
  VoiceParticipant,
  VoiceSnapshot,
  VoiceWebRTCClosed,
  VoiceWebRTCOffer,
} from '../domain/types'
import { clientDiagnostics } from '../platform/clientDiagnostics'

type ConnectionState = 'connecting' | 'online' | 'offline'

interface RealtimeEvent<T = unknown> {
  request_id?: string
  type: string
  data?: T
}

interface Subscription {
  serverId: number
  channelId: number
}

interface RealtimeOptions {
  token: string
  baseUrl?: string
  onMessage: (message: Message) => void
  onMessageUpdated?: (message: Message) => void
  onMessageDeleted?: (event: MessageDeletedEvent) => void
  onMessagePinned?: (event: MessagePinnedEvent) => void
  onMessageUnpinned?: (event: MessageDeletedEvent) => void
  onPresenceSnapshot?: (snapshot: PresenceSnapshot) => void
  onPresenceUpdated?: (update: PresenceUpdate) => void
  onServerMemberJoined?: (event: ServerMemberChangedEvent) => void
  onServerMemberRoleUpdated?: (event: ServerMemberChangedEvent) => void
  onServerMemberRemoved?: (event: ServerMemberRemovedEvent) => void
  onServerDeleted?: (event: ServerDeletedEvent) => void
  onInvitationReceived?: (event: InvitationReceivedEvent) => void
  onChannelCreated?: (channel: Channel) => void
  onChannelUpdated?: (channel: Channel) => void
  onChannelDeleted?: (event: ChannelDeletedEvent) => void
  onReadSnapshot?: (snapshot: ReadSnapshot) => void
  onChannelReadSnapshot?: (snapshot: ChannelReadSnapshot) => void
  onChannelRead?: (read: ChannelRead) => void
  onVoiceJoined?: (event: VoiceJoined) => void
  onVoiceLeft?: (event: VoiceLeft) => void
  onVoiceParticipantJoined?: (participant: VoiceParticipant) => void
  onVoiceParticipantLeft?: (event: VoiceLeft) => void
  onVoiceStateUpdated?: (participant: VoiceParticipant) => void
  onVoiceSnapshot?: (snapshot: VoiceSnapshot) => void
  onVoiceWebRTCOffer?: (offer: VoiceWebRTCOffer) => void
  onVoiceICECandidate?: (candidate: VoiceICECandidate) => void
  onVoiceWebRTCClosed?: (event: VoiceWebRTCClosed) => void
  onStreamStarted?: (stream: ActiveStream) => void
  onStreamUpdated?: (stream: ActiveStream) => void
  onStreamStopped?: (event: StreamStopped) => void
  onStreamWatching?: (event: StreamWatching) => void
  onStreamLeft?: (event: StreamStopped) => void
  onStreamSnapshot?: (snapshot: StreamSnapshot) => void
  onStreamViewerJoined?: (viewer: StreamViewer) => void
  onStreamViewerLeft?: (viewer: StreamViewer) => void
  onStreamWebRTCOffer?: (offer: StreamWebRTCOffer) => void
  onStreamICECandidate?: (candidate: StreamICECandidate) => void
  onStreamWebRTCClosed?: (event: StreamWebRTCClosed) => void
  onStreamP2POffer?: (event: StreamP2PSession) => void
  onStreamP2PAnswer?: (event: StreamP2PSession) => void
  onStreamP2PICECandidate?: (event: StreamP2PICECandidate) => void
  onStreamP2PRestart?: (viewer: StreamViewer) => void
  onError?: (error: RealtimeServerError) => void
  onStateChange: (state: ConnectionState) => void
  onUnauthorized: () => void
  onReady?: () => void
  onSubscribed?: () => void
}

export interface RealtimeServerError {
  request_id?: string
  code: string
  message: string
}

function websocketUrl(baseUrl: string): string {
  if (!baseUrl) {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${protocol}//${window.location.host}/api/v1/ws`
  }
  const parsed = new URL(baseUrl, window.location.href)
  parsed.protocol = parsed.protocol === 'https:' ? 'wss:' : 'ws:'
  parsed.pathname = `${parsed.pathname.replace(/\/$/, '')}/api/v1/ws`
  return parsed.toString()
}

export class RealtimeClient {
  private socket: WebSocket | null = null
  private reconnectTimer: number | null = null
  private attempts = 0
  private intentionallyClosed = false
  private desiredSubscription: Subscription | null = null
  private activeSubscription: Subscription | null = null
  private pendingSubscription: Subscription | null = null
  private authenticated = false
  private awaitingUnsubscribe = false
  private requestSequence = 0

  constructor(private readonly options: RealtimeOptions) {}

  connect() {
    this.intentionallyClosed = false
    this.open()
  }

  subscribe(serverId: number, channelId: number) {
    this.desiredSubscription = { serverId, channelId }
    this.syncSubscription()
  }

  unsubscribe() {
    this.desiredSubscription = null
    const current = this.activeSubscription ?? this.pendingSubscription
    const sent = this.authenticated && !!current
    if (sent && current) {
      this.send('channel.unsubscribe', { server_id: current.serverId, channel_id: current.channelId })
      this.awaitingUnsubscribe = true
    }
    this.activeSubscription = null
    this.pendingSubscription = null
    if (!sent) this.awaitingUnsubscribe = false
  }

  joinVoice(serverId: number, channelId: number, selfMute: boolean, selfDeaf: boolean) {
    return this.send('voice.join', {
      server_id: serverId,
      channel_id: channelId,
      self_mute: selfMute,
      self_deaf: selfDeaf,
    })
  }

  updateVoiceState(selfMute: boolean, selfDeaf: boolean) {
    return this.send('voice.state_update', { self_mute: selfMute, self_deaf: selfDeaf })
  }

  leaveVoice() {
    return this.send('voice.leave', {})
  }

  answerVoice(sdp: string) {
    return this.send('voice.webrtc_answer', { sdp })
  }

  sendVoiceICECandidate(candidate: VoiceICECandidate) {
    return this.send('voice.ice_candidate', candidate)
  }

  startStream(serverId: number, channelId: number, mode: StreamMode, codec: StreamCodec, hasAudio: boolean) {
    return this.send('stream.start', { server_id: serverId, channel_id: channelId, mode, codec, has_audio: hasAudio })
  }

  watchStream(serverId: number, channelId: number) {
    return this.send('stream.watch', { server_id: serverId, channel_id: channelId })
  }

  stopStream() {
    return this.send('stream.stop', {})
  }

  leaveStream() {
    return this.send('stream.leave', {})
  }

  answerStream(sdp: string) {
    return this.send('stream.webrtc_answer', { sdp })
  }

  sendStreamICECandidate(candidate: StreamICECandidate) {
    return this.send('stream.ice_candidate', candidate)
  }

  sendStreamP2POffer(targetConnectionId: string, sdp: string) {
    return this.send('stream.p2p_offer', { target_connection_id: targetConnectionId, sdp })
  }

  sendStreamP2PAnswer(targetConnectionId: string, sdp: string) {
    return this.send('stream.p2p_answer', { target_connection_id: targetConnectionId, sdp })
  }

  sendStreamP2PICECandidate(targetConnectionId: string, candidate: StreamICECandidate) {
    return this.send('stream.p2p_ice_candidate', { target_connection_id: targetConnectionId, ...candidate })
  }

  requestStreamP2PRestart(targetConnectionId: string) {
    return this.send('stream.p2p_restart', { target_connection_id: targetConnectionId })
  }

  /** Bounded viewer-initiated recovery for server-mode streams. */
  requestStreamRecovery(serverId: number, channelId: number, action: 'keyframe' | 'ice_restart') {
    return this.send('stream.recovery_request', { server_id: serverId, channel_id: channelId, action })
  }

  close() {
    clientDiagnostics.record('websocket', 'client_close', 'info', {
      ready_state: this.socket?.readyState ?? null,
    })
    this.intentionallyClosed = true
    if (this.reconnectTimer !== null) window.clearTimeout(this.reconnectTimer)
    this.socket?.close(1000, 'client closed')
    this.socket = null
    this.authenticated = false
    this.activeSubscription = null
    this.pendingSubscription = null
    this.awaitingUnsubscribe = false
  }

  private open() {
    if (this.socket && this.socket.readyState < WebSocket.CLOSING) return
    clientDiagnostics.record('websocket', 'connecting', 'info', {
      attempt: this.attempts + 1,
    })
    this.options.onStateChange('connecting')
    const socket = new WebSocket(websocketUrl(this.options.baseUrl ?? ''))
    this.socket = socket
    this.authenticated = false
    this.activeSubscription = null
    this.pendingSubscription = null

    socket.addEventListener('open', () => {
      clientDiagnostics.record('websocket', 'opened', 'info')
      this.send('auth', { token: this.options.token })
    })

    socket.addEventListener('message', (event) => {
      try {
        const payload = JSON.parse(String(event.data)) as RealtimeEvent
        clientDiagnostics.record('websocket', 'event_received', 'debug', {
          event_type: payload.type,
          request_id: payload.request_id ?? null,
          payload_bytes: typeof event.data === 'string' ? event.data.length : null,
        })
        if (payload.type === 'ready') {
          this.attempts = 0
          this.authenticated = true
          this.options.onStateChange('online')
          this.syncSubscription()
          this.options.onReady?.()
        } else if (payload.type === 'channel.subscribed' && payload.data) {
          const data = payload.data as { server_id: number; channel_id: number }
          this.activeSubscription = { serverId: data.server_id, channelId: data.channel_id }
          this.pendingSubscription = null
          this.syncSubscription()
          this.options.onSubscribed?.()
        } else if (payload.type === 'channel.unsubscribed') {
          this.activeSubscription = null
          this.pendingSubscription = null
          this.awaitingUnsubscribe = false
          this.syncSubscription()
        } else if (payload.type === 'message.created' && payload.data) {
          this.options.onMessage(payload.data as Message)
        } else if (payload.type === 'message.updated' && payload.data) {
          this.options.onMessageUpdated?.(payload.data as Message)
        } else if (payload.type === 'message.deleted' && payload.data) {
          this.options.onMessageDeleted?.(payload.data as MessageDeletedEvent)
        } else if (payload.type === 'message.pinned' && payload.data) {
          this.options.onMessagePinned?.(payload.data as MessagePinnedEvent)
        } else if (payload.type === 'message.unpinned' && payload.data) {
          this.options.onMessageUnpinned?.(payload.data as MessageDeletedEvent)
        } else if (payload.type === 'presence.snapshot' && payload.data) {
          this.options.onPresenceSnapshot?.(payload.data as PresenceSnapshot)
        } else if (payload.type === 'presence.updated' && payload.data) {
          this.options.onPresenceUpdated?.(payload.data as PresenceUpdate)
        } else if (payload.type === 'server.member_joined' && payload.data) {
          this.options.onServerMemberJoined?.(payload.data as ServerMemberChangedEvent)
        } else if (payload.type === 'server.member_role_updated' && payload.data) {
          this.options.onServerMemberRoleUpdated?.(payload.data as ServerMemberChangedEvent)
        } else if (payload.type === 'server.member_removed' && payload.data) {
          this.options.onServerMemberRemoved?.(payload.data as ServerMemberRemovedEvent)
        } else if (payload.type === 'server.deleted' && payload.data) {
          this.options.onServerDeleted?.(payload.data as ServerDeletedEvent)
        } else if (payload.type === 'invitation.received' && payload.data) {
          this.options.onInvitationReceived?.(payload.data as InvitationReceivedEvent)
        } else if (payload.type === 'channel.created' && payload.data) {
          this.options.onChannelCreated?.(payload.data as Channel)
        } else if (payload.type === 'channel.updated' && payload.data) {
          this.options.onChannelUpdated?.(payload.data as Channel)
        } else if (payload.type === 'channel.deleted' && payload.data) {
          this.options.onChannelDeleted?.(payload.data as ChannelDeletedEvent)
        } else if (payload.type === 'read.snapshot' && payload.data) {
          this.options.onReadSnapshot?.(payload.data as ReadSnapshot)
        } else if (payload.type === 'channel.read_snapshot' && payload.data) {
          this.options.onChannelReadSnapshot?.(payload.data as ChannelReadSnapshot)
        } else if (payload.type === 'channel.read' && payload.data) {
          this.options.onChannelRead?.(payload.data as ChannelRead)
        } else if (payload.type === 'voice.joined' && payload.data) {
          this.options.onVoiceJoined?.(payload.data as VoiceJoined)
        } else if (payload.type === 'voice.left' && payload.data) {
          this.options.onVoiceLeft?.(payload.data as VoiceLeft)
        } else if (payload.type === 'voice.participant_joined' && payload.data) {
          this.options.onVoiceParticipantJoined?.(payload.data as VoiceParticipant)
        } else if (payload.type === 'voice.participant_left' && payload.data) {
          this.options.onVoiceParticipantLeft?.(payload.data as VoiceLeft)
        } else if (payload.type === 'voice.state_updated' && payload.data) {
          this.options.onVoiceStateUpdated?.(payload.data as VoiceParticipant)
        } else if (payload.type === 'voice.snapshot' && payload.data) {
          this.options.onVoiceSnapshot?.(payload.data as VoiceSnapshot)
        } else if (payload.type === 'voice.webrtc_offer' && payload.data) {
          this.options.onVoiceWebRTCOffer?.(payload.data as VoiceWebRTCOffer)
        } else if (payload.type === 'voice.ice_candidate' && payload.data) {
          this.options.onVoiceICECandidate?.(payload.data as VoiceICECandidate)
        } else if (payload.type === 'voice.webrtc_closed' && payload.data) {
          this.options.onVoiceWebRTCClosed?.(payload.data as VoiceWebRTCClosed)
        } else if (payload.type === 'stream.started' && payload.data) {
          this.options.onStreamStarted?.(payload.data as ActiveStream)
        } else if (payload.type === 'stream.updated' && payload.data) {
          this.options.onStreamUpdated?.(payload.data as ActiveStream)
        } else if (payload.type === 'stream.stopped' && payload.data) {
          this.options.onStreamStopped?.(payload.data as StreamStopped)
        } else if (payload.type === 'stream.watching' && payload.data) {
          this.options.onStreamWatching?.(payload.data as StreamWatching)
        } else if (payload.type === 'stream.left' && payload.data) {
          this.options.onStreamLeft?.(payload.data as StreamStopped)
        } else if (payload.type === 'stream.snapshot' && payload.data) {
          this.options.onStreamSnapshot?.(payload.data as StreamSnapshot)
        } else if (payload.type === 'stream.viewer_joined' && payload.data) {
          this.options.onStreamViewerJoined?.(payload.data as StreamViewer)
        } else if (payload.type === 'stream.viewer_left' && payload.data) {
          this.options.onStreamViewerLeft?.(payload.data as StreamViewer)
        } else if (payload.type === 'stream.webrtc_offer' && payload.data) {
          this.options.onStreamWebRTCOffer?.(payload.data as StreamWebRTCOffer)
        } else if (payload.type === 'stream.ice_candidate' && payload.data) {
          this.options.onStreamICECandidate?.(payload.data as StreamICECandidate)
        } else if (payload.type === 'stream.webrtc_closed' && payload.data) {
          this.options.onStreamWebRTCClosed?.(payload.data as StreamWebRTCClosed)
        } else if (payload.type === 'stream.p2p_offer' && payload.data) {
          this.options.onStreamP2POffer?.(payload.data as StreamP2PSession)
        } else if (payload.type === 'stream.p2p_answer' && payload.data) {
          this.options.onStreamP2PAnswer?.(payload.data as StreamP2PSession)
        } else if (payload.type === 'stream.p2p_ice_candidate' && payload.data) {
          this.options.onStreamP2PICECandidate?.(payload.data as StreamP2PICECandidate)
        } else if (payload.type === 'stream.p2p_restart' && payload.data) {
          this.options.onStreamP2PRestart?.(payload.data as StreamViewer)
        } else if (payload.type === 'error') {
          const data = payload.data as { code?: string; message?: string } | undefined
          if (data?.code === 'unauthorized') this.options.onUnauthorized()
          this.options.onError?.({
            request_id: payload.request_id,
            code: data?.code ?? 'unknown_error',
            message: data?.message ?? 'Realtime server error',
          })
        }
      } catch (error) {
        clientDiagnostics.record('websocket', 'invalid_event', 'error', {
          error_name: error instanceof Error ? error.name : typeof error,
          payload_bytes: typeof event.data === 'string' ? event.data.length : null,
        })
        // A malformed server event is ignored; the connection remains usable.
      }
    })

    socket.addEventListener('close', (event) => {
      clientDiagnostics.record('websocket', 'closed', event.wasClean ? 'info' : 'warn', {
        code: event.code,
        was_clean: event.wasClean,
        intentionally_closed: this.intentionallyClosed,
      })
      this.socket = null
      this.authenticated = false
      this.activeSubscription = null
      this.pendingSubscription = null
      this.awaitingUnsubscribe = false
      this.options.onStateChange('offline')
      if (event.code === 1008) this.options.onUnauthorized()
      if (!this.intentionallyClosed && event.code !== 1008) this.scheduleReconnect()
    })

    socket.addEventListener('error', () => {
      clientDiagnostics.record('websocket', 'socket_error', 'error', {
        ready_state: socket.readyState,
      })
      socket.close()
    })
  }

  private send(type: string, data: unknown): string | null {
    if (this.socket?.readyState !== WebSocket.OPEN) {
      clientDiagnostics.record('websocket', 'event_not_sent', 'warn', {
        event_type: type,
        ready_state: this.socket?.readyState ?? null,
      })
      return null
    }
    this.requestSequence += 1
    const requestId = String(this.requestSequence)
    this.socket.send(JSON.stringify({ request_id: requestId, type, data }))
    clientDiagnostics.record('websocket', 'event_sent', 'debug', {
      event_type: type,
      request_id: requestId,
    })
    return requestId
  }

  private syncSubscription() {
    if (!this.authenticated || this.socket?.readyState !== WebSocket.OPEN) return
    if (this.awaitingUnsubscribe) return
    const desired = this.desiredSubscription
    const current = this.activeSubscription ?? this.pendingSubscription
    if (desired && current && desired.serverId === current.serverId && desired.channelId === current.channelId) return
    if (current) {
      this.send('channel.unsubscribe', { server_id: current.serverId, channel_id: current.channelId })
      this.activeSubscription = null
      this.pendingSubscription = null
      this.awaitingUnsubscribe = true
      return
    }
    if (desired) {
      this.send('channel.subscribe', { server_id: desired.serverId, channel_id: desired.channelId })
      this.pendingSubscription = desired
    }
  }

  private scheduleReconnect() {
    const delay = Math.min(1_000 * 2 ** this.attempts, 30_000) + Math.random() * 500
    this.attempts += 1
    clientDiagnostics.record('websocket', 'reconnect_scheduled', 'warn', {
      attempt: this.attempts,
      delay_ms: Math.round(delay),
    })
    this.reconnectTimer = window.setTimeout(() => this.open(), delay)
  }
}

export type { ConnectionState }
