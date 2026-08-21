export interface TransportRequest {
  path: string
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  token?: string | null
  body?: unknown
  signal?: AbortSignal
}

export interface TransportResponse<T> {
  status: number
  data: T | null
}

export interface Transport {
  request<T>(request: TransportRequest): Promise<TransportResponse<T>>
}

export interface SessionStorageAdapter {
  read<T>(key: string): T | null
  write<T>(key: string, value: T): void
  remove(key: string): void
}

export const browserSessionStorage: SessionStorageAdapter = {
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
    async request<T>(request: TransportRequest) {
      const { path, method = 'GET', token, body, signal } = request
      const response = await fetch(`${normalizedBase}${path}`, {
        method,
        signal,
        headers: {
          Accept: 'application/json',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      })

      if (response.status === 204) return { status: response.status, data: null }

      const contentType = response.headers.get('content-type') ?? ''
      const data = contentType.includes('application/json')
        ? ((await response.json()) as T)
        : null

      return { status: response.status, data }
    },
  }
}
