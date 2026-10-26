import { createContext, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { VoxholdApi } from '../services/api'

type Entry = { url: string | null; loaded: number; listeners: Set<() => void>; request?: AbortController }
class AvatarCache {
  private entries = new Map<number, Entry>()
  constructor(private api: VoxholdApi, private token: string) {}
  private entry(id: number) {
    let entry = this.entries.get(id)
    if (!entry) { entry = { url: null, loaded: 0, listeners: new Set() }; this.entries.set(id, entry) }
    return entry
  }
  get(id: number) { return this.entries.get(id)?.url ?? null }
  subscribe(id: number, callback: () => void) {
    const entry = this.entry(id)
    entry.listeners.add(callback)
    this.load(id)
    return () => { entry.listeners.delete(callback) }
  }
  private load(id: number) {
    const entry = this.entry(id)
    if (entry.request || Date.now() - entry.loaded < 300_000) return
    const controller = new AbortController()
    entry.request = controller
    void this.api.profile.avatar(this.token, id, controller.signal).then((blob) => {
      if (controller.signal.aborted) return
      if (entry.url) URL.revokeObjectURL(entry.url)
      entry.url = URL.createObjectURL(blob)
    }).catch(() => { /* Initials remain for missing/inaccessible images. */ }).finally(() => {
      if (controller.signal.aborted) return
      entry.request = undefined
      entry.loaded = Date.now()
      entry.listeners.forEach((listener) => listener())
      this.trim()
    })
  }
  invalidate(id: number) {
    const entry = this.entries.get(id)
    if (!entry) return
    entry.request?.abort(); entry.request = undefined; entry.loaded = 0
    if (entry.url) URL.revokeObjectURL(entry.url)
    entry.url = null
    entry.listeners.forEach((listener) => listener())
    if (entry.listeners.size) this.load(id)
  }
  private trim() {
    for (const [id, entry] of this.entries) {
      if (this.entries.size <= 128) break
      if (entry.listeners.size || entry.request) continue
      if (entry.url) URL.revokeObjectURL(entry.url)
      this.entries.delete(id)
    }
  }
  close() {
    this.entries.forEach((entry) => { entry.request?.abort(); if (entry.url) URL.revokeObjectURL(entry.url) })
    this.entries.clear()
  }
}
const Context = createContext<AvatarCache | null>(null)
export function avatarChanged(userId: number) { window.dispatchEvent(new CustomEvent('voxhold:avatar', { detail: userId })) }
export function AvatarProvider({ api, token, children }: { api: VoxholdApi; token: string; children: ReactNode }) {
  const cache = useMemo(() => new AvatarCache(api, token), [api, token])
  useEffect(() => {
    const invalidate = (event: Event) => cache.invalidate((event as CustomEvent<number>).detail)
    window.addEventListener('voxhold:avatar', invalidate)
    return () => { window.removeEventListener('voxhold:avatar', invalidate); cache.close() }
  }, [cache])
  return <Context.Provider value={cache}>{children}</Context.Provider>
}

// One shared observer, with requests only for avatars entering the viewport.
const visible = new Map<Element, () => void>()
let observer: IntersectionObserver | undefined
export function useAvatar(userId?: number) {
  const cache = useContext(Context)
  const ref = useRef<HTMLSpanElement>(null)
  const [shown, setShown] = useState(false)
  useEffect(() => {
    const element = ref.current
    if (!element || !userId || !cache) return
    if (!globalThis.IntersectionObserver) { setShown(true); return }
    observer ??= new IntersectionObserver((entries) => entries.forEach((entry) => {
      if (!entry.isIntersecting) return
      visible.get(entry.target)?.(); visible.delete(entry.target); observer?.unobserve(entry.target)
    }), { rootMargin: '100px' })
    visible.set(element, () => setShown(true)); observer.observe(element)
    return () => { visible.delete(element); observer?.unobserve(element) }
  }, [cache, userId])
  const url = useSyncExternalStore(
    useMemo(() => (listener: () => void) => shown && userId && cache ? cache.subscribe(userId, listener) : () => {}, [shown, userId, cache]),
    () => userId && cache ? cache.get(userId) : null,
  )
  return { ref, url }
}
