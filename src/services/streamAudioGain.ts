/** Adjust the outgoing screen audio without renegotiation or local monitoring. */
export class StreamAudioGain {
  readonly stream: MediaStream
  private context: AudioContext | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private gain: GainNode | null = null
  private output: MediaStreamAudioDestinationNode | null = null

  constructor(input: MediaStream, volume: number) {
    const tracks = input.getAudioTracks()
    this.stream = input
    if (!tracks.length) return
    const context = new AudioContext()
    try {
      this.context = context
      this.source = context.createMediaStreamSource(new MediaStream(tracks))
      this.gain = context.createGain()
      this.output = context.createMediaStreamDestination()
      this.source.connect(this.gain)
      this.gain.connect(this.output)
      this.stream = new MediaStream([...input.getVideoTracks(), ...this.output.stream.getAudioTracks()])
      this.setVolume(volume)
    } catch (error) {
      this.close()
      throw error
    }
  }

  setVolume(volume: number) {
    if (!this.context || !this.gain) return
    this.gain.gain.setTargetAtTime(Math.max(0, Math.min(100, volume)) / 100, this.context.currentTime, 0.01)
  }

  async resume() { if (this.context?.state === 'suspended') await this.context.resume() }

  close() {
    this.source?.disconnect()
    this.gain?.disconnect()
    this.output?.stream.getTracks().forEach((track) => track.stop())
    void this.context?.close().catch(() => undefined)
    this.source = null; this.gain = null; this.output = null; this.context = null
  }
}
