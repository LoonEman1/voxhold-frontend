import { describe, expect, it } from 'vitest'
import { wireICECandidate } from './webrtcCandidate'

function browserCandidate(value: RTCIceCandidateInit) {
  return {
    toJSON: () => value,
  } as RTCIceCandidate
}

describe('wireICECandidate', () => {
  it('maps a browser candidate to the realtime wire format', () => {
    expect(wireICECandidate(browserCandidate({
      candidate: 'candidate:1 1 UDP 1 127.0.0.1 50000 typ host',
      sdpMid: '0',
      sdpMLineIndex: 0,
      usernameFragment: 'generation-1',
    }))).toEqual({
      candidate: 'candidate:1 1 UDP 1 127.0.0.1 50000 typ host',
      sdp_mid: '0',
      sdp_mline_index: 0,
      username_fragment: 'generation-1',
    })
  })

  it('ignores the browser end-of-candidates marker', () => {
    expect(wireICECandidate(browserCandidate({ candidate: '' }))).toBeNull()
    expect(wireICECandidate(browserCandidate({ candidate: '   ' }))).toBeNull()
  })
})
