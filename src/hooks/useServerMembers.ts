import { useCallback, useEffect, useRef, useState, type SetStateAction } from 'react'
import type { ServerMember } from '../domain/types'
import { mergeServerMember } from '../lib/serverMembers'
import type { VoxholdApi } from '../services/api'

// One snapshot request per server generation. A live mutation crossing a read
// invalidates that read and causes one fresh snapshot, without polling.
export function useServerMembers(api: VoxholdApi, token: string | null, serverId: number | null, onError: (error: unknown, message: string) => void) {
  const key = `${token ?? ''}:${serverId ?? ''}`
  const context = useRef({ key, token, serverId, revision: 0, controller: new AbortController(), flight: null as Promise<void> | null })
  if (context.current.key !== key) context.current = { key, token, serverId, revision: 0, controller: new AbortController(), flight: null }
  const [state, setState] = useState({ key, members: [] as ServerMember[] })
  const setMembers = useCallback((update: SetStateAction<ServerMember[]>) => {
    const source = context.current
    source.revision += 1
    setState((current) => {
      const members = current.key === source.key ? current.members : []
      return { key: source.key, members: typeof update === 'function' ? update(members) : update }
    })
  }, [])
  const refreshMembers = useCallback((invalidate = true): Promise<void> => {
    const source = context.current
    if (!source.token || !source.serverId) return Promise.resolve()
    if (invalidate) source.revision += 1
    if (source.flight) return source.flight
    const run = async () => {
      while (!source.controller.signal.aborted && context.current === source) {
        const revision = source.revision
        const snapshot = await api.servers.members(source.token!, source.serverId!, source.controller.signal)
        if (source.controller.signal.aborted || context.current !== source) return
        if (source.revision !== revision) continue
        setState((current) => {
          const previous = new Map((current.key === source.key ? current.members : []).map((member) => [member.user_id, member]))
          return { key: source.key, members: snapshot.map((member) => mergeServerMember(previous.get(member.user_id), member)) }
        })
        return
      }
    }
    source.flight = run().catch((error: unknown) => {
      if (!source.controller.signal.aborted && context.current === source) onError(error, 'Не удалось загрузить участников')
    }).finally(() => { source.flight = null })
    return source.flight
  }, [api, onError])
  useEffect(() => {
    // StrictMode replays setup after cleanup using the same render.
    if (context.current.controller.signal.aborted) context.current = { key, token, serverId, revision: 0, controller: new AbortController(), flight: null }
    const source = context.current
    void refreshMembers(false)
    return () => { source.controller.abort() }
  }, [refreshMembers, key, token, serverId])
  return { members: state.key === key ? state.members : [], setMembers, refreshMembers }
}
