import { clientDiagnostics } from './clientDiagnostics'

export interface TransportRequest {
  path: string
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  token?: string | null
  body?: unknown
  rawBody?: BodyInit
  contentType?: string
  responseType?: 'blob'
  signal?: AbortSignal
  onUploadProgress?: (fraction: number) => void
}

export interface TransportResponse<T> {
  status: number
  data: T | null
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
      const { path, method = 'GET', token, body, rawBody, signal } = request
      const startedAt = performance.now()
      const route = path.split('?')[0] || '/'
      let response: Response
      try {
        response = await fetch(`${normalizedBase}${path}`, {
          method,
          signal,
          headers: {
            Accept: 'application/json',
            ...(rawBody !== undefined ? { 'Content-Type': request.contentType ?? 'application/octet-stream' } : body === undefined ? {} : { 'Content-Type': 'application/json' }),
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: rawBody ?? (body === undefined ? undefined : JSON.stringify(body)),
        })
      } catch (error) {
        clientDiagnostics.record('http', 'request_failed', signal?.aborted ? 'debug' : 'error', {
          method,
          route,
          duration_ms: Math.round(performance.now() - startedAt),
          aborted: !!signal?.aborted,
          error_name: error instanceof Error ? error.name : typeof error,
        })
        throw error
      }

      if (response.status === 204) {
        clientDiagnostics.record('http', 'request_completed', 'info', {
          method,
          route,
          status: response.status,
          duration_ms: Math.round(performance.now() - startedAt),
        })
        return { status: response.status, data: null }
      }

      const contentType = response.headers.get('content-type') ?? ''
      const data = response.ok && request.responseType === 'blob' ? await response.blob() as T : contentType.includes('application/json')
        ? ((await response.json()) as T)
        : null

      clientDiagnostics.record(
        'http',
        'request_completed',
        response.ok ? 'info' : 'warn',
        {
          method,
          route,
          status: response.status,
          duration_ms: Math.round(performance.now() - startedAt),
        },
      )

      return { status: response.status, data }
    },
  }
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
    xhr.onload = () => { done(); let data: T | null = null; try { data = JSON.parse(xhr.responseText) as T } catch { /* Non-JSON failure. */ } resolve({ status: xhr.status, data }) }
    xhr.onerror = () => { done(); reject(new Error('Соединение прервано. Повторите загрузку.')) }
    xhr.ontimeout = xhr.onerror
    xhr.onabort = () => { done(); reject(new DOMException('Upload aborted', 'AbortError')) }
    request.signal?.addEventListener('abort', abort, { once: true })
    if (request.signal?.aborted) { done(); reject(new DOMException('Upload aborted', 'AbortError')); return }
    xhr.send(request.rawBody as XMLHttpRequestBodyInit)
  })
}
