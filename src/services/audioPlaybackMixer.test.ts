// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AudioPlaybackMixer } from './audioPlaybackMixer'

class Track { stop = vi.fn() }
class Stream {
  constructor(private tracks = [new Track()]) {}
  getAudioTracks() { return this.tracks }
  getTracks() { return this.tracks }
}
class Context {
  static instances: Context[] = []
  static initialState = 'running'
  state = Context.initialState; currentTime = 0
  onstatechange: (() => void) | null = null
  nodes: { gain: { setTargetAtTime: ReturnType<typeof vi.fn> }; disconnect: ReturnType<typeof vi.fn> }[] = []
  constructor() { Context.instances.push(this) }
  createMediaStreamSource = vi.fn(() => ({ connect: vi.fn(), disconnect: vi.fn() }))
  createGain = vi.fn(() => { const node = { gain: { setTargetAtTime: vi.fn() }, connect: vi.fn(), disconnect: vi.fn() }; this.nodes.push(node); return node })
  createMediaStreamDestination = vi.fn(() => ({ stream: new Stream() }))
  setState(state: string) { this.state = state; this.onstatechange?.() }
  resume = vi.fn(async () => {
    if (Context.initialState === 'suspended') await new Promise<void>(() => {})
    this.setState('running')
  })
  close = vi.fn(async () => undefined)
}
beforeEach(() => {
  Context.instances = []
  Context.initialState = 'running'
  vi.stubGlobal('AudioContext', Context)
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('uses native volume up to 100%, then applies real gain and keeps one context for all participants', () => {
  const mixer = new AudioPlaybackMixer(), first = document.createElement('audio'), second = document.createElement('audio')
  const input = new Stream() as unknown as MediaStream
  first.muted = true
  mixer.setVolume(first, input, .5)
  expect(first.volume).toBe(.5); expect(first.srcObject).toBe(input); expect(Context.instances).toHaveLength(0)
  mixer.setVolume(first, input, 2)
  const backingAudio = vi.mocked(HTMLMediaElement.prototype.play).mock.contexts[0] as HTMLAudioElement
  expect(backingAudio.srcObject).toBe(input)
  expect(backingAudio.muted).toBe(true)
  mixer.setVolume(second, input, 4)
  expect(Context.instances).toHaveLength(1)
  const context = Context.instances[0]!
  expect(context.nodes[0]!.gain.setTargetAtTime).toHaveBeenLastCalledWith(2, 0, .01)
  expect(context.nodes[1]!.gain.setTargetAtTime).toHaveBeenLastCalledWith(4, 0, .01)
  expect(first.volume).toBe(1); expect(first.srcObject).not.toBe(input); expect(first.muted).toBe(true)
  const output = first.srcObject
  mixer.setVolume(first, input, .3)
  expect(first.srcObject).toBe(output)
  expect(context.nodes[0]!.gain.setTargetAtTime).toHaveBeenLastCalledWith(.3, 0, .01)
  mixer.remove(first)
  expect(backingAudio.srcObject).toBeNull()
  expect(HTMLMediaElement.prototype.pause).toHaveBeenCalledOnce()
  expect(context.close).not.toHaveBeenCalled()
  expect((output as unknown as Stream).getTracks()[0]!.stop).toHaveBeenCalledOnce()
  mixer.close()
  expect(context.close).toHaveBeenCalledOnce()
  expect((input as unknown as Stream).getTracks()[0]!.stop).not.toHaveBeenCalled()
})

it('resumes suspended gain processing and releases the graph when a stream is replaced', async () => {
  const blocked = vi.fn(), mixer = new AudioPlaybackMixer(blocked), audio = document.createElement('audio')
  const first = new Stream() as unknown as MediaStream, next = new Stream() as unknown as MediaStream
  mixer.setVolume(audio, first, 2)
  const context = Context.instances[0]!
  context.setState('suspended'); context.resume.mockRejectedValueOnce(new Error('Blocked'))
  mixer.resume(); await Promise.resolve(); await Promise.resolve()
  expect(audio.srcObject).toBe(first)
  expect(blocked).not.toHaveBeenCalled()
  mixer.resume(); await Promise.resolve()
  expect(context.state).toBe('running')
  expect(audio.srcObject).not.toBe(first)
  mixer.setVolume(audio, next, .7)
  expect(context.close).toHaveBeenCalledOnce(); expect(audio.srcObject).toBe(next); expect(audio.volume).toBe(.7)
  mixer.close()
})

it('keeps incoming tracks audible while the shared context cannot start', () => {
  Context.initialState = 'suspended'
  const mixer = new AudioPlaybackMixer()
  const first = document.createElement('audio'), second = document.createElement('audio')
  const firstInput = new Stream() as unknown as MediaStream, secondInput = new Stream() as unknown as MediaStream
  mixer.setVolume(first, firstInput, 2)
  mixer.setVolume(second, secondInput, 1.5)
  expect(first.srcObject).toBe(firstInput)
  expect(second.srcObject).toBe(secondInput)
  expect(first.volume).toBe(1)
  const context = Context.instances[0]!
  mixer.setVolume(second, secondInput, .5)
  context.setState('running')
  expect(first.srcObject).not.toBe(firstInput)
  expect(second.srcObject).toBe(secondInput)
  expect(second.volume).toBe(.5)
  mixer.close()
})

it('restores the incoming track when the processed stream fails to play', async () => {
  vi.mocked(HTMLMediaElement.prototype.play).mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('Playback failed'))
  const blocked = vi.fn(), mixer = new AudioPlaybackMixer(blocked), audio = document.createElement('audio')
  const input = new Stream() as unknown as MediaStream
  mixer.setVolume(audio, input, 2)
  await Promise.resolve()
  expect(audio.srcObject).toBe(input)
  expect(audio.volume).toBe(1)
  expect(blocked).not.toHaveBeenCalled()
  expect(Context.instances[0]!.close).toHaveBeenCalledOnce()
})

it('ignores playback failures from a removed output', async () => {
  let reject!: (reason: Error) => void
  vi.mocked(HTMLMediaElement.prototype.play).mockResolvedValueOnce(undefined).mockReturnValueOnce(new Promise<void>((_resolve, fail) => { reject = fail }))
  const blocked = vi.fn(), mixer = new AudioPlaybackMixer(blocked), audio = document.createElement('audio')
  mixer.setVolume(audio, new Stream() as unknown as MediaStream, 2)
  mixer.close()
  reject(new Error('Playback was stopped')); await Promise.resolve(); await Promise.resolve()
  expect(blocked).not.toHaveBeenCalled()
})
