// Decode only a small local prefix, one video at a time. Never fetch a remote
// recording just to display its card. Failure leaves the recording untouched.
let queue: Promise<unknown> = Promise.resolve()
export function createRecordingPreview(blob: Blob, durationMS: number): Promise<Blob | null> {
  const task = queue.then(() => capture(blob, durationMS))
  queue = task.catch(() => null)
  return task
}

async function capture(blob: Blob, durationMS: number): Promise<Blob | null> {
  if (!blob.size) return null
  const video = document.createElement('video')
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), 5000)
  const url = URL.createObjectURL(blob)
  const wait = (name: 'loadeddata' | 'seeked', timeout = 3500) => new Promise<void>((resolve, reject) => {
    const done = (error?: unknown) => {
      clearTimeout(deadline); video.removeEventListener(name, loaded); video.removeEventListener('error', failed); controller.signal.removeEventListener('abort', failed)
      if (error) reject(error); else resolve()
    }
    const loaded = () => done(), failed = () => done(new Error('Preview unavailable'))
    const deadline = window.setTimeout(failed, timeout)
    video.addEventListener(name, loaded, { once: true }); video.addEventListener('error', failed, { once: true }); controller.signal.addEventListener('abort', failed, { once: true })
    if (controller.signal.aborted) failed()
  })
  try {
    video.muted = true; video.playsInline = true; video.preload = 'auto'
    const loaded = wait('loadeddata')
    video.src = url
    await loaded
    // A frame shortly after the start avoids the encoder's empty first frame.
    if (durationMS > 400) {
      const sought = wait('seeked', 1000)
      video.currentTime = Math.min(1, durationMS / 2000)
      await sought.catch(() => undefined)
    }
    if (controller.signal.aborted || video.readyState < 2 || !video.videoWidth) return null
    const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 180
    const context = canvas.getContext('2d', { alpha: false })
    if (!context) return null
    context.fillStyle = '#171715'; context.fillRect(0,0,320,180)
    const scale = Math.min(320 / video.videoWidth, 180 / video.videoHeight)
    const width = video.videoWidth * scale, height = video.videoHeight * scale
    context.drawImage(video, (320-width)/2, (180-height)/2, width, height)
    return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', .75))
  } catch { return null }
  finally {
    clearTimeout(timer); controller.abort(); video.pause(); video.removeAttribute('src'); video.load(); URL.revokeObjectURL(url)
  }
}
