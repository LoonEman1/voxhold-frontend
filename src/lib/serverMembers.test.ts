import { expect, it } from 'vitest'
import type { ServerMember } from '../domain/types'
import { mergeServerMember } from './serverMembers'
it('keeps newer metadata while applying an authoritative role, including avatar removal',()=>{
  const old={user_id:1,username:'Alice',role:'member',last_seen_at:10,avatar_version:'v2'} as ServerMember
  const next={user_id:1,username:'Alice',role:'admin',last_seen_at:1} as ServerMember
  expect(mergeServerMember(old,next)).toMatchObject({role:'admin',last_seen_at:10,avatar_version:'v2'})
  expect(mergeServerMember(old,{...next,avatar_version:null}).avatar_version).toBeNull()
})
