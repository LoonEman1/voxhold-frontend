import { clientDiagnostics } from './clientDiagnostics'
import { waitForRetry } from '../lib/retryBusy'

export interface TransportRequest {
  path: string
  method?: 'HEAD' | 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  token?: string | null
  body?: unknown
  rawBody?: BodyInit
  contentType?: string
  responseType?: 'blob'
  signal?: AbortSignal
  timeoutMs?: number
  onUploadProgress?: (fraction: number) => void
}

export interface TransportResponse<T> {
  status: number
  data: T | null
  retryAfterMs?: number
}

export interface Transport {
  resolveURL?(path: string): string
  request<T>(request: TransportRequest): Promise<TransportResponse<T>>
}

export interface SessionStorageAdapter {
  subscribe?(key: string, listener: () => void): () => void
  withLock?<T>(key: string, action: () => Promise<T>): Promise<T>
  read<T>(key: string): T | null
  write<T>(key: string, value: T): void
  remove(key: string): void
}

export const browserSessionStorage: SessionStorageAdapter = {
  subscribe(key, listener) {
    const changed = (event: StorageEvent) => { if (event.storageArea === localStorage && (event.key === key || event.key === null)) listener() }
    window.addEventListener('storage', changed)
    return () => window.removeEventListener('storage', changed)
  },
  async withLock(key, action) {
    return await (navigator.locks ? navigator.locks.request(key, action) : action())
  },
  read<T>(key: string): T | null {
    try {
      const value = localStorage.getItem(key)
      return value ? (JSON.parse(value) as T) : null
    } catch {
      return null
    }
  },
  write<T>(key: string, value: T) {
    localStorage.setItem(key, JSON.stringify(value))
  },
  remove(key: string) {
    localStorage.removeItem(key)
  },
}

export function createFetchTransport(baseUrl = ''): Transport {
  const normalizedBase = baseUrl.replace(/\/$/, '')
  return {
    resolveURL: (path) => `${normalizedBase}${path}`,
    async request<T>(request: TransportRequest) {
      if (request.onUploadProgress && request.rawBody !== undefined) return uploadRequest<T>(`${normalizedBase}${request.path}`, request)
      const { path, method = 'GET', token, body, rawBody } = request
      const readonly = method === 'GET' || method === 'HEAD', userSignal = request.signal
      const timeoutMs = request.timeoutMs ?? (request.responseType === 'blob' ? undefined : readonly ? 20_000 : 30_000)
      // One deadline covers the entire logical request, including retries and body reads.
      const timeout = timeoutMs === undefined ? undefined : AbortSignal.timeout(timeoutMs)
      const signal = userSignal && timeout ? (AbortSignal.any ? AbortSignal.any([userSignal, timeout]) : userSignal) : userSignal ?? timeout
      const retrySignal = signal ?? new AbortController().signal
      const route = path.split('?')[0] || '/'
      for (let attempt = 0; ; attempt++) {
        const startedAt = performance.now()
        try {
          if (signal?.aborted) throw signal.reason
          const response = await fetch(`${normalizedBase}${path}`, {
            method, signal,
            headers: {
              Accept: 'application/json',
              ...(rawBody !== undefined ? { 'Content-Type': request.contentType ?? 'application/octet-stream' } : body === undefined ? {} : { 'Content-Type': 'application/json' }),
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: rawBody ?? (body === undefined ? undefined : JSON.stringify(body)),
          })
          const retryAfterMs = parseRetryAfter(response.headers.get('Retry-After'))
          const retry = readonly && attempt < 2 && ([502, 503, 504].includes(response.status) || response.status === 429 && retryAfterMs !== undefined && retryAfterMs <= 10_000)
          if (retry) {
            const duration = Math.round(performance.now() - startedAt)
            clientDiagnostics.record('http', 'request_completed', requestLevel(response.status, duration), { method, route, status: response.status, attempt: attempt + 1, duration_ms: duration })
            await response.body?.cancel().catch(() => {})
            await waitForRetry(retrySignal, (retryAfterMs ?? 400 * 3 ** attempt) + Math.random() * 200)
            continue
          }
          const empty = method === 'HEAD' || response.status === 204
          const contentType = response.headers.get('content-type') ?? ''
          const data = empty ? null : response.ok && request.responseType === 'blob' ? await response.blob() as T : contentType.includes('application/json') ? await response.json() as T : null
          if (signal?.aborted) throw signal.reason
          const duration = Math.round(performance.now() - startedAt)
          clientDiagnostics.record('http', 'request_completed', requestLevel(response.status, duration), { method, route, status: response.status, attempt: attempt + 1, duration_ms: duration })
          return { status: response.status, data, retryAfterMs }
        } catch (caught) {
          const error = timeout?.aborted && signal?.aborted && !userSignal?.aborted ? new DOMException('Время ожидания ответа истекло', 'TimeoutError') : caught
          clientDiagnostics.record('http', 'request_failed', userSignal?.aborted ? 'debug' : 'error', { method, route, attempt: attempt + 1, duration_ms: Math.round(performance.now() - startedAt), aborted: !!userSignal?.aborted, error_name: error instanceof Error ? error.name : typeof error })
          if (!readonly || attempt >= 2 || retrySignal.aborted || error instanceof Error && (error.name === 'AbortError' || error.name === 'SyntaxError')) throw error
          await waitForRetry(retrySignal, 400 * 3 ** attempt + Math.random() * 200)
        }
      }
    },
  }
}

function requestLevel(status: number, duration: number): 'debug' | 'info' | 'warn' {
  return duration >= 1000 || status >= 500 ? 'warn' : status >= 400 ? 'info' : 'debug'
}

export function parseRetryAfter(value: string | null): number | undefined {
  if (!value?.trim()) return undefined
  const seconds = Number(value)
  if (Number.isFinite(seconds)) return seconds >= 0 ? Math.min(seconds * 1000, 30_000) : undefined
  const date = Date.parse(value)
  return Number.isFinite(date) ? Math.min(Math.max(0, date - Date.now()), 30_000) : undefined
}

function uploadRequest<T>(url: string, request: TransportRequest): Promise<TransportResponse<T>> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open(request.method ?? 'PUT', url)
    xhr.timeout = 120_000
    xhr.setRequestHeader('Content-Type', request.contentType ?? 'application/octet-stream')
    if (request.token) xhr.setRequestHeader('Authorization', `Bearer ${request.token}`)
    const abort = () => xhr.abort()
    const done = () => request.signal?.removeEventListener('abort', abort)
    xhr.upload.onprogress = (event) => { if (event.lengthComputable) request.onUploadProgress?.(event.loaded / event.total) }
    xhr.onload = () => { done(); let data: T | null = null; try { data = JSON.parse(xhr.responseText) as T } catch { /* Non-JSON failure. */ } resolve({ status: xhr.status, data, retryAfterMs: parseRetryAfter(xhr.getResponseHeader('Retry-After')) }) }
    xhr.onerror = () => { done(); reject(new Error('Соединение прервано. Повторите загрузку.')) }
    xhr.ontimeout = xhr.onerror
    xhr.onabort = () => { done(); reject(new DOMException('Upload aborted', 'AbortError')) }
    request.signal?.addEventListener('abort', abort, { once: true })
    if (request.signal?.aborted) { done(); reject(new DOMException('Upload aborted', 'AbortError')); return }
    xhr.send(request.rawBody as XMLHttpRequestBodyInit)
  })
}
