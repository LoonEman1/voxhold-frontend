import type { VoiceICECandidate } from '../domain/types'

export function wireICECandidate(candidate: RTCIceCandidate): VoiceICECandidate | null {
  const value = candidate.toJSON()
  const candidateValue = value.candidate?.trim()
  if (!candidateValue) return null

  return {
    candidate: candidateValue,
    sdp_mid: value.sdpMid,
    sdp_mline_index: value.sdpMLineIndex,
    username_fragment: value.usernameFragment,
  }
}
