/** Resolve server track labels per audio m-section; SDP attribute order varies. */
export function voiceTrackOwners(sdp: string): Map<string, string> {
  const owners = new Map<string, string>()
  for (const section of sdp.split(/(?=^m=)/m).slice(1)) {
    const lines = section.split(/\r?\n/).map((line) => line.trim())
    if (!/^m=audio [1-9]/.test(lines[0] ?? '') || lines.includes('a=inactive') || lines.includes('a=recvonly')) continue
    const mid = lines.find((line) => line.startsWith('a=mid:'))?.slice(6)
    if (!mid) continue
    const labels = lines.flatMap((line) => {
      const match = /^(?:a=msid:|a=ssrc:\d+ msid:)\S+ (audio-\S+)$/.exec(line)
      return match ? [match[1]!.slice(6)] : []
    })
    const unique = new Set(labels)
    if (unique.size === 1) owners.set(mid, labels[0]!)
  }
  return owners
}
