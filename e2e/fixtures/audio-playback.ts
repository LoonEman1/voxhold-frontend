import { AudioPlaybackMixer } from '../../src/services/audioPlaybackMixer'

async function probe() {
  const context = new AudioContext(), oscillator = context.createOscillator(), level = context.createGain(), input = context.createMediaStreamDestination()
  const audio = document.createElement('audio'); audio.autoplay = true; audio.muted = true; document.body.append(audio)
  const mixer = new AudioPlaybackMixer()
  level.gain.value = .05; oscillator.frequency.value = 440
  oscillator.connect(level); level.connect(input); oscillator.start(); await context.resume()
  const measure = async (volume: number) => {
    mixer.setVolume(audio, input.stream, volume)
    const source = context.createMediaStreamSource(audio.srcObject as MediaStream), analyser = context.createAnalyser(), silent = context.createGain()
    analyser.fftSize = 2048; silent.gain.value = 0
    source.connect(analyser); analyser.connect(silent); silent.connect(context.destination)
    await new Promise((resolve) => setTimeout(resolve, 250))
    const samples = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(samples)
    const rms = Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length)
    source.disconnect(); analyser.disconnect(); silent.disconnect()
    return rms
  }
  try {
    const normal = await measure(1), boosted = await measure(2), quiet = await measure(.5)
    return { normal, boosted, quiet, elementVolume: audio.volume }
  } finally { mixer.close(); audio.remove(); oscillator.stop(); input.stream.getTracks().forEach((track) => track.stop()); await context.close() }
}
document.querySelector<HTMLButtonElement>('#start')!.onclick = () => { Object.assign(window, { volumeProbe: probe() }) }
