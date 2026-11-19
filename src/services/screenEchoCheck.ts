import { waitForRetry } from '../lib/retryBusy'

const frequencies = [917, 1723]
const spectrumSize = 4096
type SpectrumPeak = { peak: number; nearby: number }

function monitor(context: AudioContext, track: MediaStreamTrack, sink: AudioNode) {
  const source = context.createMediaStreamSource(new MediaStream([track]))
  const analyser = context.createAnalyser()
  analyser.fftSize = spectrumSize
  analyser.smoothingTimeConstant = 0
  source.connect(analyser).connect(sink)
  const spectrum = new Float32Array(analyser.frequencyBinCount)
  return () => {
    analyser.getFloatFrequencyData(spectrum)
    return frequencies.map((frequency) => {
      const bin = Math.round(frequency * spectrumSize / context.sampleRate)
      const peak = Math.max(spectrum[bin - 1] ?? -Infinity, spectrum[bin] ?? -Infinity, spectrum[bin + 1] ?? -Infinity)
      const nearby = Math.max(spectrum[bin - 4] ?? -Infinity, spectrum[bin - 3] ?? -Infinity, spectrum[bin + 3] ?? -Infinity, spectrum[bin + 4] ?? -Infinity)
      return { peak, nearby }
    })
  }
}

export function matchesEchoProbe(baseline: readonly SpectrumPeak[], sample: readonly SpectrumPeak[]) {
  return sample.length === frequencies.length &&
    sample.every(({ peak, nearby }, index) => peak > -82 && peak > (baseline[index]?.peak ?? Infinity) + 12 && peak > nearby + 9)
}

/** Sends a short local tone to the same endpoint as the voice audio elements. */
export async function checkScreenEcho(screen: MediaStreamTrack, microphone: MediaStreamTrack | null, output: string, signal: AbortSignal) {
  if (typeof AudioContext === 'undefined') throw new Error('Браузер не поддерживает проверку эха.')
  signal.throwIfAborted()
  const player = new Audio()
  const context = new AudioContext()
  const started = new AbortController()
  let playback: MediaStream | null = null
  try {
    const sink = context.createGain()
    sink.gain.value = 0
    sink.connect(context.destination)
    const readScreen = monitor(context, screen, sink)
    const readMic = microphone?.readyState === 'live' ? monitor(context, microphone, sink) : null
    const tone = context.createGain()
    tone.gain.value = 0
    const destination = context.createMediaStreamDestination()
    playback = destination.stream
    tone.connect(destination)
    frequencies.forEach((frequency) => {
      const oscillator = context.createOscillator()
      oscillator.frequency.value = frequency
      oscillator.connect(tone)
      oscillator.start()
      oscillator.stop(context.currentTime + 4)
    })
    player.srcObject = playback
    const setOutput = output && player.setSinkId ? player.setSinkId(output) : Promise.resolve()
    await Promise.race([
      Promise.all([context.resume(), player.play(), setOutput]),
      waitForRetry(AbortSignal.any([signal, started.signal]), 1_500).then(() => {
        throw new Error('Не удалось воспроизвести тестовый сигнал.')
      }),
    ])
    started.abort()
    await waitForRetry(signal, 320)
    const screenBaseline = readScreen()
    const micBaseline = readMic?.()
    tone.gain.setTargetAtTime(0.09, context.currentTime, 0.035)
    let screenHits = 0, micHits = 0
    for (let index = 0; index < 8; index++) {
      await waitForRetry(signal, 160)
      if (matchesEchoProbe(screenBaseline, readScreen())) screenHits++
      if (micBaseline && readMic && matchesEchoProbe(micBaseline, readMic())) micHits++
    }
    if (!screen.enabled || screen.readyState !== 'live' || context.state !== 'running') {
      throw new Error('Звуковая дорожка изменилась во время проверки. Повторите её.')
    }
    return { screen: screenHits >= 2, microphone: readMic && microphone?.readyState === 'live' ? micHits >= 2 : null }
  } finally {
    started.abort()
    player.pause()
    player.srcObject = null
    playback?.getTracks().forEach((track) => track.stop())
    void context.close().catch(() => undefined)
  }
}
