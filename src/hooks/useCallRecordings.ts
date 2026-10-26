import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import type { ChannelRecording } from '../domain/types'
import { humanError } from '../lib/format'
import { ApiError, type VoxholdApi } from '../services/api'
import type { BrowserVoiceSession } from '../services/voice'
import { CallRecorder, recordingMIME } from '../services/recording'
import { createRecordingPreview } from '../services/recordingPreview'
import { downloadBlob, downloadFile, recordingFilename, RecordingStore, type LocalRecording } from '../services/recordingStore'

const MAX_SERVER_BYTES = 2 ** 31
type Voice = { serverId: number; channelId: number } | null
// Busy upload slots (429) and dropped connections pass; quota/state errors do not.
const transientUploadError = (error: unknown) => error instanceof ApiError && (error.status === 0 || error.status === 429 || error.status === 502 || error.status === 503 || error.status === 504)
const pause = (ms: number, signal: AbortSignal) => new Promise<void>((resolve) => {
  const timer = window.setTimeout(resolve, ms)
  signal.addEventListener('abort', () => { window.clearTimeout(timer); resolve() }, { once: true })
})
function startError(error: unknown) {
  if (error instanceof ApiError && error.status === 404) return 'Подключитесь к голосовому каналу, чтобы начать запись'
  if (error instanceof ApiError && error.status === 409) return 'В этом канале уже идёт запись'
  return humanError(error)
}
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
  const latestRecords = useRef(records); latestRecords.current = records
  const latestLocals = useRef(locals); latestLocals.current = locals
  const previewTasks = useRef(new Map<string, Promise<Blob | null>>())
  const deleted = useRef(new Set<string>())
  const uploadAbort = useRef<AbortController | null>(null)
  const starting = useRef(false)
  const merge = useCallback((record: ChannelRecording) => {
    if (record.status === 'deleted') {
      deleted.current.add(record.id)
      uploadAbort.current?.abort()
      void store.current?.updateMetadata(record.id, { record }).catch(() => undefined)
      setLocals((current) => current.map((local) => local.record.id === record.id ? { ...local, record } : local))
      setRetry((value) => value + 1)
    } else if (deleted.current.has(record.id)) return
    setRecords((current) => {
      const previous = current[record.id]
      return previous && previous.updated_at > record.updated_at ? current : { ...current, [record.id]: record }
    })
  }, [])
  const ensurePreview = useCallback((local: LocalRecording, opened: RecordingStore): Promise<Blob | null> => {
    if (local.preview) return Promise.resolve(local.preview)
    const key = `${opened.scope}:${local.record.id}:${local.chunks}`
    let task = previewTasks.current.get(key)
    if (!task) {
      task = (async () => {
        const preview = await createRecordingPreview(await opened.previewSource(local), Math.min(local.duration, 4000))
        if (preview) await opened.updateMetadata(local.record.id, { preview }).catch(() => undefined)
        return preview
      })().catch(() => null)
      previewTasks.current.set(key, task)
      if (previewTasks.current.size > 128) previewTasks.current.delete(previewTasks.current.keys().next().value!)
    }
    return task
  }, [])
  const loadPreview = useCallback(async (record: ChannelRecording, signal: AbortSignal) => {
    const saved = latestLocals.current.find((local) => local.record.id === record.id)
    if (saved?.preview) return saved.preview
    if (saved?.finished && saved.bytes && store.current) {
      const preview = await ensurePreview(saved, store.current)
      if (preview) return preview
    }
    if (!signal.aborted && credentials.current && record.preview_version) return api.recordings.preview(credentials.current, record.id, record.preview_version, signal)
    return null
  }, [api, ensurePreview])
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
      const empty = !local.bytes && !local.error
      const currentToken = credentials.current
      if (currentToken) {
        try {
          merge(await api.recordings.stop(currentToken, record.id, local.bytes, local.duration, empty || !!local.error || local.bytes > MAX_SERVER_BYTES))
        } catch (error) {
          // Release the active indicator even when the server quota is full.
          try { merge(await api.recordings.stop(currentToken, record.id, 0, local.duration, true)) } catch { /* Lease clears stale indicators after disconnect. */ }
          if (!empty) notify(humanError(error), 'error')
        }
      }
      await refreshLocal()
      if (empty) notify('Запись остановлена до появления данных — файл не создан', 'error')
      else notify('Запись завершена. Файл передан в загрузки браузера.', 'success')
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
      // CallRecorder.start persists metadata before resuming audio; drop that empty entry.
      if (running && record) await store.current?.remove(record.id).catch(() => undefined)
      if (record) try { merge(await api.recordings.stop(currentToken, record.id, 0, 0, true)) } catch { /* TTL lease. */ }
      notify(startError(error), 'error')
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
        if (local.record.status === 'deleted' || deleted.current.has(local.record.id) || latestRecords.current[local.record.id]?.status === 'deleted') continue
        // The local status survives reloads and covers servers whose list is not loaded.
        const ready = latestRecords.current[local.record.id]?.status === 'ready' ? latestRecords.current[local.record.id] : local.record.status === 'ready' ? local.record : undefined
        if (latestRecords.current[local.record.id]?.status === 'ready' && latestRecords.current[local.record.id]?.preview_version) continue
        try {
          if (ready) {
            const current = await api.recordings.get(token, ready.id, controller.signal)
            if (current.preview_version) { merge(current); await opened.updateMetadata(ready.id, { record: current }); continue }
            const preview = await ensurePreview(local, opened)
            if (controller.signal.aborted) return
            if (preview) {
              const updated = await api.recordings.uploadPreview(token, ready.id, preview, controller.signal)
              merge(updated); await opened.updateMetadata(ready.id, { record: updated })
            }
            continue
          }
          setProgress((value) => ({ ...value, [local.record.id]: 0 }))
          const currentToken = credentials.current
          if (!currentToken) return
          const record = await api.recordings.stop(currentToken, local.record.id, local.bytes, local.duration)
          merge(record)
          const blob = await opened.blob(local)
          let { offset } = await api.recordings.offset(currentToken, record.id, controller.signal)
          if (offset < 0 || offset > blob.size) throw new Error('Неверная позиция загрузки')
          let failures = 0
          while (offset < blob.size) {
            if (controller.signal.aborted) return
            const chunk = blob.slice(offset, offset + (256 << 10))
            try {
              const next = await api.recordings.append(currentToken, record.id, offset, chunk, controller.signal)
              if (next.offset !== offset + chunk.size) throw new Error('Позиция загрузки изменилась; повторите загрузку')
              offset = next.offset; failures = 0
              setProgress((value) => ({ ...value, [record.id]: Math.round(offset / blob.size * 100) }))
            } catch (error) {
              if (controller.signal.aborted || !transientUploadError(error) || ++failures > 5) throw error
              await pause(1000 * 2 ** failures, controller.signal)
              // A dropped response may still have been written: resume from the server's offset.
              offset = (await api.recordings.offset(currentToken, record.id, controller.signal)).offset
            }
          }
          if (controller.signal.aborted) return
          const completed = await api.recordings.complete(currentToken, record.id)
          merge(completed)
          await opened.updateMetadata(record.id, { record: completed }).catch(() => undefined)
          setProgress((value) => ({ ...value, [record.id]: 'Сохранено на сервере' }))
          // A thumbnail failure must never turn a successful video upload into a failure.
          try {
            const preview = await ensurePreview(local, opened)
            if (controller.signal.aborted) return
            if (preview) {
              const updated = await api.recordings.uploadPreview(currentToken, record.id, preview, controller.signal)
              merge(updated); await opened.updateMetadata(record.id, { record: updated })
            }
          } catch { /* Retry independently on the next queue run; keep the video ready. */ }
        } catch (error) {
          if (controller.signal.aborted) break
          if (error instanceof ApiError && error.status === 404) {
            merge({ ...local.record, status: 'deleted', preview_version: undefined, updated_at: Math.max(local.record.updated_at + 1, Date.now()) })
            break
          }
          setProgress((value) => ({ ...value, [local.record.id]: humanError(error) }))
        }
      }
    })()
    return () => controller.abort()
    // Server events/progress are read through refs so they never restart the queue mid-chunk.
  }, [voiceActive, scope, token, locals, retry, api, merge, ensurePreview])
  const download = async (record: ChannelRecording) => {
    try {
      const saved = locals.find((local) => local.record.id === record.id)
      const held = retained.current.get(record.id)
      if (held) await held.download()
      else if (saved && store.current) downloadBlob(await store.current.blob(saved), record)
      else if (credentials.current) downloadFile(await api.recordings.download(credentials.current, record.id), recordingFilename(record))
    } catch (error) { notify(humanError(error), 'error') }
  }
  const removeServer = async (record: ChannelRecording) => {
    if (!credentials.current || record.id === activeId) return
    merge(await api.recordings.remove(credentials.current, record.id))
    notify('Запись и превью удалены с сервера. Локальные копии сохранены.', 'success')
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
      for (const key of previewTasks.current.keys()) if (key.includes(`:${id}:`)) previewTasks.current.delete(key)
    }
    catch { notify('Не удалось удалить локальную копию', 'error') }
  }
  return { records: Object.values(records).filter((record) => record.expires_at * 1000 > Date.now()), locals, activeId, busy, progress, merge, start, stop, download, removeLocal, removeServer, loadPreview, retry: () => { previewTasks.current.clear(); setRetry((value) => value + 1) } }
}
