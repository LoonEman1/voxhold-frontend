import type { VoiceICECandidate } from '../domain/types'
import { normalizeVoicePreferences, type VoicePreferences } from './voiceSettings'
import { remoteDescriptionAcceptsCandidate } from './webrtcRecovery'

export type VoiceMediaConnectionState = 'new' | 'connecting' | 'connected' | 'disconnected' | 'failed' | 'closed'

interface VoiceMediaOptions {
  onAnswer: (sdp: string) => void
  onICECandidate: (candidate: VoiceICECandidate) => void
  onConnectionStateChange: (state: VoiceMediaConnectionState) => void
  onError: (error: Error) => void
  onInputLevel?: (level: number) => void
}

interface VoiceInputChain {
  raw: MediaStream
  stream: MediaStream
  track: MediaStreamTrack
  context: AudioContext | null
  gain: GainNode | null
  analyser: AnalyserNode | null
  meterTimer: number | null
}

function browserICEConfiguration(): RTCConfiguration {
  const urls = (import.meta.env.VITE_WEBRTC_ICE_SERVERS as string | undefined)
    ?.split(',')
    .map((url) => url.trim())
    .filter(Boolean)

  if (!urls?.length) return {}

  const username = (import.meta.env.VITE_WEBRTC_ICE_USERNAME as string | undefined)?.trim()
  const credential = (import.meta.env.VITE_WEBRTC_ICE_CREDENTIAL as string | undefined)?.trim()
  return {
    iceServers: [{
      urls,
      ...(username && credential ? { username, credential } : {}),
    }],
  }
}

function toBrowserCandidate(candidate: VoiceICECandidate): RTCIceCandidateInit {
  return {
    candidate: candidate.candidate,
    sdpMid: candidate.sdp_mid ?? null,
    sdpMLineIndex: candidate.sdp_mline_index ?? null,
    usernameFragment: candidate.username_fragment ?? null,
  }
}

function inputConstraints(preferences: VoicePreferences): MediaTrackConstraints {
  return {
    ...(preferences.inputDeviceId ? { deviceId: { exact: preferences.inputDeviceId } } : {}),
    autoGainControl: preferences.autoGainControl,
    echoCancellation: preferences.echoCancellation,
    noiseSuppression: preferences.noiseSuppression,
    channelCount: 1,
  }
}

function needsNewInput(previous: VoicePreferences, next: VoicePreferences) {
  return previous.inputDeviceId !== next.inputDeviceId
    || previous.autoGainControl !== next.autoGainControl
    || previous.echoCancellation !== next.echoCancellation
    || previous.noiseSuppression !== next.noiseSuppression
}

export class BrowserVoiceSession {
  private peer: RTCPeerConnection | null = null
  private input: VoiceInputChain | null = null
  private inputSender: RTCRtpSender | null = null
  private output: MediaStream | null = null
  private audio: HTMLAudioElement | null = null
  private preferences: VoicePreferences | null = null
  private pendingRemoteCandidates: VoiceICECandidate[] = []
  private offerQueue: Promise<void> = Promise.resolve()
  private inputQueue: Promise<void> = Promise.resolve()
  private closed = false
  private selfMute = false
  private selfDeaf = false

  constructor(private readonly options: VoiceMediaOptions) {}

  static supported() {
    return typeof RTCPeerConnection !== 'undefined' && !!navigator.mediaDevices?.getUserMedia
  }

  static outputSelectionSupported() {
    return typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype
  }

  async start(selfMute: boolean, selfDeaf: boolean, preferences: VoicePreferences) {
    if (this.peer || this.closed) throw new Error('Voice session is already initialized')
    if (!BrowserVoiceSession.supported()) {
      throw new Error('Голосовые каналы требуют современный браузер и защищённое HTTPS-соединение')
    }

    this.selfMute = selfMute
    this.selfDeaf = selfDeaf
    this.preferences = normalizeVoicePreferences(preferences)
    const input = await this.createInput(this.preferences)

    if (this.closed) {
      this.disposeInput(input)
      return
    }

    const peer = new RTCPeerConnection(browserICEConfiguration())
    const output = new MediaStream()
    const audio = document.createElement('audio')
    audio.autoplay = true
    audio.muted = selfDeaf
    audio.volume = this.preferences.outputVolume / 100
    audio.setAttribute('aria-hidden', 'true')
    audio.className = 'voice-audio-output'
    audio.srcObject = output
    document.body.append(audio)

    this.input = input
    this.output = output
    this.audio = audio
    this.peer = peer
    input.track.enabled = !selfMute
    this.inputSender = peer.addTrack(input.track, input.stream)
    await this.applySenderBitrate(this.preferences.bitrateKbps).catch(() => {
      // Keep voice available in WebViews that do not expose encoding controls.
    })
    await this.applyOutputDevice(this.preferences.outputDeviceId)

    peer.onicecandidate = ({ candidate }) => {
      if (!candidate || this.closed) return
      const value = candidate.toJSON()
      this.options.onICECandidate({
        candidate: value.candidate ?? '',
        sdp_mid: value.sdpMid,
        sdp_mline_index: value.sdpMLineIndex,
        username_fragment: value.usernameFragment,
      })
    }

    peer.ontrack = ({ track }) => {
      if (this.closed || output.getTracks().some((item) => item.id === track.id)) return
      output.addTrack(track)
      track.addEventListener('ended', () => output.removeTrack(track), { once: true })
      void audio.play().catch(() => {
        // Browsers may delay autoplay until the next explicit user interaction.
      })
    }

    peer.onconnectionstatechange = () => {
      if (!this.closed) this.options.onConnectionStateChange(peer.connectionState)
    }
  }

