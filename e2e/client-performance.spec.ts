import { expect, test, type Page } from '@playwright/test'

async function visibleAnchor(page: Page) {
  return page.locator('.messages').evaluate((root) => {
    const top = root.getBoundingClientRect().top
    const first = Array.from(root.querySelectorAll<HTMLElement>('[data-message-id]')).find((row) => row.getBoundingClientRect().bottom > top + 2)
    return { id: first?.dataset.messageId, offset: (first?.getBoundingClientRect().top ?? 0) - top }
  })
}

test('long history keeps a bounded DOM, preserves prepend position, follows new messages and jumps to search results', async ({ page }) => {
  await page.goto('/e2e/fixtures/performance.html')
  await expect(page.locator('[data-message-id="6000"]')).toBeVisible()
  expect(await page.locator('[data-message-id]').count()).toBeLessThan(80)
  await page.locator('.messages').evaluate((root) => { root.scrollTop -= 1500 })
  await page.waitForTimeout(200)
  const before = await visibleAnchor(page)
  await page.locator('#prepend').click()
  await expect.poll(async () => (await visibleAnchor(page)).id).toBe(before.id)
  await page.waitForTimeout(200)
  expect(Math.abs((await visibleAnchor(page)).offset - before.offset)).toBeLessThan(5)
  await page.locator('#append').click()
  expect((await visibleAnchor(page)).id).toBe(before.id)
  await page.locator('.messages').evaluate((root) => { root.scrollTop = root.scrollHeight })
  await expect(page.locator('[data-message-id="6001"]')).toBeVisible()
  await page.locator('#append').click()
  await expect(page.locator('[data-message-id="6002"]')).toBeVisible()
  await page.locator('#focus').click()
  await expect(page.locator('[data-message-id="2500"]')).toBeVisible()
  await page.getByLabel('Сообщение в performance').fill('Typing stays responsive')
  expect(await page.locator('[data-message-id]').count()).toBeLessThan(80)
})

test('microphone processing uses AudioWorklet and preserves its track while toggling mute', async ({ page }) => {
  await page.goto('/e2e/fixtures/performance.html')
  const result = await page.evaluate(async () => {
    const { BrowserVoiceInput } = await import('/src/services/voiceInput.ts')
    const { DEFAULT_VOICE_PREFERENCES } = await import('/src/services/voiceSettings.ts')
    const levels: number[] = []
    const input = new BrowserVoiceInput({ onLevel: (level: number) => levels.push(level) })
    try {
      await input.start({ ...DEFAULT_VOICE_PREFERENCES, noiseSuppressionMode: 'threshold' })
      const track = input.currentTrack()
      for (let index = 0; index < 20; index += 1) input.setState(index % 2 === 0)
      await new Promise((resolve) => setTimeout(resolve, 650))
      const events = JSON.parse(sessionStorage.getItem('voxhold.diagnostics.pending.v1') ?? '[]') as Array<{ name: string; details: { processing_path?: string } }>
      return { sameTrack: track === input.currentTrack(), healthy: input.isHealthy, levels: levels.length, path: events.find((event) => event.name === 'voice_input_ready')?.details.processing_path }
    } finally { input.close() }
  })
  expect(result).toMatchObject({ sameTrack: true, healthy: true, path: 'audio_worklet' })
  expect(result.levels).toBeGreaterThan(1)
})

test('the video worker produces playable frames and releases the generated track', async ({ page }) => {
  await page.goto('/e2e/fixtures/performance.html')
  const result = await page.evaluate(async () => {
    const { createSDRPublishPipeline } = await import('/src/services/hdrPipeline.ts')
    const canvas = document.createElement('canvas')
    canvas.width = 320; canvas.height = 180
    const drawing = canvas.getContext('2d')!
    let frame = 0
    const timer = setInterval(() => { drawing.fillStyle = `hsl(${frame++ % 360} 80% 50%)`; drawing.fillRect(0, 0, 320, 180) }, 33)
    const capture = canvas.captureStream(30)
    const pipeline = await createSDRPublishPipeline(capture, 'h264')
    const video = document.createElement('video')
    video.muted = true; video.srcObject = pipeline.stream; document.body.append(video)
    try {
      await video.play()
      await new Promise((resolve) => setTimeout(resolve, 700))
      const events = JSON.parse(sessionStorage.getItem('voxhold.diagnostics.pending.v1') ?? '[]') as Array<{ name: string; details: { path?: string } }>
      const frames = video.getVideoPlaybackQuality().totalVideoFrames
      const path = events.find((event) => event.name === 'stream_processing_path')?.details.path
      pipeline.close()
      return { frames, path, stopped: pipeline.stream.getVideoTracks()[0]?.readyState === 'ended' }
    } finally {
      pipeline.close(); clearInterval(timer); capture.getTracks().forEach((track) => track.stop()); video.srcObject = null; video.remove()
    }
  })
  expect(result.path).toBe('worker_conversion')
  expect(result.frames).toBeGreaterThan(3)
  expect(result.stopped).toBe(true)
})

