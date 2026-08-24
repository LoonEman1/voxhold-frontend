import { afterEach, describe, expect, it, vi } from 'vitest'
import { selectedStreamCodec, supportedStreamCodecs } from './stream'
import { DEFAULT_STREAM_PREFERENCES } from './streamSettings'

const nativeSender = globalThis.RTCRtpSender
const nativeReceiver = globalThis.RTCRtpReceiver

interface TestCodecCapability {
  mimeType: string
  clockRate: number
  sdpFmtpLine?: string
}

function installCapabilities(codecs: TestCodecCapability[]) {
  const constructor = {
    getCapabilities: vi.fn(() => ({ codecs, headerExtensions: [] })),
  }
  Object.defineProperty(globalThis, 'RTCRtpSender', {
    configurable: true,
    value: constructor,
  })
  Object.defineProperty(globalThis, 'RTCRtpReceiver', {
    configurable: true,
    value: constructor,
  })
}

afterEach(() => {
  Object.defineProperty(globalThis, 'RTCRtpSender', {
    configurable: true,
    value: nativeSender,
  })
  Object.defineProperty(globalThis, 'RTCRtpReceiver', {
    configurable: true,
    value: nativeReceiver,
  })
})

describe('stream codec selection', () => {
  it('offers only the interoperable codec profiles in compatibility order', () => {
    installCapabilities([
      { mimeType: 'video/VP8', clockRate: 90_000 },
      { mimeType: 'video/VP9', clockRate: 90_000, sdpFmtpLine: 'profile-id=0' },
      { mimeType: 'video/H264', clockRate: 90_000, sdpFmtpLine: 'packetization-mode=0;profile-level-id=42001f' },
      { mimeType: 'video/H264', clockRate: 90_000, sdpFmtpLine: 'level-asymmetry-allowed=1;packetization-mode=1; profile-level-id=42E01f' },
      { mimeType: 'video/AV1', clockRate: 90_000 },
    ])

    // RFC 7742 compatibility policy: H.264 first, then VP8, VP9, AV1.
    expect(supportedStreamCodecs()).toEqual(['h264', 'vp8', 'vp9', 'av1'])
    expect(selectedStreamCodec(DEFAULT_STREAM_PREFERENCES)).toBe('h264')
  })

  it('accepts Constrained Baseline and legacy H.264 profiles regardless of case or level', () => {
    installCapabilities([
      { mimeType: 'video/H264', clockRate: 90_000, sdpFmtpLine: 'PROFILE-LEVEL-ID=42E01F; packetization-mode = 1; level-asymmetry-allowed=1' },
      { mimeType: 'video/H264', clockRate: 90_000, sdpFmtpLine: 'packetization-mode=1;profile-level-id=42001f' },
    ])
    expect(supportedStreamCodecs('send')).toEqual(['h264'])
    expect(supportedStreamCodecs()).toEqual(['h264'])
  })

  it('rejects H.264 without packetization-mode 1 and unknown profiles', () => {
    installCapabilities([
      { mimeType: 'video/H264', clockRate: 90_000, sdpFmtpLine: 'packetization-mode=0;profile-level-id=42e01f' },
      { mimeType: 'video/H264', clockRate: 90_000, sdpFmtpLine: 'packetization-mode=1;profile-level-id=640c1f' },
      { mimeType: 'video/VP8', clockRate: 90_000 },
    ])
    expect(supportedStreamCodecs()).toEqual(['vp8'])
  })

  it('does not advertise incompatible VP9 and H.264 profiles', () => {
    installCapabilities([
      { mimeType: 'video/VP8', clockRate: 90_000 },
      { mimeType: 'video/VP9', clockRate: 90_000, sdpFmtpLine: 'profile-id=2' },
      { mimeType: 'video/H264', clockRate: 90_000, sdpFmtpLine: 'packetization-mode=0;profile-level-id=42001f' },
    ])

    expect(supportedStreamCodecs()).toEqual(['vp8'])
    expect(selectedStreamCodec(DEFAULT_STREAM_PREFERENCES)).toBe('vp8')
  })

  it('is role-aware: send and receive capabilities are checked separately', () => {
    const senderCaps = { codecs: [{ mimeType: 'video/VP8', clockRate: 90_000 }], headerExtensions: [] }
    const receiverCaps = { codecs: [{ mimeType: 'video/H264', clockRate: 90_000, sdpFmtpLine: 'packetization-mode=1;profile-level-id=42e01f' }], headerExtensions: [] }
    Object.defineProperty(globalThis, 'RTCRtpSender', {
      configurable: true,
      value: { getCapabilities: vi.fn(() => senderCaps) },
    })
    Object.defineProperty(globalThis, 'RTCRtpReceiver', {
      configurable: true,
      value: { getCapabilities: vi.fn(() => receiverCaps) },
    })
    expect(supportedStreamCodecs('send')).toEqual(['vp8'])
    expect(supportedStreamCodecs('receive')).toEqual(['h264'])
    expect(supportedStreamCodecs('both')).toEqual([])
  })
})
