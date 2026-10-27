import { describe, expect, it } from 'vitest'
import { voiceTrackOwners } from './voiceTrackOwners'

describe('voice track ownership', () => {
  it('pairs attributes within each audio section regardless of their order', () => {
    const owners = voiceTrackOwners('v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=msid:voice-1 audio-alice\r\na=mid:0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=mid:1\r\na=ssrc:123 msid:voice-1 audio-bob\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\na=mid:2\r\na=msid:screen audio-not-a-speaker\r\n')
    expect([...owners]).toEqual([['0', 'alice'], ['1', 'bob']])
  })
  it('does not carry an owner across a removed, inactive or unlabelled section', () => {
    expect([...voiceTrackOwners('v=0\nm=audio 0 UDP/TLS/RTP/SAVPF 111\na=mid:0\na=msid:voice audio-old\nm=audio 9 UDP/TLS/RTP/SAVPF 111\na=mid:1\na=msid:voice audio-inactive\na=inactive\nm=audio 9 UDP/TLS/RTP/SAVPF 111\na=mid:2\na=recvonly\nm=audio 9 UDP/TLS/RTP/SAVPF 111\na=mid:3\n')]).toEqual([])
  })
})
