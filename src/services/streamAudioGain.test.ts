import { afterEach, expect, it, vi } from 'vitest'
import { StreamAudioGain } from './streamAudioGain'

afterEach(() => vi.unstubAllGlobals())

it('changes only the outgoing audio gain and releases its own resources', async () => {
  const video = { kind: 'video', stop: vi.fn() }, audio = { kind: 'audio', stop: vi.fn() }, processed = { kind: 'audio', stop: vi.fn() }
  class Media {
    constructor(private tracks: unknown[]) {}
    getTracks() { return this.tracks }
    getVideoTracks() { return this.tracks.filter((track) => (track as typeof video).kind === 'video') }
    getAudioTracks() { return this.tracks.filter((track) => (track as typeof audio).kind === 'audio') }
  }
  const source = { connect: vi.fn(), disconnect: vi.fn() }
  const gain = { gain: { setTargetAtTime: vi.fn() }, connect: vi.fn(), disconnect: vi.fn() }
  const context = { currentTime: 1, state: 'suspended', resume: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined), createMediaStreamSource: vi.fn(() => source), createGain: () => gain, createMediaStreamDestination: () => ({ stream: new Media([processed]) }) }
  vi.stubGlobal('MediaStream', Media)
  vi.stubGlobal('AudioContext', class { constructor() { return context } })
  const mixer = new StreamAudioGain(new Media([video, audio]) as unknown as MediaStream, 37)
  await mixer.resume()
  expect(context.resume).toHaveBeenCalledOnce()
  expect(gain.gain.setTargetAtTime).toHaveBeenLastCalledWith(0.37, 1, 0.01)
  mixer.setVolume(0)
  expect(gain.gain.setTargetAtTime).toHaveBeenLastCalledWith(0, 1, 0.01)
  mixer.setVolume(100)
  expect(mixer.stream.getVideoTracks()).toEqual([video])
  expect(mixer.stream.getAudioTracks()).toEqual([processed])
  mixer.close(); mixer.close()
  expect(processed.stop).toHaveBeenCalledOnce()
  expect(context.close).toHaveBeenCalledOnce()
  expect(video.stop).not.toHaveBeenCalled()
  expect(audio.stop).not.toHaveBeenCalled()
})
