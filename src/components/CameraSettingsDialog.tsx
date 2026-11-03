import { useState } from 'react'
import '../styles/camera.css'
import { CAMERA_PRESETS, cameraError, saveCameraQuality, type CameraQuality } from '../services/camera'
import { Modal } from './Modal'
import { Icon } from './Icon'

export function CameraSettingsDialog({ quality, active, onApply, onClose, onCancel }: { quality: CameraQuality; active: boolean; onApply: (value: CameraQuality) => Promise<void>; onClose: () => void; onCancel?: () => void }) {
  const [selected, setSelected] = useState(quality)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const cancel = () => { onCancel?.(); onClose() }
  return <Modal open title={active ? 'Качество камеры' : 'Включить камеру'} onClose={cancel}>
    <p>Видео появится вместо вашей карточки участника. Имя останется под видео.</p>
    <div className="camera-presets" role="group" aria-label="Качество камеры">{(Object.entries(CAMERA_PRESETS) as [CameraQuality, typeof CAMERA_PRESETS[CameraQuality]][]).map(([id, preset]) => <button key={id} type="button" aria-pressed={selected === id} disabled={busy} onClick={() => setSelected(id)}><b>{preset.label}</b><small>{preset.height}p · {preset.frameRate} FPS</small></button>)}</div>
    {error && <p className="voice-error" role="alert">{error}</p>}
    <div className="stream-dialog-actions"><button className="button button--ghost" onClick={cancel}>Отмена</button><button className="button button--primary" disabled={busy} aria-busy={busy} onClick={() => { setBusy(true); setError(''); void onApply(selected).then(() => { saveCameraQuality(selected); onClose() }).catch((caught: unknown) => setError(cameraError(caught))).finally(() => setBusy(false)) }}><Icon name="camera"/>{busy ? 'Подключаем…' : active ? 'Применить' : 'Включить камеру'}</button></div>
  </Modal>
}
