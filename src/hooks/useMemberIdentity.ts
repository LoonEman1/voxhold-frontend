import { useMemo, useRef } from 'react'
import type { ServerMember } from '../domain/types'

/** Chat labels depend on identity, not presence, profile text or avatar versions. */
export function useMemberIdentity(members: ServerMember[]) {
  const snapshot = useRef<ServerMember[]>([])
  return useMemo(() => {
    const previous = snapshot.current
    if (previous.length === members.length && members.every((member, index) => {
      const old = previous[index]!
      return old.user_id === member.user_id && old.username === member.username && old.role === member.role
    })) return previous
    snapshot.current = members
    return members
  }, [members])
}
