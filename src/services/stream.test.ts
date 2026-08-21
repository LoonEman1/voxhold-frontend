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
  it('offers only the interoperable codec profiles', () => {
    installCapabilities([
      { mimeType: 'video/VP8', clockRate: 90_000 },
      { mimeType: 'video/VP9', clockRate: 90_000, sdpFmtpLine: 'profile-id=0' },
      { mimeType: 'video/H264', clockRate: 90_000, sdpFmtpLine: 'packetization-mode=0;profile-level-id=42001f' },
      { mimeType: 'video/H264', clockRate: 90_000, sdpFmtpLine: 'level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42001f' },
      { mimeType: 'video/AV1', clockRate: 90_000 },
    ])

    expect(supportedStreamCodecs()).toEqual(['vp9', 'h264', 'av1', 'vp8'])
    expect(selectedStreamCodec(DEFAULT_STREAM_PREFERENCES)).toBe('vp9')
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
})
