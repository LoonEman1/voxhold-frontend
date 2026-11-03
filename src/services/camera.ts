export type CameraQuality = 'low' | 'medium' | 'high'
export const CAMERA_PRESETS = {
  low: { label: 'Низкое', width: 640, height: 360, frameRate: 15, bitrate: 400_000 },
  medium: { label: 'Среднее', width: 1280, height: 720, frameRate: 24, bitrate: 1_200_000 },
  high: { label: 'Высокое', width: 1920, height: 1080, frameRate: 30, bitrate: 2_500_000 },
} as const
const storageKey = 'voxhold.camera.quality.v1'
export function loadCameraQuality(): CameraQuality {
  try { const value = localStorage.getItem(storageKey); return value === 'low' || value === 'high' ? value : 'medium' } catch { return 'medium' }
}
export function saveCameraQuality(value: CameraQuality) {
  try { localStorage.setItem(storageKey, value) } catch { /* Capture also works without storage. */ }
}
export function cameraConstraints(quality: CameraQuality): MediaTrackConstraints {
  const preset = CAMERA_PRESETS[quality]
  return { width: { ideal: preset.width, max: preset.width }, height: { ideal: preset.height, max: preset.height }, frameRate: { ideal: preset.frameRate, max: preset.frameRate } }
}
export async function configureCameraSender(sender: RTCRtpSender, quality: CameraQuality) {
  if (!sender.getParameters || !sender.setParameters) return
  const parameters = sender.getParameters()
  if (!parameters.encodings?.length) return
  parameters.encodings[0]!.maxBitrate = CAMERA_PRESETS[quality].bitrate
  parameters.encodings[0]!.maxFramerate = CAMERA_PRESETS[quality].frameRate
  parameters.degradationPreference = 'balanced'
  await sender.setParameters(parameters)
}
export function cameraError(error: unknown) {
  if (error instanceof Error) {
    if (error.name === 'NotAllowedError' || error.name === 'SecurityError') return 'Разрешите доступ к камере в настройках браузера'
    if (error.name === 'NotFoundError') return 'Камера не найдена'
    if (error.name === 'NotReadableError') return 'Камера занята другим приложением или недоступна'
    if (error.name === 'OverconstrainedError') return 'Камера не поддерживает это качество. Выберите другой пресет'
    return error.message
  }
  return 'Не удалось включить камеру'
}

/** Cancels late permission results and releases the physical device on every exit. */
export class CameraCapture {
  stream: MediaStream | null = null
  quality: CameraQuality = loadCameraQuality()
  private generation = 0
  constructor(private changed: (stream: MediaStream | null) => void) {}
  async start(quality: CameraQuality) {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Камера доступна в защищённом соединении HTTPS')
    const generation = ++this.generation
    const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: cameraConstraints(quality) })
    if (generation !== this.generation) { stream.getTracks().forEach((track) => track.stop()); return null }
    const track = stream.getVideoTracks()[0]
    if (!track) { stream.getTracks().forEach((value) => value.stop()); throw new Error('Камера не передаёт видео') }
    this.stream?.getTracks().forEach((value) => value.stop())
    this.stream = stream
    this.quality = quality
    track.contentHint = 'motion'
    track.addEventListener('ended', () => { if (this.stream === stream) this.stop() }, { once: true })
    this.changed(stream)
    return stream
  }
  async setQuality(quality: CameraQuality) {
    const stream = this.stream
    if (!stream) return
    await stream.getVideoTracks()[0]?.applyConstraints(cameraConstraints(quality))
    if (this.stream === stream) this.quality = quality
  }
  stop() {
    this.generation++
    const stream = this.stream
    this.stream = null
    stream?.getTracks().forEach((track) => track.stop())
    if (stream) this.changed(null)
  }
}
