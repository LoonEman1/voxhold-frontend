import {
  STREAM_AUDIO_BITRATES,
  STREAM_FRAME_RATES,
  STREAM_RESOLUTIONS,
  STREAM_VIDEO_BITRATES,
  type StreamPreferences,
} from '../services/streamSettings'
import { selectedStreamCodec, supportedStreamCodecs } from '../services/stream'
import { Icon } from './Icon'
import { Modal } from './Modal'

interface StreamSettingsDialogProps {
  open: boolean
  busy: boolean
  preferences: StreamPreferences
  onChange: (value: StreamPreferences) => void
  onClose: () => void
  onStart: () => void
}

export function StreamSettingsDialog({ open, busy, preferences, onChange, onClose, onStart }: StreamSettingsDialogProps) {
  const supportedCodecs = supportedStreamCodecs()
  let automaticCodec = ''
  try {
    automaticCodec = selectedStreamCodec({ ...preferences, codec: 'auto' }).toUpperCase()
  } catch {
    // The start button below will remain unavailable when no codec exists.
  }
  const patch = <K extends keyof StreamPreferences>(key: K, value: StreamPreferences[K]) => {
    onChange({ ...preferences, [key]: value })
  }

  return <Modal open={open} title="Поделиться экраном" eyebrow="ТРАНСЛЯЦИЯ ЭКРАНА" size="medium" onClose={onClose}>
    <div className="stream-settings-grid">
      <label><span>Передача</span><select value={preferences.mode} onChange={(event) => patch('mode', event.target.value as StreamPreferences['mode'])}><option value="server">Через сервер (стабильнее)</option><option value="p2p">Напрямую P2P</option></select></label>
      <label><span>Видеокодек</span><select value={preferences.codec} onChange={(event) => patch('codec', event.target.value as StreamPreferences['codec'])}><option value="auto">Автоматически{automaticCodec ? ` (${automaticCodec})` : ''}</option><option value="vp9" disabled={!supportedCodecs.includes('vp9')}>VP9{!supportedCodecs.includes('vp9') ? ' — недоступен' : ''}</option><option value="h264" disabled={!supportedCodecs.includes('h264')}>H.264{!supportedCodecs.includes('h264') ? ' — недоступен' : ''}</option><option value="av1" disabled={!supportedCodecs.includes('av1')}>AV1{!supportedCodecs.includes('av1') ? ' — недоступен' : ''}</option><option value="vp8" disabled={!supportedCodecs.includes('vp8')}>VP8{!supportedCodecs.includes('vp8') ? ' — недоступен' : ''}</option></select></label>
      <label><span>Разрешение</span><select value={preferences.resolution} onChange={(event) => patch('resolution', event.target.value as StreamPreferences['resolution'])}>{STREAM_RESOLUTIONS.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</select></label>
      <label><span>Кадры</span><select value={preferences.frameRate} onChange={(event) => patch('frameRate', Number(event.target.value) as StreamPreferences['frameRate'])}>{STREAM_FRAME_RATES.map((fps) => <option value={fps} key={fps}>{fps} FPS</option>)}</select></label>
      <label><span>Видео</span><select value={preferences.videoBitrateKbps} onChange={(event) => patch('videoBitrateKbps', Number(event.target.value) as StreamPreferences['videoBitrateKbps'])}>{STREAM_VIDEO_BITRATES.map((rate) => <option value={rate} key={rate}>{rate >= 1000 ? `${rate / 1000} Мбит/с` : `${rate} Кбит/с`}</option>)}</select></label>
      <label><span>Звук трансляции</span><select value={preferences.audioBitrateKbps} disabled={!preferences.includeAudio} onChange={(event) => patch('audioBitrateKbps', Number(event.target.value) as StreamPreferences['audioBitrateKbps'])}>{STREAM_AUDIO_BITRATES.map((rate) => <option value={rate} key={rate}>{rate} Кбит/с</option>)}</select></label>
      <label className="stream-audio-toggle"><input type="checkbox" checked={preferences.includeAudio} onChange={(event) => patch('includeAudio', event.target.checked)}/><span>Передавать системный звук</span></label>
    </div>
    {preferences.mode === 'p2p' && <p className="stream-warning">P2P раскрывает IP участникам и расходует ваш исходящий трафик отдельно на каждого зрителя. Максимум — 8 зрителей.</p>}
    <div className="stream-dialog-actions">
      <button className="button button--ghost" type="button" onClick={onClose}>Отмена</button>
      <button className="button button--primary" type="button" disabled={busy || !automaticCodec || (preferences.codec !== 'auto' && !supportedCodecs.includes(preferences.codec))} onClick={onStart}><Icon name="monitor"/>{busy ? 'Выберите экран…' : 'Начать трансляцию'}</button>
    </div>
  </Modal>
}
