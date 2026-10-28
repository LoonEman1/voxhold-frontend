import { useCallback, useEffect, useRef, useState } from 'react'
import type { VoxholdApi } from '../services/api'
import type { ThreadState } from '../domain/community'
import { communityChanged } from './Community'

export function useThreadFollow(api: VoxholdApi, token: string, channelId: number, rootId: number) {
  const [state, setState] = useState<ThreadState | null>(null), [error, setError] = useState(''), [pending, setPending] = useState(false)
  const following = useRef(false), lastRead = useRef(0), acknowledged = useRef(0), timer = useRef<ReturnType<typeof setTimeout> | null>(null), active = useRef(true)
  const path = `/channels/${channelId}/threads/${rootId}`
  useEffect(() => {
    active.current = true; const c = new AbortController()
    void api.community?.request<ThreadState>(token, path, 'GET', undefined, c.signal).then((value) => { if (!c.signal.aborted) { setState(value); following.current = value.following; acknowledged.current = value.last_read_id } }).catch((caught) => { if (!c.signal.aborted) setError(caught instanceof Error ? caught.message : 'Не удалось загрузить подписку') })
    return () => { active.current = false; c.abort(); if (timer.current) clearTimeout(timer.current) }
  }, [api, token, path])
  const markRead = useCallback((id: number) => {
    lastRead.current = Math.max(id, lastRead.current)
    if (!state || id <= acknowledged.current || !active.current) return
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      const read = lastRead.current
      void api.community.request(token, path, 'PUT', { last_read_id: read }).then(() => { if (active.current) { acknowledged.current = Math.max(acknowledged.current, read); setState((v) => v && ({ ...v, unread_count: 0 })); communityChanged() } }).catch(() => undefined)
    }, 250)
  }, [api, token, path, state])
  useEffect(() => { if (state && lastRead.current > acknowledged.current) markRead(lastRead.current) }, [state, markRead])
  const toggle = async () => {
    if (!state || pending) return
    setPending(true); setError('')
    try { await api.community.request(token, path, 'PUT', { following: !following.current, last_read_id: acknowledged.current }); following.current = !following.current; setState((v) => v && ({ ...v, following: following.current })); communityChanged() } catch (caught) { setError(caught instanceof Error ? caught.message : 'Не удалось изменить подписку') } finally { setPending(false) }
  }
  return { markRead, control: <div className="thread-follow"><button type="button" disabled={!state || pending} aria-pressed={state?.following ?? false} onClick={() => void toggle()}>{state?.following ? 'Вы подписаны' : 'Подписаться на ответы'}</button>{!!state?.unread_count && <small>Непрочитано: {state.unread_count}</small>}{error && <small role="alert">{error}</small>}</div> }
}
