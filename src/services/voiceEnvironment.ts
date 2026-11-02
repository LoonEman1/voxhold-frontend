/** Lightweight browser checks and messages; the WebRTC session loads on join. */
export function voiceSupported() {
  return typeof RTCPeerConnection !== 'undefined' && !!navigator.mediaDevices?.getUserMedia
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
  if (reason === 'voice e2ee device was revoked') return 'Ключ этого устройства отозван. Подключитесь заново, чтобы создать новый ключ и сверить код безопасности'
  if (reason === 'voice permission was revoked') return 'Доступ к голосовым каналам отозван или действует тайм-аут участника'
  if (reason === 'initial WebRTC answer timed out') return 'Не удалось согласовать подключение вовремя. Попробуйте подключиться снова.'
  if (reason === 'initial WebRTC connection timed out') return 'Соединение не установлено вовремя. Проверьте сеть и подключитесь снова.'
  if (reason === 'channel access was revoked') return 'Доступ к голосовому каналу был отозван'
  if (reason === 'voice channel encryption changed') return 'В канале изменили режим сквозного шифрования — подключитесь снова'
  if (reason === 'voice session moved to another connection') {
    return 'Голосовое подключение перенесено в другую вкладку или устройство'
  }
  if (reason === 'audio bitrate limit exceeded') {
    return 'Голосовое подключение остановлено: превышен разрешённый сервером битрейт микрофона'
  }

  return reason || 'Сервер завершил голосовое соединение'
}
