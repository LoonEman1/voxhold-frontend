export interface Attachment { id: string; filename: string; mime_type: string; size_bytes: number; deleted: boolean }
export interface CustomRole { id: number; name: string; color: string; permissions: number; user_ids: number[] }
export interface InboxItem { message_id: number; channel_id: number; server_id: number; thread_root_id?: number; server_name: string; channel_name: string; author: string; content: string; created_at: number; reason: 'mention' | 'reply' | 'thread' }
export interface Person { user_id: number; username: string }
export interface Conversation { id: number; name: string; direct: boolean; members: Person[]; unread_count: number }
export interface DirectMessage { attachments?: Attachment[]; id: number; conversation_id: number; author: Person; content: string; client_message_id: string; created_at: number }
export interface Privacy { mode: 'shared' | 'everyone' | 'none'; blocked_user_ids: number[] }
export interface StorageState { available_bytes: number; capacity_bytes: number; reserve_percent: number; categories: Record<'images' | 'files' | 'recordings', { quota_bytes: number; used_bytes: number }> }
export interface CleanupPlan { category: string; before: number; bytes: number; count: number; token: string }
export interface ThreadState { following: boolean; last_read_id: number; unread_count: number }
