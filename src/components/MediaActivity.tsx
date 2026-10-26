import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react'
import type { StreamQualityStats } from '../services/stream'

class Value<T> {
  private listeners = new Set<() => void>()
  constructor(private value: T) {}
  get = () => this.value
  set = (value: T) => { if (Object.is(value, this.value)) return; this.value = value; this.listeners.forEach((listener) => listener()) }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
}
export const createMediaActivity = () => ({ quality: new Value<StreamQualityStats | null>(null), speakers: new Value<readonly number[]>([]) })
type Activity = ReturnType<typeof createMediaActivity>
const Context = createContext<Activity | null>(null)
const noSubscribe = () => () => {}
const noQuality = () => null
const EMPTY_SPEAKERS: readonly number[] = []
const noSpeakers = () => EMPTY_SPEAKERS
export function MediaActivityProvider({ value, children }: { value: Activity; children: ReactNode }) { return <Context.Provider value={value}>{children}</Context.Provider> }
export function useStreamQuality(override?: StreamQualityStats | null) {
  const activity = useContext(Context)
  const quality = useSyncExternalStore(activity?.quality.subscribe ?? noSubscribe, activity?.quality.get ?? noQuality)
  return override === undefined ? quality : override
}
export function useSpeakingUsers(override?: readonly number[]) {
  const activity = useContext(Context)
  const speakers = useSyncExternalStore(activity?.speakers.subscribe ?? noSubscribe, activity?.speakers.get ?? noSpeakers)
  return override ?? speakers
}
