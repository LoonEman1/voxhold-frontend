import type { WebRTCConfigPayload } from '../domain/types'
import { clientDiagnostics } from '../platform/clientDiagnostics'

export interface WebRTCConfigState {
  configuration: RTCConfiguration
  /** True when TURN could not be loaded and host-only connectivity is used. */
  degraded: boolean
}

export type WebRTCConfigFetcher = () => Promise<WebRTCConfigPayload>

const DEFAULT_RETRY_DELAYS_MS = [500, 1500, 4000]

/**
 * Strict mapper from the backend payload to RTCConfiguration. Username and
 * credential must be present together or absent together; anything malformed
 * throws instead of silently degrading security.
 */
export function parseWebRTCConfig(payload: unknown): RTCConfiguration {
  if (!payload || typeof payload !== 'object') throw new Error('Некорректная конфигурация WebRTC')
  const value = payload as Partial<WebRTCConfigPayload>
  if (!Array.isArray(value.ice_servers)) throw new Error('Некорректный список ICE-серверов')
  const iceServers: RTCIceServer[] = []
  for (const server of value.ice_servers) {
    if (!server || !Array.isArray(server.urls) || !server.urls.length
      || server.urls.some((item) => typeof item !== 'string' || item.trim() === '')) {
      throw new Error('Некорректный ICE-сервер')
    }
    const username = typeof server.username === 'string' ? server.username : ''
    const credential = typeof server.credential === 'string' ? server.credential : ''
    if (!!username !== !!credential) {
      throw new Error('ICE-сервер передал username без credential или наоборот')
    }
    iceServers.push({
      urls: [...server.urls],
      ...(username && credential ? { username, credential } : {}),
    })
  }
  // Direct UDP stays the primary path; TURN is only an ICE fallback.
  return {
    iceServers,
    iceTransportPolicy: 'all',
  }
}

/** Deep clone so every RTCPeerConnection receives its own object/arrays. */
export function cloneRTCConfiguration(value: RTCConfiguration): RTCConfiguration {
  return {
    ...value,
    iceServers: (value.iceServers ?? []).map((server) => ({
      ...server,
      urls: Array.isArray(server.urls) ? [...server.urls] : [],
      ...(server.username !== undefined ? { username: server.username } : {}),
      ...(server.credential !== undefined ? { credential: server.credential } : {}),
    })),
  }
}

export interface WebRTCConfigServiceOptions {
  fetcher: WebRTCConfigFetcher
  retryDelaysMs?: number[]
  sleep?: (ms: number) => Promise<void>
}

export function createWebRTCConfigService(options: WebRTCConfigServiceOptions) {
  const retryDelaysMs = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms)))
  let cache: RTCConfiguration | null = null

  return {
    /**
     * Loads the runtime ICE configuration. Retries transient failures with
     * increasing delays; once retries are exhausted it resolves to a visible
     * degraded host-only configuration instead of falling back to build-time
     * values.
     */
    async load(): Promise<WebRTCConfigState> {
      if (cache) return { configuration: cloneRTCConfiguration(cache), degraded: false }
      for (let attempt = 0; ; attempt += 1) {
        try {
          const payload = await options.fetcher()
          cache = parseWebRTCConfig(payload)
          clientDiagnostics.record('webrtc', 'webrtc_config_loaded', 'info', {
            ice_server_count: cache.iceServers?.length ?? 0,
          })
          return { configuration: cloneRTCConfiguration(cache), degraded: false }
        } catch (error) {
          if (attempt >= retryDelaysMs.length) {
            clientDiagnostics.record('webrtc', 'webrtc_config_degraded', 'warn', {
              error_name: error instanceof Error ? error.name : typeof error,
            })
            return { configuration: {}, degraded: true }
          }
          await sleep(retryDelaysMs[attempt])
        }
      }
    },
    /** Forces the next load() to fetch fresh values, e.g. before media recovery. */
    invalidate() {
      cache = null
    },
  }
}

export type WebRTCConfigService = ReturnType<typeof createWebRTCConfigService>
