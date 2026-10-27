import type { ServerMember } from '../domain/types'

// Membership/role comes from the authoritative update; transient metadata may
// be absent from older event payloads and must not erase a known avatar/last-seen.
export function mergeServerMember(previous: ServerMember | undefined, next: ServerMember): ServerMember {
  return { ...next, last_seen_at: Math.max(previous?.last_seen_at ?? 0, next.last_seen_at ?? 0) || null, avatar_version: next.avatar_version === undefined ? previous?.avatar_version : next.avatar_version }
}
