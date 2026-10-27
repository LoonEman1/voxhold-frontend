// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { ServerMember } from '../domain/types'
import type { VoxholdApi } from '../services/api'
import { useServerMembers } from './useServerMembers'
const member = (id:number, role='member') => ({ user_id:id, username:`User${id}`, role, last_seen_at:1 }) as ServerMember
function deferred() { let resolve!: (v:ServerMember[])=>void; const promise=new Promise<ServerMember[]>((r)=>{resolve=r}); return {promise,resolve} }
afterEach(cleanup)
it.each(['join','remove','role'])('retries a snapshot crossing a live %s',async(kind)=>{
  const first=deferred(), next=deferred()
  const members=vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(next.promise)
  const api={servers:{members}} as unknown as VoxholdApi
  const onError=vi.fn()
  const {result}=renderHook(()=>useServerMembers(api,'token',1,onError))
  act(()=>result.current.setMembers(kind==='join' ? [member(2)] : kind==='role' ? [member(1,'admin')] : []))
  await act(async()=>first.resolve([member(1)]))
  expect(members).toHaveBeenCalledTimes(2)
  expect(result.current.members.some((v)=>v.user_id===2)).toBe(kind==='join')
  const final=kind==='join' ? [member(1),member(2)] : kind==='role' ? [member(1,'admin')] : []
  await act(async()=>next.resolve(final))
  expect(result.current.members).toEqual(final)
})
it('reconnect replaces missing members and roles, preserving newer last-seen',async()=>{
  const members=vi.fn().mockResolvedValueOnce([member(1),member(2)]).mockResolvedValueOnce([member(2,'admin'),member(3)])
  const api={servers:{members}} as unknown as VoxholdApi
  const onError=vi.fn()
  const {result}=renderHook(()=>useServerMembers(api,'token',1,onError))
  await waitFor(()=>expect(result.current.members).toHaveLength(2))
  act(()=>result.current.setMembers((current)=>current.map((v)=>({...v,last_seen_at:10}))))
  await act(()=>result.current.refreshMembers())
  expect(result.current.members.map((v)=>v.user_id)).toEqual([2,3])
  expect(result.current.members[0]).toMatchObject({role:'admin',last_seen_at:10})
})
it('hides old server data immediately and ignores its late response',async()=>{
  const old=deferred()
  const members=vi.fn().mockReturnValueOnce(old.promise).mockResolvedValue([member(3)])
  const api={servers:{members}} as unknown as VoxholdApi
  const onError=vi.fn()
  const {result,rerender}=renderHook(({id})=>useServerMembers(api,'token',id,onError),{initialProps:{id:1}})
  rerender({id:2})
  expect(result.current.members).toEqual([])
  await waitFor(()=>expect(result.current.members).toHaveLength(1))
  await act(async()=>old.resolve([member(1)]))
  expect(result.current.members.map((v)=>v.user_id)).toEqual([3])
  expect(members.mock.calls[0]![2].aborted).toBe(true)
})