  private async createInput(preferences: VoicePreferences): Promise<VoiceInputChain> {
    const raw = await navigator.mediaDevices.getUserMedia({
      audio: inputConstraints(preferences),
      video: false,
    })
    const rawTrack = raw.getAudioTracks()[0]
    if (!rawTrack) {
      raw.getTracks().forEach((track) => track.stop())
      throw new Error('Микрофон не передал аудиодорожку')
    }

    if (typeof AudioContext === 'undefined') {
      return { raw, stream: raw, track: rawTrack, context: null, gain: null, analyser: null, meterTimer: null }
    }

    let context: AudioContext | null = null
    try {
      context = new AudioContext({ latencyHint: 'interactive' })
      const source = context.createMediaStreamSource(raw)
      const gain = context.createGain()
      const analyser = context.createAnalyser()
      const destination = context.createMediaStreamDestination()
      gain.gain.value = preferences.inputVolume / 100
      analyser.fftSize = 256
      analyser.smoothingTimeConstant = 0.72
      source.connect(gain)
      gain.connect(analyser)
      analyser.connect(destination)
      if (context.state === 'suspended') await context.resume()

      const track = destination.stream.getAudioTracks()[0]
      if (!track) throw new Error('Не удалось подготовить аудиодорожку')
      const chain: VoiceInputChain = { raw, stream: destination.stream, track, context, gain, analyser, meterTimer: null }
      this.startInputMeter(chain)
      return chain
    } catch (error) {
      void context?.close().catch(() => undefined)
      raw.getTracks().forEach((track) => track.stop())
      throw error
    }
  }

  private startInputMeter(input: VoiceInputChain) {
    if (!input.analyser || !this.options.onInputLevel) return
    const values = new Uint8Array(input.analyser.fftSize)
    input.meterTimer = window.setInterval(() => {
      if (this.closed || !input.analyser) return
      input.analyser.getByteTimeDomainData(values)
      let energy = 0
      for (const value of values) {
        const normalized = (value - 128) / 128
        energy += normalized * normalized
      }
      const rms = Math.sqrt(energy / values.length)
      this.options.onInputLevel?.(this.selfMute ? 0 : Math.min(1, rms * 4.5))
    }, 90)
  }

  private disposeInput(input: VoiceInputChain | null) {
    if (!input) return
    if (input.meterTimer !== null) window.clearInterval(input.meterTimer)
    input.raw.getTracks().forEach((track) => track.stop())
    if (input.stream !== input.raw) input.stream.getTracks().forEach((track) => track.stop())
    void input.context?.close().catch(() => undefined)
  }

  private async applyOutputDevice(deviceId: string) {
    const audio = this.audio
    if (!audio || !BrowserVoiceSession.outputSelectionSupported() || !deviceId) return
    await audio.setSinkId(deviceId)
  }

  private async applySenderBitrate(bitrateKbps: number) {
    const sender = this.inputSender
    if (!sender?.getParameters || !sender.setParameters) return
    const parameters = sender.getParameters()
    const encoding = parameters.encodings?.[0]
    if (!encoding) return
    encoding.maxBitrate = bitrateKbps * 1000
    await sender.setParameters(parameters)
  }