test('recording downloads a compact mixed file, preserves live tracks and keeps a persistent retry copy', async ({ page }) => {
  await page.goto('/e2e/fixtures/performance.html')
  const download = page.waitForEvent('download')
  const result = await page.evaluate(async () => {
    const { CallRecorder, recordingMIME } = await import('/src/services/recording.ts')
    const { RecordingStore } = await import('/src/services/recordingStore.ts')
    const mime = recordingMIME()!
    const canvas = document.createElement('canvas'); canvas.width = 1920; canvas.height = 1080
    const drawing = canvas.getContext('2d')!
    let frame = 0
    const timer = setInterval(() => { drawing.fillStyle = `hsl(${frame++ * 4 % 360} 80% 50%)`; drawing.fillRect(0, 0, 1920, 1080) }, 33)
    const capture = canvas.captureStream(30)
    const audio = new AudioContext()
    const own = audio.createMediaStreamDestination(), remote = audio.createMediaStreamDestination()
    const oscillator = audio.createOscillator(), other = audio.createOscillator()
    oscillator.frequency.value = 440; other.frequency.value = 880
    oscillator.connect(own); other.connect(remote); oscillator.start(); other.start(); await audio.resume()
    const scope = `browser-test-${Date.now()}`
    const store = await RecordingStore.open(scope)
    const record = { id: 'b'.repeat(32), server_id: 1, channel_id: 1, owner_user_id: 1, owner_username: 'Recorder', status: 'recording', mime_type: mime.split(';')[0], size_bytes: 0, duration_ms: 0, created_at: Math.floor(Date.now() / 1000), updated_at: Date.now(), expires_at: Math.floor(Date.now() / 1000) + 86400 }
    const warnings: string[] = []
    const recorder = new CallRecorder(store, record, mime, () => {}, (message: string) => warnings.push(message))
    recorder.setSources([own.stream.getAudioTracks()[0]!, remote.stream.getAudioTracks()[0]!], capture)
    await recorder.start()
    await new Promise((resolve) => setTimeout(resolve, 1200))
    own.stream.getAudioTracks()[0]!.enabled = false
    recorder.setSources([own.stream.getAudioTracks()[0]!, remote.stream.getAudioTracks()[0]!], capture)
    await new Promise((resolve) => setTimeout(resolve, 1200))
    own.stream.getAudioTracks()[0]!.enabled = true
    // A changing screen source must preserve the recorder's stable output track.
    recorder.setSources([own.stream.getAudioTracks()[0]!, remote.stream.getAudioTracks()[0]!], null)
    recorder.setSources([own.stream.getAudioTracks()[0]!, remote.stream.getAudioTracks()[0]!], capture)
    await new Promise((resolve) => setTimeout(resolve, 1000))
    const local = await recorder.stop()
    store.close()
    const reopened = await RecordingStore.open(scope)
    const [saved] = await reopened.list()
    const blob = await reopened.blob(saved!)
    const decoded = await audio.decodeAudioData(await blob.arrayBuffer())
    const amplitudes = (start: number) => [440, 880].map((frequency) => {
      const values = decoded.getChannelData(0), first = Math.round(start * decoded.sampleRate), count = Math.round(decoded.sampleRate * .15)
      let real = 0, imaginary = 0
      for (let index = 0; index < count; index++) { const phase = 2 * Math.PI * frequency * index / decoded.sampleRate; real += values[first + index]! * Math.cos(phase); imaginary += values[first + index]! * Math.sin(phase) }
      return Math.hypot(real, imaginary) / count
    })
    const beforeMute = amplitudes(.5), duringMute = amplitudes(1.8)
    const url = URL.createObjectURL(blob), video = document.createElement('video')
    video.muted = true; video.src = url; document.body.append(video)
    await new Promise<void>((resolve, reject) => { video.onloadedmetadata = () => resolve(); video.onerror = () => reject(new Error('Recorded file cannot be decoded')) })
    await video.play(); await new Promise((resolve) => setTimeout(resolve, 300))
    const result = { beforeMute, duringMute, warnings, bytes: blob.size, chunks: saved!.chunks, finished: saved!.finished, sameSize: local.bytes === blob.size, width: video.videoWidth, height: video.videoHeight, frames: video.getVideoPlaybackQuality().totalVideoFrames, live: [...capture.getTracks(), ...own.stream.getTracks(), ...remote.stream.getTracks()].every((track) => track.readyState === 'live') }
    video.pause(); video.remove(); URL.revokeObjectURL(url)
    await reopened.remove(record.id); reopened.close()
    clearInterval(timer); capture.getTracks().forEach((track) => track.stop()); oscillator.stop(); other.stop(); await audio.close()
    return result
  })
  expect((await download).suggestedFilename()).toMatch(/^voxhold-.*\.webm$/)
  expect(result).toMatchObject({ warnings: [], finished: true, sameSize: true, width: 1280, height: 720, live: true })
  expect(result.beforeMute[0]).toBeGreaterThan(.005)
  expect(result.beforeMute[1]).toBeGreaterThan(.005)
  expect(result.duringMute[0]).toBeLessThan(result.beforeMute[0]! * .2)
  expect(result.duringMute[1]).toBeGreaterThan(.005)
  expect(result.bytes).toBeGreaterThan(10_000)
  expect(result.bytes).toBeLessThan(2_000_000)
  expect(result.chunks).toBeGreaterThan(1)
  expect(result.frames).toBeGreaterThan(1)
})

