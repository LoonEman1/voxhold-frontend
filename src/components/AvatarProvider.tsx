import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { safeImageBlob } from '../lib/safeBlob'
import type { VoxholdApi } from '../services/api'

type Entry = { url: string | null; version?: string; listeners: Set<() => void>; request?: AbortController }
class AvatarCache {
  private entries = new Map<number, Entry>()
  private versions = new Map<number, string | null>()
  constructor(private api: VoxholdApi, private getToken: () => string) {}
  private entry(id: number) {
    let entry = this.entries.get(id)
    if (!entry) { entry = { url: null, listeners: new Set() }; this.entries.set(id, entry) }
    return entry
  }
  get(id: number) { return this.entries.get(id)?.url ?? null }
  subscribe(id: number, callback: () => void) {
    const entry = this.entry(id)
    entry.listeners.add(callback)
    this.load(id)
    return () => { entry.listeners.delete(callback) }
  }
  /** Members carry the avatar ETag; only changed users are refetched or cleared. */
  setVersions(next: ReadonlyMap<number, string | null>) {
    for (const [id, version] of next) {
      const previous = this.versions.get(id)
      this.versions.set(id, version)
      if (previous === version) continue
      const entry = this.entries.get(id)
      if (!entry) continue
      entry.request?.abort(); entry.request = undefined; entry.version = undefined
      if (version === null) {
        if (entry.url) URL.revokeObjectURL(entry.url)
        entry.url = null
        entry.listeners.forEach((listener) => listener())
      } else if (entry.listeners.size) this.load(id)
    }
  }
  private load(id: number) {
    const entry = this.entry(id), version = this.versions.get(id)
    // Users without an avatar keep their initials and cost no request.
    if (!version || entry.request || entry.version === version) return
    const controller = new AbortController()
    entry.request = controller; entry.version = version
    void this.api.profile.avatar(this.getToken(), id, version, controller.signal).then((blob) => {
      if (controller.signal.aborted) return
      if (entry.url) URL.revokeObjectURL(entry.url)
      entry.url = URL.createObjectURL(safeImageBlob(blob))
    }).catch(() => { /* Initials remain for inaccessible images. */ }).finally(() => {
      if (controller.signal.aborted) return
      entry.request = undefined
      entry.listeners.forEach((listener) => listener())
      this.trim()
    })
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
export function AvatarProvider({ api, token, userId = 0, versions, children }: { api: VoxholdApi; token: string; userId?: number; versions: ReadonlyMap<number, string | null>; children: ReactNode }) {
  const tokenRef = useRef(token)
  useLayoutEffect(() => { tokenRef.current = token }, [token])
  const cache = useMemo(() => new AvatarCache(api, () => tokenRef.current), [api, userId])
  useEffect(() => {
    const changed = (event: Event) => {
      const value = (event as CustomEvent<{ user_id: number; version: string | null }>).detail
      if (value && Number.isSafeInteger(value.user_id) && value.user_id > 0) cache.setVersions(new Map([[value.user_id, value.version]]))
    }
    window.addEventListener('voxhold:avatar-version', changed)
    return () => window.removeEventListener('voxhold:avatar-version', changed)
  }, [cache])
  useEffect(() => () => cache.close(), [cache])
  useEffect(() => { cache.setVersions(versions) }, [cache, versions])
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