  applyPreferences(value: VoicePreferences) {
    const next = normalizeVoicePreferences(value)
    const previous = this.preferences ?? next
    this.preferences = next
    if (this.audio) this.audio.volume = next.outputVolume / 100
    if (this.input?.gain) this.input.gain.gain.value = next.inputVolume / 100

    const operation = this.inputQueue.then(async () => {
      if (this.closed) return
      await this.applyOutputDevice(next.outputDeviceId)
      if (previous.bitrateKbps !== next.bitrateKbps) await this.applySenderBitrate(next.bitrateKbps)
      if (!this.peer || !this.inputSender || !needsNewInput(previous, next)) return

      const replacement = await this.createInput(next)
      if (this.closed) {
        this.disposeInput(replacement)
        return
      }
      replacement.track.enabled = !this.selfMute
      try {
        await this.inputSender.replaceTrack(replacement.track)
      } catch (error) {
        this.disposeInput(replacement)
        throw error
      }
      const old = this.input
      this.input = replacement
      this.disposeInput(old)
    })
    this.inputQueue = operation.catch(() => undefined)
    return operation
  }

  acceptOffer(sdp: string) {
    const operation = this.offerQueue.then(async () => {
      const peer = this.peer
      if (!peer || this.closed) return

      await peer.setRemoteDescription({ type: 'offer', sdp })
      const candidates = this.pendingRemoteCandidates.splice(0)
      for (const candidate of candidates) {
        if (remoteDescriptionAcceptsCandidate(peer, candidate)) {
          await peer.addIceCandidate(toBrowserCandidate(candidate))
        }
      }

      const answer = await peer.createAnswer()
      await peer.setLocalDescription(answer)
      if (peer.localDescription?.sdp) this.options.onAnswer(peer.localDescription.sdp)
    })

    this.offerQueue = operation.catch((error: unknown) => {
      if (!this.closed) this.options.onError(error instanceof Error ? error : new Error('Не удалось согласовать WebRTC-соединение'))
    })
    return this.offerQueue
  }

  async addICECandidate(candidate: VoiceICECandidate) {
    const peer = this.peer
    if (!peer || this.closed) return
    if (!remoteDescriptionAcceptsCandidate(peer, candidate)) {
      if (this.pendingRemoteCandidates.length < 64) this.pendingRemoteCandidates.push(candidate)
      return
    }

    try {
      await peer.addIceCandidate(toBrowserCandidate(candidate))
    } catch (error) {
      if (!this.closed) this.options.onError(error instanceof Error ? error : new Error('Не удалось добавить ICE-кандидат'))
    }
  }

  setState(selfMute: boolean, selfDeaf: boolean) {
    this.selfMute = selfMute
    this.selfDeaf = selfDeaf
    if (this.input) this.input.track.enabled = !selfMute
    if (selfMute) this.options.onInputLevel?.(0)
    if (this.audio) {
      this.audio.muted = selfDeaf
      if (!selfDeaf) void this.audio.play().catch(() => {})
    }
  }

  resumeAudio() {
    if (!this.selfDeaf) void this.audio?.play().catch(() => {})
    if (this.input?.context?.state === 'suspended') void this.input.context.resume().catch(() => undefined)
  }

  close() {
    if (this.closed) return
    this.closed = true
    this.pendingRemoteCandidates = []
    this.disposeInput(this.input)
    this.output?.getTracks().forEach((track) => track.stop())
    this.peer?.close()
    if (this.audio) {
      this.audio.pause()
      this.audio.srcObject = null
      this.audio.remove()
    }
    this.input = null
    this.inputSender = null
    this.output = null
    this.peer = null
    this.audio = null
    this.options.onInputLevel?.(0)
    this.options.onConnectionStateChange('closed')
  }
}

export async function enumerateVoiceDevices(requestPermission = false): Promise<MediaDeviceInfo[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return []
  let temporary: MediaStream | null = null
  try {
    if (requestPermission) temporary = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
    return await navigator.mediaDevices.enumerateDevices()
  } finally {
    temporary?.getTracks().forEach((track) => track.stop())
  }
}

export function voiceErrorMessage(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError' || error.name === 'SecurityError') return 'Разрешите Voxhold доступ к микрофону в настройках браузера'
    if (error.name === 'NotFoundError' || error.name === 'OverconstrainedError') return 'Выбранный микрофон не найден. Подключите устройство или выберите другое'
    if (error.name === 'NotReadableError' || error.name === 'AbortError') return 'Микрофон занят другим приложением или недоступен'
  }
  if (error instanceof Error && error.message) return error.message
  return 'Не удалось подключиться к голосовому каналу'
}

export function voiceCloseMessage(reason: string): string {
  if (reason === 'voice session moved to another connection') {
    return 'Голосовое подключение перенесено в другую вкладку или устройство'
  }
  if (reason === 'audio bitrate limit exceeded') {
    return 'Голосовое подключение остановлено: превышен разрешённый сервером битрейт микрофона'
  }

  return reason || 'Сервер завершил голосовое соединение'
}
