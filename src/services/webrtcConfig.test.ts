import { describe, expect, it, vi } from 'vitest'
import {
  cloneRTCConfiguration,
  createWebRTCConfigService,
  parseWebRTCConfig,
  type WebRTCConfigState,
} from './webrtcConfig'

const fullPayload = {
  ice_servers: [
    {
      urls: ['turn:turn.example.com:3478?transport=udp', 'turn:turn.example.com:3478?transport=tcp'],
      username: 'user',
      credential: 'secret',
    },
  ],
  ice_transport_policy: 'all',
}

function firstServer(state: RTCConfiguration | WebRTCConfigState['configuration']) {
  const servers = state.iceServers ?? []
  expect(servers.length).toBeGreaterThan(0)
  return servers[0]!
}

describe('parseWebRTCConfig', () => {
  it('maps an empty list to host-only configuration with policy all', () => {
    const config = parseWebRTCConfig({ ice_servers: [], ice_transport_policy: 'all' })
    expect(config.iceServers).toEqual([])
    expect(config.iceTransportPolicy).toBe('all')
  })

  it('maps a full payload including credentials', () => {
    const config = parseWebRTCConfig(fullPayload)
    const server = firstServer(config)
    expect(server.urls).toEqual(['turn:turn.example.com:3478?transport=udp', 'turn:turn.example.com:3478?transport=tcp'])
    expect(server.username).toBe('user')
    expect(server.credential).toBe('secret')
  })

  it('rejects username without credential and vice versa', () => {
    expect(() => parseWebRTCConfig({
      ice_servers: [{ urls: ['turn:x'], username: 'user' }],
      ice_transport_policy: 'all',
    })).toThrow()
    expect(() => parseWebRTCConfig({
      ice_servers: [{ urls: ['turn:x'], credential: 'secret' }],
      ice_transport_policy: 'all',
    })).toThrow()
  })

  it('rejects malformed payloads', () => {
    expect(() => parseWebRTCConfig(null)).toThrow()
    expect(() => parseWebRTCConfig({})).toThrow()
    expect(() => parseWebRTCConfig({ ice_servers: [{ urls: [] }], ice_transport_policy: 'all' })).toThrow()
    expect(() => parseWebRTCConfig({ ice_servers: [{ urls: [''] }], ice_transport_policy: 'all' })).toThrow()
  })
})

describe('cloneRTCConfiguration', () => {
  it('produces an isolated deep copy', () => {
    const original = parseWebRTCConfig(fullPayload)
    const clone = cloneRTCConfiguration(original)
    const cloneServer = firstServer(clone)
    const originalServer = firstServer(original)
    const cloneUrls: string[] = Array.isArray(cloneServer.urls) ? cloneServer.urls : []
    cloneUrls.push('turn:other:3478')
    cloneServer.username = 'changed'
    expect(originalServer.urls).toHaveLength(2)
    expect(originalServer.username).toBe('user')
  })
})

describe('createWebRTCConfigService', () => {
  it('caches the configuration in memory after a successful load', async () => {
    const fetcher = vi.fn().mockResolvedValue(fullPayload)
    const service = createWebRTCConfigService({ fetcher, sleep: async () => undefined })
    const firstLoad = await service.load()
    const secondLoad = await service.load()
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(firstLoad.degraded).toBe(false)
    expect(firstServer(secondLoad.configuration)).not.toBe(firstServer(firstLoad.configuration))
  })

  it('retries transient failures with the configured delays before succeeding', async () => {
    const fetcher = vi.fn()
      .mockRejectedValueOnce(new Error('network'))
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(fullPayload)
    const sleeps: number[] = []
    const service = createWebRTCConfigService({
      fetcher,
      sleep: async (ms) => { sleeps.push(ms) },
    })
    const state = await service.load()
    expect(fetcher).toHaveBeenCalledTimes(3)
    expect(sleeps).toEqual([500, 1500])
    expect(state.degraded).toBe(false)
  })

  it('falls back to degraded host-only mode after exhausting retries', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('down'))
    const service = createWebRTCConfigService({
      fetcher,
      sleep: async () => undefined,
    })
    const state = await service.load()
    expect(state.degraded).toBe(true)
    expect(state.configuration).toEqual({})
  })

  it('refetches after invalidate', async () => {
    const fetcher = vi.fn().mockResolvedValue(fullPayload)
    const service = createWebRTCConfigService({ fetcher, sleep: async () => undefined })
    await service.load()
    service.invalidate()
    await service.load()
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
})
