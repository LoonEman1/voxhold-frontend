import { useEffect, useRef, useState } from 'react'
import type { ChannelRecording } from '../domain/types'
import { Icon } from './Icon'

export type PreviewLoader = (record: ChannelRecording, signal: AbortSignal) => Promise<Blob | null>

export function RecordingPreview({ record, load, localReady }: { record: ChannelRecording; load?: PreviewLoader; localReady?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const latest = useRef(record); latest.current = record
  const [url, setURL] = useState<string | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    let image: string | null = null, started = false
    setURL(null)
    const start = async () => {
      if (started || !load) return
      started = true
      try {
        const blob = await load(latest.current, controller.signal)
        if (!blob || controller.signal.aborted) return
        image = URL.createObjectURL(blob); setURL(image)
      } catch { /* An optional preview never prevents downloading the video. */ }
    }
    const element = ref.current
    const observer = globalThis.IntersectionObserver ? new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) { observer?.disconnect(); void start() }
    }, { rootMargin: '100px' }) : undefined
    if (element && observer) observer.observe(element); else void start()
    return () => { controller.abort(); observer?.disconnect(); if (image) URL.revokeObjectURL(image) }
  }, [record.id, record.preview_version, record.status, localReady, load])
  return <div ref={ref} className="recordings-preview">
    {url ? <img src={url} alt="Кадр из записи" decoding="async" onError={() => setURL(null)}/> : <span className="recordings-preview__empty"><Icon name="monitor" size={25}/><small>{record.status === 'recording' ? 'Идёт запись' : 'Без превью'}</small></span>}
  </div>
}
