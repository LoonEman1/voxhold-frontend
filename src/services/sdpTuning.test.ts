import { describe, expect, it } from 'vitest'
import { streamStartBitrateKbps, tunePublisherRemoteDescription, withOpusStereo, withVideoStartBitrate } from './sdpTuning'

const OFFER = [
  'v=0',
  'o=- 1 1 IN IP4 0.0.0.0',
  's=-',
  't=0 0',
  'm=video 9 UDP/TLS/RTP/SAVPF 96 97 98 99',
  'c=IN IP4 0.0.0.0',
  'a=rtpmap:96 VP8/90000',
  'a=rtcp-fb:96 nack',
  'a=rtpmap:97 rtx/90000',
  'a=fmtp:97 apt=96',
  'a=rtpmap:98 VP9/90000',
  'a=fmtp:98 profile-id=0',
  'a=rtpmap:99 rtx/90000',
  'a=fmtp:99 apt=98',
  'm=audio 9 UDP/TLS/RTP/SAVPF 111',
  'c=IN IP4 0.0.0.0',
  'a=rtpmap:111 opus/48000/2',
  'a=fmtp:111 minptime=10;useinbandfec=1;maxaveragebitrate=320000',
  '',
].join('\r\n')

describe('publisher remote SDP tuning', () => {
  it('adds a start bitrate to primary video codecs only', () => {
    const tuned = withVideoStartBitrate(OFFER, 2400)

    expect(tuned).toContain('a=rtpmap:96 VP8/90000\r\na=fmtp:96 x-google-start-bitrate=2400\r\na=rtcp-fb:96 nack')
    expect(tuned).toContain('a=fmtp:98 profile-id=0;x-google-start-bitrate=2400\r\n')
    expect(tuned).toContain('a=fmtp:97 apt=96\r\n')
    expect(tuned).toContain('a=fmtp:99 apt=98\r\n')
    expect(tuned).toContain('a=fmtp:111 minptime=10;useinbandfec=1;maxaveragebitrate=320000\r\n')
    expect(tuned.endsWith('\r\n')).toBe(true)
  })

  it('keeps an explicit start bitrate and ignores invalid values', () => {
    const explicit = OFFER.replace('profile-id=0', 'profile-id=0;x-google-start-bitrate=900')
    expect(withVideoStartBitrate(explicit, 2400)).toContain('profile-id=0;x-google-start-bitrate=900\r\n')
    expect(withVideoStartBitrate(OFFER, 0)).toBe(OFFER)
  })

  it('requests stereo Opus without raising the remote bitrate ceiling', () => {
    expect(withOpusStereo(OFFER, 128_000)).toContain('a=fmtp:111 minptime=10;useinbandfec=1;maxaveragebitrate=128000;stereo=1\r\n')
    const low = OFFER.replace('maxaveragebitrate=320000', 'maxaveragebitrate=64000')
    expect(withOpusStereo(low, 128_000)).toContain('maxaveragebitrate=64000;stereo=1\r\n')
  })

  it('creates the Opus fmtp line of a browser answer that has none', () => {
    const answer = 'v=0\nm=audio 9 UDP/TLS/RTP/SAVPF 111\na=rtpmap:111 opus/48000/2\na=mid:1\n'
    expect(withOpusStereo(answer, 96_000)).toBe(
      'v=0\nm=audio 9 UDP/TLS/RTP/SAVPF 111\na=rtpmap:111 opus/48000/2\na=fmtp:111 stereo=1;maxaveragebitrate=96000\na=mid:1\n',
    )
  })

  it('derives a bounded start bitrate from the selected video bitrate', () => {
    expect(streamStartBitrateKbps(2500)).toBe(1000)
    expect(streamStartBitrateKbps(16000)).toBe(2500)
    const tuned = tunePublisherRemoteDescription(OFFER, { videoBitrateKbps: 6000, audioBitrateKbps: 128 })
    expect(tuned).toContain('x-google-start-bitrate=2400')
    expect(tuned).toContain('maxaveragebitrate=128000;stereo=1')
  })
})
