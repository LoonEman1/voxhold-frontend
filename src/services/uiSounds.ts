/**
 * Short interface cues synthesized with Web Audio: no asset files, instant
 * start and routed to the same output device as the voice channel.
 */
export type UISound =
  | 'self_join'
  | 'self_leave'
  | 'user_join'
  | 'user_leave'
  | 'mute'
  | 'unmute'
  | 'deafen'
  | 'undeafen'

interface Tone {
  frequency: number
  /** Seconds from the start of the cue. */
  at: number
  duration: number
}

interface SoundSpec {
  type: OscillatorType
  gain: number
  tones: Tone[]
}

// Rising pairs mean "on/in", falling pairs "off/out". Other participants are
// quieter and higher than your own connection so they never sound alike.
export const UI_SOUND_SPECS: Record<UISound, SoundSpec> = {
  self_join: { type: 'sine', gain: 0.45, tones: [{ frequency: 587.33, at: 0, duration: 0.12 }, { frequency: 880, at: 0.1, duration: 0.2 }] },
  self_leave: { type: 'sine', gain: 0.45, tones: [{ frequency: 880, at: 0, duration: 0.12 }, { frequency: 587.33, at: 0.1, duration: 0.22 }] },
  user_join: { type: 'triangle', gain: 0.3, tones: [{ frequency: 659.25, at: 0, duration: 0.09 }, { frequency: 987.77, at: 0.08, duration: 0.15 }] },
  user_leave: { type: 'triangle', gain: 0.3, tones: [{ frequency: 783.99, at: 0, duration: 0.09 }, { frequency: 523.25, at: 0.08, duration: 0.17 }] },
  mute: { type: 'sine', gain: 0.35, tones: [{ frequency: 523.25, at: 0, duration: 0.06 }, { frequency: 392, at: 0.05, duration: 0.1 }] },
  unmute: { type: 'sine', gain: 0.35, tones: [{ frequency: 392, at: 0, duration: 0.06 }, { frequency: 523.25, at: 0.05, duration: 0.1 }] },
  deafen: { type: 'sine', gain: 0.35, tones: [{ frequency: 440, at: 0, duration: 0.07 }, { frequency: 293.66, at: 0.06, duration: 0.15 }] },
  undeafen: { type: 'sine', gain: 0.35, tones: [{ frequency: 293.66, at: 0, duration: 0.07 }, { frequency: 440, at: 0.06, duration: 0.15 }] },
}

type SinkAwareContext = AudioContext & { setSinkId?: (sinkId: string) => Promise<void> }

export class UISoundPlayer {
  private context: SinkAwareContext | null = null
  private sinkId = ''

  constructor(private readonly createContext: () => AudioContext = () => new AudioContext()) {}

  play(sound: UISound, volumePercent: number, outputDeviceId = '') {
    if (volumePercent <= 0) return
    try {
      const context = this.context ?? (this.context = this.createContext() as SinkAwareContext)
      if (context.state === 'suspended') void context.resume().catch(() => undefined)
      this.routeTo(context, outputDeviceId)

      const spec = UI_SOUND_SPECS[sound]
      const start = context.currentTime + 0.01
      const master = context.createGain()
      master.gain.value = spec.gain * Math.min(1, volumePercent / 100)
      master.connect(context.destination)
      for (const tone of spec.tones) {
        const oscillator = context.createOscillator()
        const envelope = context.createGain()
        const begin = start + tone.at
        const end = begin + tone.duration
        oscillator.type = spec.type
        oscillator.frequency.value = tone.frequency
        // Short attack and exponential release: no clicks at either edge.
        envelope.gain.setValueAtTime(0.0001, begin)
        envelope.gain.exponentialRampToValueAtTime(1, begin + 0.012)
        envelope.gain.exponentialRampToValueAtTime(0.0001, end)
        oscillator.connect(envelope)
        envelope.connect(master)
        oscillator.start(begin)
        oscillator.stop(end + 0.02)
      }
    } catch {
      // Cues are optional: a browser without Web Audio simply stays silent.
    }
  }

  private routeTo(context: SinkAwareContext, deviceId: string) {
    if (deviceId === this.sinkId || typeof context.setSinkId !== 'function') return
    this.sinkId = deviceId
    context.setSinkId(deviceId).catch(() => { this.sinkId = '' })
  }
}

export const uiSounds = new UISoundPlayer()
