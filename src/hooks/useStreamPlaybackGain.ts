import { useEffect, useRef, useState } from 'react'
import { StreamAudioGain } from '../services/streamAudioGain'

/** A viewer only pays for Web Audio after requesting amplification above 100%. */
export function useStreamPlaybackGain(media: MediaStream | null, volume: number, publisher: boolean) {
  const mixer = useRef<StreamAudioGain | null>(null), source = useRef<MediaStream | null>(null)
  const tracks = useRef<MediaStreamTrack[]>([]), [revision, setRevision] = useState(0)
  const [processed, setProcessed] = useState<{ input: MediaStream; stream: MediaStream } | null>(null)
  const [blocked, setBlocked] = useState(false), [error, setError] = useState('')
  useEffect(() => {
    if (!media || typeof media.addEventListener !== 'function') return
    const changed = () => setRevision((value) => value + 1)
    const events = ['addtrack', 'removetrack', 'voxhold:tracks-changed']
    events.forEach((name) => media.addEventListener(name, changed))
    return () => events.forEach((name) => media.removeEventListener(name, changed))
  }, [media])
  const resume = () => {
    const current = mixer.current
    if (!current) return
    setBlocked(current.suspended)
    void current.resume().then(() => { if (mixer.current === current) setBlocked(false) }).catch(() => { if (mixer.current === current) setBlocked(true) })
  }
  useEffect(() => {
    const audio = media && typeof media.getAudioTracks === 'function' ? media.getAudioTracks() : []
    if (source.current !== media || publisher || audio.length !== tracks.current.length || audio.some((track, index) => track !== tracks.current[index])) {
      mixer.current?.close(); mixer.current = null; source.current = media
      tracks.current = audio
      setProcessed(null); setBlocked(false); setError('')
    }
    if (publisher || !media || typeof media.getAudioTracks !== 'function') return
    if (!mixer.current && volume > 100 && media.getAudioTracks().length) {
      try {
        const current = new StreamAudioGain(media, volume)
        mixer.current = current; setProcessed({ input: media, stream: current.stream }); setBlocked(current.suspended)
        void current.resume().then(() => { if (mixer.current === current) setBlocked(false) }).catch(() => { if (mixer.current === current) setBlocked(true) })
      } catch { setError('Не удалось усилить звук. Сохранили обычную громкость.'); return }
    }
    mixer.current?.setVolume(volume)
  }, [media, volume, publisher, revision])
  useEffect(() => () => { mixer.current?.close(); mixer.current = null }, [])
  const amplified = !!processed && processed.input === media && !publisher
  return { media: amplified ? processed.stream : media, elementVolume: publisher ? 0 : amplified ? 1 : Math.max(0, Math.min(100, Number.isFinite(volume) ? volume : 100)) / 100, blocked: !publisher && blocked, error: publisher ? '' : error, resume }
}
