import { AudioPlaybackMixer } from '../../src/services/audioPlaybackMixer'

async function localDescription(peer: RTCPeerConnection, description: RTCSessionDescriptionInit) {
  await peer.setLocalDescription(description)
  if (peer.iceGatheringState !== 'complete') {
    await new Promise<void>((resolve) => {
      const gathered = () => {
        if (peer.iceGatheringState !== 'complete') return
        peer.removeEventListener('icegatheringstatechange', gathered)
        resolve()
      }
      peer.addEventListener('icegatheringstatechange', gathered)
    })
  }
  return peer.localDescription!
}

async function probe() {
  const context = new AudioContext(), oscillator = context.createOscillator(), level = context.createGain(), input = context.createMediaStreamDestination()
  const audio = document.createElement('audio'); audio.autoplay = true; audio.muted = true; document.body.append(audio)
  const mixer = new AudioPlaybackMixer()
  const sender = new RTCPeerConnection(), receiver = new RTCPeerConnection()
  level.gain.value = .05; oscillator.frequency.value = 440
  oscillator.connect(level); level.connect(input); oscillator.start(); await context.resume()
  const measure = async (remote: MediaStream, volume: number) => {
    mixer.setVolume(audio, remote, volume)
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
    // A synthesized local stream stays audible even if the browser stops delivering a detached WebRTC track.
    const received = new Promise<MediaStream>((resolve) => {
      receiver.addEventListener('track', ({ track }) => resolve(new MediaStream([track])), { once: true })
    })
    sender.addTrack(input.stream.getAudioTracks()[0]!)
    await receiver.setRemoteDescription(await localDescription(sender, await sender.createOffer()))
    await sender.setRemoteDescription(await localDescription(receiver, await receiver.createAnswer()))
    const remote = await received
    audio.srcObject = remote
    await audio.play()
    const normal = await measure(remote, 1), boosted = await measure(remote, 2), quiet = await measure(remote, .5)
    return { normal, boosted, quiet, elementVolume: audio.volume }
  } finally {
    mixer.close(); audio.remove(); sender.close(); receiver.close()
    oscillator.stop(); input.stream.getTracks().forEach((track) => track.stop()); await context.close()
  }
}
document.querySelector<HTMLButtonElement>('#start')!.onclick = () => { Object.assign(window, { volumeProbe: probe() }) }
