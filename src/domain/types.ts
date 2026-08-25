export type EntityId = number

export interface User {
  id: EntityId
  username: string
  created_at: number
}

export interface Session {
  token: string
  expires_at: number
}

export interface AuthPayload {
  user: User
  session: Session
}

export interface InstanceMetadata {
  instance_id: string
  name: string
  initialized: boolean
  registration: 'invite_only'
  protocol_version: number
  created_at: number
}

export interface CorsOriginsPayload {
  origins: string[]
}

export type ServerRole = 'owner' | 'admin' | 'member'

export interface Server {
  id: EntityId
  name: string
  created_by: EntityId
  created_at: number
  role: ServerRole
  joined_at: number
}

export type ChannelKind = 'text' | 'voice'

export interface Channel {
  id: EntityId
  server_id: EntityId
  name: string
  kind: ChannelKind
  position: number
  created_by: EntityId
  created_at: number
  last_message_id?: EntityId
}

export interface MessageAuthor {
  user_id: EntityId
  username: string
}

export interface Message {
  id: EntityId
  channel_id: EntityId
  author: MessageAuthor
  content: string
  created_at: number
  edited_at: number | null
}

export interface MessagePage {
  messages: Message[]
  pagination: {
    next_before_id: number | null
    has_more: boolean
  }
}

export interface PinnedMessage {
  message: Message
  pinned_by: MessageAuthor
  pinned_at: number
}

export interface SearchMessage extends Message {
  channel_name: string
}

export interface SearchMessagePage {
  messages: SearchMessage[]
  pagination: {
    next_before_id: number | null
    has_more: boolean
  }
}

export interface MessageContext {
  messages: Message[]
  target_message_id: EntityId
  target_index: number
}

export interface MessageDeletedEvent {
  channel_id: EntityId
  message_id: EntityId
}

export interface MessagePinnedEvent extends MessageDeletedEvent {
  message: Message
  pinned_by: MessageAuthor
  pinned_at: number
}

export interface PresenceSnapshot {
  servers: Array<{
    server_id: EntityId
    online_user_ids: EntityId[]
  }>
}

export interface PresenceUpdate {
  server_id: EntityId
  user_id: EntityId
  status: 'online' | 'offline'
}

export interface Profile {
  user_id: EntityId
  username: string
  about: string
  country_code: string | null
  created_at: number
  last_seen_at: number | null
  updated_at: number | null
}

export interface ServerMember {
  user_id: EntityId
  username: string
  created_at: number
  role: ServerRole
  joined_at: number
  about: string
  country_code: string | null
  last_seen_at: number | null
}

export interface ServerMemberChangedEvent {
  server_id: EntityId
  member: ServerMember
}

export interface ServerMemberRemovedEvent {
  server_id: EntityId
  user_id: EntityId
}

export interface ChannelDeletedEvent {
  server_id: EntityId
  channel_id: EntityId
}

export interface ServerDeletedEvent {
  server_id: EntityId
}

export interface ChannelRead {
  server_id: EntityId
  channel_id: EntityId
  user_id: EntityId
  last_read_message_id: EntityId
  updated_at: number
}

export interface ReadSnapshot {
  reads: ChannelRead[]
}

export interface ChannelReadSnapshot {
  server_id: EntityId
  channel_id: EntityId
  reads: ChannelRead[]
}

export interface VoiceParticipant {
  connection_id: string
  user_id: EntityId
  server_id: EntityId
  channel_id: EntityId
  self_mute: boolean
  self_deaf: boolean
}

export interface VoiceJoined {
  participant: VoiceParticipant
  participants: VoiceParticipant[]
}

export interface VoiceLeft {
  connection_id: string
  user_id: EntityId
  server_id: EntityId
  channel_id: EntityId
}

export interface VoiceSnapshot {
  participants: VoiceParticipant[]
}

export interface VoiceICECandidate {
  candidate: string
  sdp_mid?: string | null
  sdp_mline_index?: number | null
  username_fragment?: string | null
}

export interface VoiceWebRTCOffer {
  sdp: string
}

export interface VoiceWebRTCClosed {
  reason: string
}

export type StreamMode = 'server' | 'p2p'
export type StreamCodec = 'vp8' | 'vp9' | 'h264' | 'av1'

export interface ActiveStream {
  server_id: EntityId
  channel_id: EntityId
  publisher_user_id: EntityId
  publisher_connection_id: string
  mode: StreamMode
  codec: StreamCodec
  has_audio: boolean
  viewer_count: number
}

export interface StreamSnapshot {
  streams: ActiveStream[]
}

export interface StreamWatching {
  stream: ActiveStream
  viewer_connection_id: string
}

export interface StreamStopped {
  server_id: EntityId
  channel_id: EntityId
  reason?: string
}

export interface StreamViewer {
  connection_id: string
  user_id: EntityId
}

export type StreamICECandidate = VoiceICECandidate
export type StreamWebRTCOffer = VoiceWebRTCOffer
export type StreamWebRTCClosed = VoiceWebRTCClosed

export interface StreamP2PSession {
  target_connection_id?: string
  from_connection_id: string
  sdp: string
}

export interface StreamP2PICECandidate extends StreamICECandidate {
  target_connection_id?: string
  from_connection_id: string
}

export type InviteStatus = 'pending' | 'accepted' | 'declined' | 'canceled' | 'expired'

export interface IncomingInvite {
  id: EntityId
  server_id: EntityId
  server_name: string
  inviter_user_id: EntityId
  inviter_username: string
  status: InviteStatus
  expires_at: number
  created_at: number
}

export interface InvitationReceivedEvent extends IncomingInvite {
  invitee_user_id: EntityId
}

export interface CreatedInvite {
  id: EntityId
  server_id: EntityId
  inviter_user_id: EntityId
  invitee_user_id: EntityId
  status: InviteStatus
  expires_at: number
  responded_at: number | null
  created_at: number
}

export interface InviteLinkPreview {
  server_id: EntityId
  server_name: string
  creator_username: string
  expires_at: number
  max_uses: number | null
  use_count: number
  allow_registration: boolean
}

export interface CreatedInviteLink extends InviteLinkPreview {
  id: EntityId
  token: string
  created_at: number
}

export interface ApiErrorPayload {
  error?: string
}

export interface WebRTCIceServerDTO {
  urls: string[]
  username?: string
  credential?: string
}

export interface WebRTCConfigPayload {
  ice_servers: WebRTCIceServerDTO[]
  ice_transport_policy: string
}

export interface StoredClientDiagnosticEvent {
  id: number
  created_at: number
  client_timestamp_ms: number
  user_id: number
  username: string
  session_id: string
  client_version: string
  platform: string
  category: string
  name: string
  level: 'debug' | 'info' | 'warn' | 'error'
  details: Record<string, unknown>
}

export interface ClientDiagnosticsPayload {
  retention_seconds: number
  events: StoredClientDiagnosticEvent[]
}
