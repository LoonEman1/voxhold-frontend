import { previewMentions } from '../lib/mentions'
import type { MessageNotification, NotificationSettings } from '../domain/types'

interface Reading { serverId: number | null; channelId: number | null; following: boolean }
interface Dependencies {
  reading: () => Reading
  sound: () => void
  open: (event: MessageNotification) => void
}
const MAX_SEEN = 256
const SOUND_INTERVAL_MS = 3_000

/** Per-login notification delivery with bounded memory and cross-tab claiming. */
export class MessageNotificationCenter {
  private items: MessageNotification[] = []
  private listeners = new Set<() => void>()
  private seen = new Set<number>()
  private allowed = new Map<number, ReadonlySet<number>>()
  private deniedChannels = new Set<number>()
  private deniedServers = new Set<number>()
  private modes = new Map<number, NotificationSettings['mode']>()
  private timers = new Map<number, ReturnType<typeof setTimeout>>()
  private desktop = new Map<number, Notification>()
  private generation = 0
  private started = false
  private lastSound = -Infinity
  private tabId = crypto.randomUUID()
  private publishedReading: string | null = null
  private publishedReadingAt = -Infinity
  private readingKey: string
  private seenKey: string

  constructor(private scope: string, private userId: number, private dependencies: Dependencies) {
    this.readingKey = `voxhold.notifications.reading:${scope}`
    this.seenKey = `voxhold.notifications.seen:${scope}`
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  snapshot = () => this.items
  private emit() { this.listeners.forEach((listener) => listener()) }
  start() {
    this.started = true; this.generation++
    const refresh = () => this.contextChanged()
    window.addEventListener('focus', refresh); window.addEventListener('blur', refresh); document.addEventListener('visibilitychange', refresh)
    const heartbeat = setInterval(refresh, 2_000)
    refresh()
    return () => {
      this.started = false; this.generation++; clearInterval(heartbeat)
      window.removeEventListener('focus', refresh); window.removeEventListener('blur', refresh); document.removeEventListener('visibilitychange', refresh)
      this.releaseReading(); this.timers.forEach(clearTimeout); this.timers.clear(); this.desktop.forEach((item) => item.close()); this.desktop.clear()
      this.items = []; this.emit()
    }
  }
  contextChanged() {
    const reading = this.dependencies.reading()
    if (!this.started || document.visibilityState !== 'visible' || !document.hasFocus() || !reading.channelId || !reading.following) { this.releaseReading(); return }
    const signature = `${reading.serverId}:${reading.channelId}`, now = Date.now()
    if (signature === this.publishedReading && now >= this.publishedReadingAt && now - this.publishedReadingAt < 1_000) return
    try {
      localStorage.setItem(this.readingKey, JSON.stringify({ ...reading, tabId: this.tabId, at: now }))
      this.publishedReading = signature; this.publishedReadingAt = now
    } catch { /* Private browsing can disable storage. */ }
  }
  private releaseReading() {
    if (this.publishedReading === null) return
    this.publishedReading = null; this.publishedReadingAt = -Infinity
    try { if (JSON.parse(localStorage.getItem(this.readingKey) ?? 'null')?.tabId === this.tabId) localStorage.removeItem(this.readingKey) } catch { /* Optional cross-tab state. */ }
  }
  private isReading(event: MessageNotification) {
    const reading = this.dependencies.reading()
    if (document.visibilityState === 'visible' && document.hasFocus() && reading.following && reading.serverId === event.server_id && reading.channelId === event.channel_id) return true
    try {
      const other = JSON.parse(localStorage.getItem(this.readingKey) ?? 'null') as { tabId: string; at: number; serverId: number; channelId: number } | null
      return !!other && other.tabId !== this.tabId && Date.now() >= other.at && Date.now() - other.at < 5_000 && other.serverId === event.server_id && other.channelId === event.channel_id
    } catch { return false }
  }
  setSettings(value: NotificationSettings) { this.modes.set(value.channel_id, value.mode); if (value.mode !== 'all') this.removeWhere((event) => event.channel_id === value.channel_id && (value.mode === 'none' || !event.mentioned)) }
  retainChannels(serverId: number, allowed: ReadonlySet<number>) { this.allowed.set(serverId, allowed); this.deniedServers.delete(serverId); allowed.forEach((id) => this.deniedChannels.delete(id)); this.removeWhere((event) => event.server_id === serverId && !allowed.has(event.channel_id)) }
  removeChannel(channelId: number) { this.deniedChannels.add(channelId); this.removeWhere((event) => event.channel_id === channelId) }
  removeServer(serverId: number) { this.deniedServers.add(serverId); this.removeWhere((event) => event.server_id === serverId) }
  private removeWhere(predicate: (event: MessageNotification) => boolean) { this.items.filter(predicate).forEach((event) => this.dismiss(event.message.id)) }
  dismiss(id: number) {
    clearTimeout(this.timers.get(id)); this.timers.delete(id); this.desktop.get(id)?.close(); this.desktop.delete(id)
    const next = this.items.filter((event) => event.message.id !== id)
    if (next.length !== this.items.length) { this.items = next; this.emit() }
  }
  isAvailable(event: MessageNotification) { return this.started && !this.denied(event) }
  open(event: MessageNotification) { const available = this.isAvailable(event); this.dismiss(event.message.id); if (available) this.dependencies.open(event) }
  allowChannel(serverId: number, channelId: number) { this.deniedChannels.delete(channelId); this.deniedServers.delete(serverId); if (this.allowed.has(serverId)) this.allowed.set(serverId, new Set([...this.allowed.get(serverId)!, channelId])) }
  private muted(event: MessageNotification) { const mode = this.modes.get(event.channel_id); return mode === 'none' || mode === 'mentions' && !event.mentioned }
  private denied(event: MessageNotification) { return this.deniedServers.has(event.server_id) || this.deniedChannels.has(event.channel_id) || this.allowed.has(event.server_id) && !this.allowed.get(event.server_id)!.has(event.channel_id) }
  async receive(event: MessageNotification) {
    if (!this.started || this.denied(event) || event.message.author.user_id === this.userId || this.seen.has(event.message.id) || this.muted(event)) return
    this.seen.add(event.message.id); if (this.seen.size > MAX_SEEN) this.seen.delete(this.seen.values().next().value!)
    const generation = this.generation
    const deliver = () => {
      if (!this.started || this.denied(event) || generation !== this.generation || this.muted(event)) return
      try {
        const saved = JSON.parse(localStorage.getItem(this.seenKey) ?? '[]') as unknown
        const ids = Array.isArray(saved) ? saved.filter((id): id is number => Number.isSafeInteger(id)).slice(-MAX_SEEN) : []
        if (ids.includes(event.message.id)) return
        localStorage.setItem(this.seenKey, JSON.stringify([...ids, event.message.id].slice(-MAX_SEEN)))
      } catch { /* In-memory deduplication remains available. */ }
      if (this.isReading(event)) return
      for (const old of this.items.slice(3)) this.dismiss(old.message.id)
      this.items = [event, ...this.items.slice(0, 3)]; this.emit()
      this.timers.set(event.message.id, setTimeout(() => this.dismiss(event.message.id), 10_000))
      if (Date.now() - this.lastSound >= SOUND_INTERVAL_MS) { this.lastSound = Date.now(); this.dependencies.sound() }
      if ((document.visibilityState !== 'visible' || !document.hasFocus()) && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        try {
          const item = new Notification(`#${event.channel_name} · ${event.server_name}`, { body: `${event.message.author.username}: ${previewMentions(event.message.content, this.userId).slice(0, 180)}`, tag: `${this.scope}:${event.message.id}`, silent: true })
          item.onclick = () => { window.focus(); this.open(event) }
          this.desktop.set(event.message.id, item)
        } catch { /* The in-app notification and sound still work. */ }
      }
    }
    if (navigator.locks?.request) {
      try { await navigator.locks.request(`voxhold.notifications:${this.scope}`, deliver) } catch { deliver() }
    } else deliver()
  }
}