test('call controls stop and download, defer the server copy during a call, then allow repeat downloads', async ({ page }) => {
  const pageErrors: string[] = []; page.on('pageerror', (error) => pageErrors.push(error.message))
  await page.goto('/e2e/fixtures/calls.html')
  await page.getByRole('button', { name: 'Чат канала', exact: true }).click()
  await expect(page.getByText('Всё слышно. Давайте запишем встречу.')).toBeVisible()
  await page.getByRole('button', { name: 'Начать запись', exact: true }).click()
  await expect(page.getByText('Записывает Александр')).toBeVisible()
  const secondTab = await page.context().newPage()
  await secondTab.goto('/e2e/fixtures/calls.html')
  expect(await secondTab.evaluate(async () => { const { RecordingStore } = await import('/src/services/recordingStore.ts'); const store = await RecordingStore.open('calls-fixture'); try { return (await store.list()).every((local) => !local.finished) } finally { store.close() } })).toBe(true)
  await secondTab.close()
  await page.getByRole('button', { name: 'Выключить микрофон', exact: true }).click()
  await page.waitForTimeout(2300)
  await page.screenshot({ path: test.info().outputPath('voice-stage.png') })
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Остановить запись и скачать', exact: true }).click()
  expect((await download).suggestedFilename()).toMatch(/\.webm$/)
  await expect(page.getByText('Записывает Александр')).toHaveCount(0)
  await expect(page.locator('#ready')).toHaveText('0')
  await page.getByRole('button', { name: 'Скачать записи', exact: true }).click()
  await expect(page.getByText('Загрузка копий на сервер продолжится после выхода из звонка.')).toBeVisible()
  const retry = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Скачать', exact: true }).click()
  expect((await retry).suggestedFilename()).toMatch(/\.webm$/)
  await page.getByRole('button', { name: 'Закрыть', exact: true }).first().click()
  await page.getByRole('button', { name: 'Отключиться от звонка', exact: true }).click()
  await expect(page.locator('#ready')).toHaveText('1')
  await page.getByRole('button', { name: 'Записи', exact: true }).click()
  await expect(page.getByText(/На сервере до/)).toBeVisible()
  expect(pageErrors).toEqual([])
})

test('storage exhaustion stops recording, downloads the recoverable file and preserves manual retry in this tab', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/e2e/fixtures/calls.html')
  await page.evaluate(async () => {
    const { RecordingStore } = await import('/src/services/recordingStore.ts')
    const save = RecordingStore.prototype.save
    let full = false
    RecordingStore.prototype.save = async function (local, chunk) {
      if (chunk) full = true
      if (full) throw new DOMException('Disk full', 'QuotaExceededError')
      return save.call(this, local, chunk)
    }
  })
  const automatic = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Начать запись', exact: true }).click()
  expect((await automatic).suggestedFilename()).toMatch(/\.webm$/)
  await expect(page.getByText('Записывает Александр')).toHaveCount(0)
  await expect(page.locator('#notifications')).toContainText('Локальное хранилище заполнено')
  await page.getByRole('button', { name: 'Скачать записи', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Скачать', exact: true })).toBeEnabled()
  const repeated = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Скачать', exact: true }).click()
  expect((await repeated).suggestedFilename()).toMatch(/\.webm$/)
  await expect(page.locator('#ready')).toHaveText('0')
  expect(errors).toEqual([])
})

test('blocked recording audio releases the busy control instead of hanging indefinitely', async ({ page }) => {
  await page.goto('/e2e/fixtures/calls.html')
  await page.evaluate(() => { AudioContext.prototype.resume = () => new Promise<void>(() => {}) })
  await page.getByRole('button', { name: 'Начать запись', exact: true }).click()
  await expect(page.locator('#notifications')).toContainText('Браузер блокирует звук записи', { timeout: 10_000 })
  await expect(page.getByRole('button', { name: 'Начать запись', exact: true })).toBeEnabled()
  await expect(page.getByText('Записывает Александр')).toHaveCount(0)
})
