import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import type { ChannelRecording } from '../domain/types'
import type { VoxholdApi } from '../services/api'
import type { BrowserVoiceSession } from '../services/voice'
import { CallRecorder, recordingMIME } from '../services/recording'
import { downloadBlob, downloadFile, recordingFilename, RecordingStore, type LocalRecording } from '../services/recordingStore'

const MAX_SERVER_BYTES = 2 ** 31
type Voice = { serverId: number; channelId: number } | null
export function useCallRecordings({ api, token, scope, serverId, voice, voiceMedia, stream, notify, mediaVersion }: {
  api: VoxholdApi; token: string | null; scope: string; serverId: number | null; voice: Voice
  voiceMedia: RefObject<BrowserVoiceSession | null>; stream: MediaStream | null
  notify: (message: string, kind?: 'success' | 'error') => void
  mediaVersion?: string
}) {
  const [records, setRecords] = useState<Record<string, ChannelRecording>>({})
  const [locals, setLocals] = useState<LocalRecording[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<Record<string, number | string>>({})
  const [retry, setRetry] = useState(0)
  const store = useRef<RecordingStore | null>(null)
  const recorder = useRef<CallRecorder | null>(null)
  const retained = useRef(new Map<string, CallRecorder>())
  const volatileLocals = useRef(new Map<string, LocalRecording>())
  const activeRecord = useRef<ChannelRecording | null>(null)
  const credentials = useRef(token); credentials.current = token
  const latestStream = useRef(stream); latestStream.current = stream
  const latestVoice = useRef(voice); latestVoice.current = voice
  const uploadAbort = useRef<AbortController | null>(null)
  const starting = useRef(false)
  const merge = useCallback((record: ChannelRecording) => setRecords((current) => {
    const previous = current[record.id]
    return previous && previous.updated_at > record.updated_at ? current : { ...current, [record.id]: record }
  }), [])
  const refreshLocal = useCallback(async () => {
    if (!store.current) return
    try {
      const saved = new Map((await store.current.list()).map((local) => [local.record.id, local]))
      volatileLocals.current.forEach((local, id) => saved.set(id, local))
      setLocals(Array.from(saved.values()))
    } catch { notify('Не удалось прочитать список локальных записей', 'error') }
  }, [notify])
  const stop = useCallback(async () => {
    const running = recorder.current, record = activeRecord.current
    if (!running || !record) return
    recorder.current = null; activeRecord.current = null; setBusy(true)
    try {
      const local = await running.stop()
      if (local.error) { retained.current.set(record.id, running); volatileLocals.current.set(record.id, local) }
      const currentToken = credentials.current
      if (currentToken) {
        try {
          merge(await api.recordings.stop(currentToken, record.id, local.bytes, local.duration, !!local.error || local.bytes > MAX_SERVER_BYTES))
        } catch (error) {
          // Release the active indicator even when the server quota is full.
          try { merge(await api.recordings.stop(currentToken, record.id, 0, local.duration, true)) } catch { /* Lease clears stale indicators after disconnect. */ }
          notify(error instanceof Error ? error.message : 'Серверная копия недоступна; локальный файл сохранён', 'error')
        }
      }
      await refreshLocal()
      notify('Запись завершена. Файл передан в загрузки браузера.', 'success')
    } finally { setActiveId(null); setBusy(false) }
  }, [api, merge, notify, refreshLocal])
  const stopRef = useRef(stop); stopRef.current = stop
  useEffect(() => {
    let disposed = false
    void RecordingStore.open(scope).then(async (opened) => {
      if (disposed) { opened.close(); return }
      store.current = opened
      const saved = await opened.list()
      // Another tab may still be writing. Never rewrite its unfinished metadata.
      // Failed/expired server leases expose these chunks as a partial download.
      if (!disposed) setLocals(saved)
    }).catch((error: unknown) => notify(error instanceof Error ? error.message : 'Хранилище записей недоступно', 'error'))
    return () => {
      disposed = true; uploadAbort.current?.abort()
      const opened = store.current; store.current = null
      void stopRef.current().finally(() => opened?.close())
    }
  }, [scope, notify])
  useEffect(() => {
    if (!serverId || !token) return
    const controller = new AbortController()
    void api.recordings.list(token, serverId, controller.signal).then(({ recordings }) => recordings.forEach(merge)).catch(() => {})
    return () => controller.abort()
  }, [api, token, serverId, merge, retry])
  useEffect(() => {
    const running = recorder.current
    if (!running) return
    const update = () => running.setSources(voiceMedia.current?.recordingAudioTracks() ?? [], latestStream.current)
    update()
    const unsubscribe = voiceMedia.current?.subscribeRecordingAudio(update)
    stream?.addEventListener('addtrack', update); stream?.addEventListener('removetrack', update)
    return () => { unsubscribe?.(); stream?.removeEventListener('addtrack', update); stream?.removeEventListener('removetrack', update) }
  }, [activeId, voiceMedia, stream, voice?.channelId, mediaVersion])
  useEffect(() => {
    if (!activeId) return
    const current = activeRecord.current
    const currentVoice = latestVoice.current
    if (!currentVoice || current?.channel_id !== currentVoice.channelId || current.server_id !== currentVoice.serverId) { void stopRef.current(); return }
    let failures = 0
    const heartbeat = window.setInterval(() => {
      const value = credentials.current
      if (value) void api.recordings.heartbeat(value, activeId).then(() => { failures = 0 }).catch(() => {
        if (++failures >= 3) { notify('Связь с сервером потеряна. Сохраняем запись локально.', 'error'); void stopRef.current() }
      })
    }, 30_000)
    const maximum = window.setTimeout(() => { void stopRef.current() }, 24 * 60 * 60 * 1000)
    const unload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', unload)
    return () => { clearInterval(heartbeat); clearTimeout(maximum); window.removeEventListener('beforeunload', unload) }
  }, [activeId, api, voice?.serverId, voice?.channelId, notify])
  const start = async () => {
    const currentToken = credentials.current, currentVoice = latestVoice.current
    if (starting.current || recorder.current || !store.current || !currentToken || !currentVoice) return
    const mime = recordingMIME()
    if (!mime) { notify('Запись недоступна в этом браузере', 'error'); return }
    starting.current = true; setBusy(true)
    let record: ChannelRecording | undefined, running: CallRecorder | undefined
    let audio: AudioContext | undefined
    try {
      // Unlock while the button still has user activation, before the HTTP await.
      audio = new AudioContext({ sampleRate: 48_000 })
      void audio.resume().catch(() => undefined)
      record = await api.recordings.start(currentToken, currentVoice.serverId, currentVoice.channelId, mime.split(';')[0]!)
      if (latestVoice.current?.channelId !== currentVoice.channelId || !store.current) throw new Error('Голосовой канал уже закрыт')
      running = new CallRecorder(store.current, record, mime, () => { void refreshLocal() }, (message) => { notify(message, 'error'); void stopRef.current() }, audio)
      running.setSources(voiceMedia.current?.recordingAudioTracks() ?? [], latestStream.current)
      await running.start()
      recorder.current = running; activeRecord.current = record; setActiveId(record.id); merge(record)
    } catch (error) {
      running?.dispose()
      if (!running && audio) void audio.close().catch(() => undefined)
      if (record) try { merge(await api.recordings.stop(currentToken, record.id, 0, 0, true)) } catch { /* TTL lease. */ }
      notify(error instanceof Error ? error.message : 'Не удалось начать запись', 'error')
    } finally { starting.current = false; setBusy(false) }
  }
  // The upload can be paused by joining a call; the next attempt reads the server offset.
  const voiceActive = !!voice
  useEffect(() => {
    if (voiceActive || !token || !store.current) return
    const controller = new AbortController(); uploadAbort.current = controller
    const opened = store.current
    void (async () => {
      for (const local of locals) {
        if (controller.signal.aborted) break
        if (!local.finished || local.error || !local.bytes || local.bytes > MAX_SERVER_BYTES || local.record.expires_at * 1000 <= Date.now()) continue
        if (records[local.record.id]?.status === 'ready') continue
        try {
          setProgress((value) => ({ ...value, [local.record.id]: 0 }))
          const currentToken = credentials.current
          if (!currentToken) return
          const record = await api.recordings.stop(currentToken, local.record.id, local.bytes, local.duration)
          merge(record)
          const blob = await opened.blob(local)
          let { offset } = await api.recordings.offset(currentToken, record.id, controller.signal)
          if (offset < 0 || offset > blob.size) throw new Error('Неверная позиция загрузки')
          while (offset < blob.size) {
            if (controller.signal.aborted) return
            const chunk = blob.slice(offset, offset + (256 << 10))
            const next = await api.recordings.append(currentToken, record.id, offset, chunk, controller.signal)
            if (next.offset !== offset + chunk.size) throw new Error('Позиция загрузки изменилась; повторите загрузку')
            offset = next.offset; setProgress((value) => ({ ...value, [record.id]: Math.round(offset / blob.size * 100) }))
          }
          if (!controller.signal.aborted) merge(await api.recordings.complete(currentToken, record.id))
          setProgress((value) => ({ ...value, [record.id]: 'Сохранено на сервере' }))
        } catch (error) {
          if (controller.signal.aborted) break
          setProgress((value) => ({ ...value, [local.record.id]: error instanceof Error ? error.message : 'Не удалось загрузить копию' }))
        }
      }
    })()
    return () => controller.abort()
    // Server events/progress must not restart the sequential queue mid-chunk.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceActive, scope, token, locals, retry, api, merge])
  const download = async (record: ChannelRecording) => {
    try {
      const saved = locals.find((local) => local.record.id === record.id)
      const held = retained.current.get(record.id)
      if (held) await held.download()
      else if (saved && store.current) downloadBlob(await store.current.blob(saved), record)
      else if (credentials.current) downloadFile(await api.recordings.download(credentials.current, record.id), recordingFilename(record))
    } catch (error) { notify(error instanceof Error ? error.message : 'Не удалось скачать запись', 'error') }
  }
  const removeLocal = async (id: string) => {
    if (recorder.current && activeId === id) return
    uploadAbort.current?.abort()
    try {
      const remote = records[id], value = credentials.current
      if (value && remote && (remote.status === 'uploading' || remote.status === 'recording')) {
        try { merge(await api.recordings.stop(value, id, 0, remote.duration_ms, true)) } catch { /* Cleanup still expires abandoned server files. */ }
      }
      await store.current?.remove(id); retained.current.delete(id); volatileLocals.current.delete(id); await refreshLocal()
    }
    catch { notify('Не удалось удалить локальную копию', 'error') }
  }
  return { records: Object.values(records).filter((record) => record.expires_at * 1000 > Date.now()), locals, activeId, busy, progress, merge, start, stop, download, removeLocal, retry: () => setRetry((value) => value + 1) }
}
