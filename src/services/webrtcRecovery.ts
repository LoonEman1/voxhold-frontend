interface CandidateWithUsernameFragment {
  username_fragment?: string | null
}

function iceUsernameFragment(sdp: string | undefined) {
  return sdp?.match(/(?:^|\r?\n)a=ice-ufrag:([^\r\n]+)/)?.[1] ?? ''
}

export function remoteDescriptionAcceptsCandidate(
  peer: RTCPeerConnection,
  candidate: CandidateWithUsernameFragment,
) {
  const remote = peer.remoteDescription
  if (!remote) return false
  const candidateUfrag = candidate.username_fragment?.trim()
  if (!candidateUfrag) return true
  return iceUsernameFragment(remote.sdp) === candidateUfrag
}

export class WebRTCRecoveryController {
  private timer: number | null = null
  private generation = 0
  private running = false

  constructor(
    private readonly delays = [2000, 5000, 10000, 20000],
    private readonly exhaustionGrace = 10000,
  ) {}

  start(
    immediate: boolean,
    attempt: () => Promise<void> | void,
    exhausted: () => void,
  ) {
    if (this.running && !immediate) return
    this.stop()
    this.running = true
    const generation = this.generation
    const delays = immediate
      ? [0, ...this.delays.slice(1)]
      : this.delays

    const run = (index: number) => {
      if (!this.running || generation !== this.generation) return
      if (index >= delays.length) {
        this.timer = window.setTimeout(() => {
          this.timer = null
          if (!this.running || generation !== this.generation) return
          this.running = false
          exhausted()
        }, this.exhaustionGrace)
        return
      }
      this.timer = window.setTimeout(() => {
        this.timer = null
        if (!this.running || generation !== this.generation) return
        void Promise.resolve(attempt())
          .catch(() => undefined)
          .finally(() => run(index + 1))
      }, Math.max(0, delays[index] ?? 0))
    }
    run(0)
  }

  stop() {
    this.generation += 1
    this.running = false
    if (this.timer !== null) window.clearTimeout(this.timer)
    this.timer = null
  }
}
