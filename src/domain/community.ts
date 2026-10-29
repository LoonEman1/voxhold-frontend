export interface Attachment { id: string; filename: string; mime_type: string; size_bytes: number; deleted: boolean }
export interface CustomRole { id: number; name: string; color: string; permissions: number; user_ids: number[] }
export interface InboxItem { message_id: number; channel_id: number; server_id: number; thread_root_id?: number; server_name: string; channel_name: string; author: string; content: string; created_at: number; reason: 'mention' | 'reply' | 'thread' }
export interface Person { user_id: number; username: string }
export interface Conversation { saved?: boolean; muted?: boolean; id: number; name: string; direct: boolean; members: Person[]; unread_count: number }
export interface DirectMessage { poll?: Poll; forward?: import('./types').MessageForward; note?: string; revision?: number; reactions?: import('./types').MessageReaction[]; reactions_revision?: number; attachments?: Attachment[]; id: number; conversation_id: number; author: Person; content: string; client_message_id: string; created_at: number }
export interface Privacy { mode: 'shared' | 'everyone' | 'none'; blocked_user_ids: number[] }
export interface StorageState { available_bytes: number; capacity_bytes: number; reserve_percent: number; categories: Record<'images' | 'files' | 'recordings', { quota_bytes: number; used_bytes: number }> }
export interface CleanupPlan { category: string; before: number; bytes: number; count: number; token: string }
export interface ThreadState { following: boolean; last_read_id: number; unread_count: number }

export interface FeatureSource { kind: 'channel' | 'conversation'; id: number }
export interface FeatureDestination { kind: 'channel' | 'conversation'; id: number; name?: string; server_id?: number }
export interface PollInput { question: string; options: string[]; multiple: boolean; anonymous: boolean; closes_at: number }
export interface Poll { id: number; question: string; multiple: boolean; anonymous: boolean; closes_at: number; revision: number; options: { id: number; label: string; count: number; me: boolean; voters?: Person[] }[] }
export interface ScheduledMessage { id: number; destination: FeatureDestination; payload: { content: string; attachment_ids?: string[]; poll?: PollInput }; send_at: number; status: 'pending' | 'sent' | 'failed' | 'cancelled'; error: string }
export interface ServerEvent { id: number; server_id: number; creator_user_id: number; title: string; description: string; starts_at: number; timezone: string; cancelled: boolean; revision: number; going: number; maybe: number; response: '' | 'going' | 'maybe' }
export interface AuditEntry { id: number; actor_user_id: number | null; actor_name: string; action: string; target_type: string; target_id: number; target_name: string; details: Record<string, unknown> | null; created_at: number }
export interface CallMember extends Person { session_id: string }
export interface CallState { revision: number; conversation_id: number; members: CallMember[] }
export interface CallSignal { conversation_id: number; from_user_id: number; session_id: string; target_session_id: string; description?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit; media?: {screen:boolean;revision:number} }
