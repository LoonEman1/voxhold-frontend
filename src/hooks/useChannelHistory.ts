import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react'
import type { VoxholdApi } from '../services/api'
import { ChannelHistoryStore, EMPTY_HISTORY } from '../services/channelHistory'

export function useChannelHistory(api: VoxholdApi, token: string | null, serverId: number | null, channelId: number | null, userId: number) {
  const store = useMemo(() => new ChannelHistoryStore(api, token ?? '', userId), [api, token, userId])
  useEffect(() => store.retain(), [store])
  if (serverId && channelId) store.entry(serverId, channelId)
  const subscribe = useCallback((listener: () => void) => serverId && channelId ? store.subscribe(serverId, channelId, listener) : () => {}, [store, serverId, channelId])
  const getSnapshot = useCallback(() => store.snapshot(channelId), [store, channelId])
  const state = useSyncExternalStore(subscribe, getSnapshot, () => EMPTY_HISTORY)
  return { store, ...state }
}
