import packageMetadata from '../../package.json'

export type DiagnosticLevel = 'debug' | 'info' | 'warn' | 'error'

export interface ClientDiagnosticEvent {
  timestamp_ms: number
  category: string
  name: string
  level: DiagnosticLevel
  details: Record<string, unknown>
}

const EVENTS_STORAGE_KEY = 'voxhold.diagnostics.pending.v1'
const SESSION_STORAGE_KEY = 'voxhold.diagnostics.session.v1'
const MAX_PENDING_EVENTS = 256
const MAX_BATCH_EVENTS = 32
const FLUSH_INTERVAL_MS = 10_000

function storageAvailable() {
  if (typeof window === 'undefined') return false
  try {
    return typeof window.sessionStorage !== 'undefined'
  } catch {
    return false
  }
}

function loadJSON<T>(key: string): T | null {
  if (!storageAvailable()) return null
  try {
    const value = window.sessionStorage.getItem(key)
    return value ? JSON.parse(value) as T : null
  } catch {
    return null
  }
}

function storeJSON(key: string, value: unknown) {
  if (!storageAvailable()) return
  try {
    window.sessionStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Telemetry must never interfere with the application when storage is full.
  }
}

function loadPendingEvents() {
  const stored = loadJSON<unknown>(EVENTS_STORAGE_KEY)
  if (!Array.isArray(stored)) return []
  return stored.filter((event): event is ClientDiagnosticEvent => {
    if (!event || typeof event !== 'object') return false
    const candidate = event as Partial<ClientDiagnosticEvent>
    return typeof candidate.timestamp_ms === 'number'
      && typeof candidate.category === 'string'
      && typeof candidate.name === 'string'
      && ['debug', 'info', 'warn', 'error'].includes(candidate.level ?? '')
      && !!candidate.details
      && typeof candidate.details === 'object'
  }).slice(-MAX_PENDING_EVENTS)
}

function newSessionID() {
  let existing = ''
  if (storageAvailable()) {
    try {
      existing = window.sessionStorage.getItem(SESSION_STORAGE_KEY)?.trim() ?? ''
    } catch {
      existing = ''
    }
  }
  if (existing) return existing
  const generated = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `session-${Date.now()}-${Math.random().toString(16).slice(2)}`
  if (storageAvailable()) {
    try {
      window.sessionStorage.setItem(SESSION_STORAGE_KEY, generated)
    } catch {
      // A session ID may stay in memory when browser storage is unavailable.
    }
  }
  return generated
}

function sensitiveKey(key: string) {
  const normalized = key.toLowerCase()
  if (normalized === 'sdp_bytes') return false
  if (normalized === 'ip' || normalized.endsWith('_ip')) return true
  return [
    'authorization', 'cookie', 'credential', 'password', 'secret', 'token',
    'content', 'message', 'sdp', 'candidate', 'address',
  ].some((fragment) => normalized.includes(fragment))
}

function sanitizeValue(value: unknown, depth = 0): unknown {
  if (depth >= 4) return '[max-depth]'
  if (typeof value === 'string') return value.length > 256 ? `${value.slice(0, 253)}...` : value
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitizeValue(item, depth + 1))
  if (typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value as Record<string, unknown>).slice(0, 32)) {
      result[key] = sensitiveKey(key) ? '[redacted]' : sanitizeValue(child, depth + 1)
    }
    return result
  }
  return String(value)
}

export function sanitizeDiagnosticDetails(details: Record<string, unknown> = {}) {
  return sanitizeValue(details) as Record<string, unknown>
}

export class ClientDiagnostics {
  private readonly sessionID = newSessionID()
  private pending = loadPendingEvents()
  private baseURL = ''
  private token = ''
  private flushing = false
  private timer: number | null = null
  private listenersInstalled = false

  configure(baseURL: string) {
    this.baseURL = baseURL.replace(/\/$/, '')
    if (typeof window === 'undefined' || this.listenersInstalled) return
    this.listenersInstalled = true
    this.timer = window.setInterval(() => { void this.flush() }, FLUSH_INTERVAL_MS)
    window.addEventListener('online', () => { void this.flush() })
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') void this.flush(true)
    })
    window.addEventListener('error', (event) => {
      this.record('client', 'uncaught_error', 'error', {
        error_name: event.error instanceof Error ? event.error.name : 'Error',
        source: event.filename ? event.filename.split('/').pop() : '',
        line: event.lineno,
        column: event.colno,
      })
    })
    window.addEventListener('unhandledrejection', (event) => {
      this.record('client', 'unhandled_rejection', 'error', {
        error_name: event.reason instanceof Error ? event.reason.name : typeof event.reason,
      })
    })
    this.record('client', 'session_started', 'info', {
      online: navigator.onLine,
      language: navigator.language,
    })
  }

  setToken(token: string | null) {
    this.token = token?.trim() ?? ''
    if (this.token) void this.flush()
  }

  record(
    category: string,
    name: string,
    level: DiagnosticLevel = 'info',
    details: Record<string, unknown> = {},
  ) {
    let sanitizedDetails: Record<string, unknown>
    try {
      sanitizedDetails = sanitizeDiagnosticDetails(details)
    } catch {
      sanitizedDetails = { sanitization_failed: true }
    }
    this.pending.push({
      timestamp_ms: Date.now(),
      category,
      name,
      level,
      details: sanitizedDetails,
    })
    if (this.pending.length > MAX_PENDING_EVENTS) {
      this.pending.splice(0, this.pending.length - MAX_PENDING_EVENTS)
    }
    storeJSON(EVENTS_STORAGE_KEY, this.pending)
    if (this.pending.length >= MAX_BATCH_EVENTS) void this.flush()
  }

  async flush(keepalive = false) {
    if (!this.token || this.flushing || this.pending.length === 0 || typeof fetch === 'undefined') return
    this.flushing = true
    const events = this.pending.slice(0, MAX_BATCH_EVENTS)
    try {
      const response = await fetch(`${this.baseURL}/api/v1/diagnostics/client-events`, {
        method: 'POST',
        keepalive,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.token}`,
        },
        body: JSON.stringify({
          session_id: this.sessionID,
          client_version: packageMetadata.version,
          platform: typeof navigator === 'undefined' ? '' : navigator.userAgent,
          events,
        }),
      })
      if (!response.ok) {
        if (response.status === 400 || response.status === 413) {
          this.pending.splice(0, events.length)
          storeJSON(EVENTS_STORAGE_KEY, this.pending)
        }
        return
      }
      this.pending.splice(0, events.length)
      storeJSON(EVENTS_STORAGE_KEY, this.pending)
      if (this.pending.length > 0) queueMicrotask(() => { void this.flush() })
    } catch {
      // Pending events stay in sessionStorage and are retried when online.
    } finally {
      this.flushing = false
    }
  }

  dispose() {
    if (this.timer !== null) window.clearInterval(this.timer)
    this.timer = null
  }
}

export const clientDiagnostics = new ClientDiagnostics()
