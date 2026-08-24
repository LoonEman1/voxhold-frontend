import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { BrowserVoiceSession, inputConstraints, voiceErrorMessage } from '../services/voice'
import {
  DEFAULT_VOICE_PREFERENCES,
  VOICE_BITRATES,
  shortcutFromKeyboardEvent,
  shortcutLabel,
  type VoicePreferences,
} from '../services/voiceSettings'
import { Icon } from './Icon'
import { Modal } from './Modal'

type ShortcutField = 'muteShortcut' | 'deafenShortcut' | 'pushToTalkShortcut'

interface VoiceSettingsDialogProps {
  open: boolean
  preferences: VoicePreferences
  devices: MediaDeviceInfo[]
  inputLevel: number
  voiceActive: boolean
  loadingDevices: boolean
  onClose: () => void
  onChange: (preferences: VoicePreferences) => void
  onRefreshDevices: (requestPermission: boolean) => Promise<void>
}

export function VoiceSettingsDialog({ open, preferences, devices, inputLevel, voiceActive, loadingDevices, onClose, onChange, onRefreshDevices }: VoiceSettingsDialogProps) {
  const [recording, setRecording] = useState<ShortcutField | null>(null)
  const [previewLevel, setPreviewLevel] = useState(0)
  const [previewError, setPreviewError] = useState('')
  const previewGainRef = useRef<GainNode | null>(null)
  const inputs = useMemo(() => devices.filter((device) => device.kind === 'audioinput'), [devices])
  const outputs = useMemo(() => devices.filter((device) => device.kind === 'audiooutput'), [devices])
  const duplicateShortcuts = new Set([
    preferences.muteShortcut,
    preferences.deafenShortcut,
    preferences.pushToTalkShortcut,
  ]).size < 3

  useEffect(() => {
    if (previewGainRef.current) previewGainRef.current.gain.value = preferences.inputVolume / 100
  }, [preferences.inputVolume])

  useEffect(() => {
    if (!open || voiceActive || !navigator.mediaDevices?.getUserMedia || typeof AudioContext === 'undefined') {
      setPreviewLevel(0)
      setPreviewError('')
      return
    }

    let stopped = false
    let stream: MediaStream | null = null
    let context: AudioContext | null = null
    let timer: number | null = null
    const start = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: inputConstraints(preferences),
          video: false,
        })
        if (stopped) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }
        context = new AudioContext({ latencyHint: 'interactive' })
        const source = context.createMediaStreamSource(stream)
        const gain = context.createGain()
        const analyser = context.createAnalyser()
        const silent = context.createGain()
        gain.gain.value = preferences.inputVolume / 100
        silent.gain.value = 0
        analyser.fftSize = 256
        analyser.smoothingTimeConstant = .72
        source.connect(gain)
        gain.connect(analyser)
        analyser.connect(silent)
        silent.connect(context.destination)
        previewGainRef.current = gain
        if (context.state === 'suspended') await context.resume()
        const values = new Uint8Array(analyser.fftSize)
        timer = window.setInterval(() => {
          analyser.getByteTimeDomainData(values)
          let energy = 0
          for (const value of values) {
            const normalized = (value - 128) / 128
            energy += normalized * normalized
          }
          setPreviewLevel(Math.min(1, Math.sqrt(energy / values.length) * 4.5))
        }, 90)
        setPreviewError('')
        await onRefreshDevices(false)
      } catch (error) {
        if (!stopped) {
          setPreviewLevel(0)
          setPreviewError(voiceErrorMessage(error))
        }
      }
    }
    void start()

    return () => {
      stopped = true
      if (timer !== null) window.clearInterval(timer)
      previewGainRef.current = null
      stream?.getTracks().forEach((track) => track.stop())
      void context?.close().catch(() => undefined)
      setPreviewLevel(0)
    }
  }, [open, voiceActive, preferences.inputDeviceId, preferences.autoGainControl, preferences.echoCancellation, preferences.noiseSuppression, preferences.noiseSuppressionMode, onRefreshDevices])

  const patch = <K extends keyof VoicePreferences>(key: K, value: VoicePreferences[K]) => {
    onChange({ ...preferences, [key]: value })
  }

  const recordShortcut = (field: ShortcutField, event: ReactKeyboardEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    if (event.code === 'Escape') {
      setRecording(null)
      return
    }
    const shortcut = shortcutFromKeyboardEvent(event.nativeEvent)
    if (!shortcut) return
    patch(field, shortcut)
    setRecording(null)
  }

  return (
    <Modal open={open} onClose={onClose} title="Голос и звук" eyebrow="НАСТРОЙКИ" size="medium">
      <div className="voice-settings">
        <section className="voice-settings__section">
          <div className="voice-settings__heading"><span><Icon name="mic"/></span><div><h3>Устройства</h3><p>Выберите, откуда брать голос и куда выводить звук комнаты.</p></div></div>
          <div className="voice-device-grid">
            <label><span>Устройство ввода</span><select value={preferences.inputDeviceId} onChange={(event) => patch('inputDeviceId', event.target.value)}><option value="">Системное по умолчанию</option>{inputs.map((device, index) => <option value={device.deviceId} key={device.deviceId}>{device.label || `Микрофон ${index + 1}`}</option>)}</select></label>
            <label><span>Устройство вывода</span><select value={preferences.outputDeviceId} onChange={(event) => patch('outputDeviceId', event.target.value)} disabled={!BrowserVoiceSession.outputSelectionSupported()}><option value="">Системное по умолчанию</option>{outputs.map((device, index) => <option value={device.deviceId} key={device.deviceId}>{device.label || `Динамики ${index + 1}`}</option>)}</select></label>
          </div>
          <div className="voice-device-help">
            <span>{BrowserVoiceSession.outputSelectionSupported() ? 'Устройства можно менять прямо во время разговора.' : 'Этот браузер не поддерживает выбор устройства вывода — используется системное.'}</span>
            <button className="button button--ghost button--compact" type="button" onClick={() => void onRefreshDevices(true)} disabled={loadingDevices}>{loadingDevices ? <span className="spinner"/> : <Icon name="sparkles" size={14}/>}Обновить</button>
          </div>
        </section>

        <section className="voice-settings__section">
          <div className="voice-settings__heading"><span><Icon name="volume"/></span><div><h3>Уровни звука</h3><p>Усиление микрофона применяется до отправки, громкость — ко всему голосовому каналу.</p></div></div>
          <VoiceRange label="Громкость микрофона" value={preferences.inputVolume} max={200} onChange={(value) => patch('inputVolume', value)}/>
          <MeterWithGate level={voiceActive ? inputLevel : previewLevel} gateEnabled={preferences.noiseSuppressionMode === 'threshold'} threshold={preferences.noiseGateThreshold}/>
          {previewError && <div className="voice-preview-error" role="alert">{previewError}</div>}
          <VoiceRange label="Громкость собеседников" value={preferences.outputVolume} max={100} onChange={(value) => patch('outputVolume', value)}/>
          <div className="voice-bitrate-setting"><span><b>Качество передачи</b><em>{preferences.bitrateKbps} Кбит/с</em></span><div>{VOICE_BITRATES.map((bitrate) => <button className={preferences.bitrateKbps === bitrate ? 'is-active' : ''} type="button" key={bitrate} onClick={() => patch('bitrateKbps', bitrate)}>{bitrate}</button>)}</div><small>Это максимальный битрейт Opus. При нестабильной сети WebRTC может временно снизить его автоматически.</small></div>
        </section>

        <section className="voice-settings__section">
          <div className="voice-settings__heading"><span><Icon name="sparkles"/></span><div><h3>Обработка микрофона</h3><p>Настройки передаются браузеру при захвате выбранного устройства.</p></div></div>
          <div className="voice-toggle-list">
            <div className="voice-noise-setting">
              <span><b>Шумоподавление</b><small>Убирает постоянный шум вентилятора, клавиатуры и комнаты.</small></span>
              <div className="voice-noise-modes" role="radiogroup" aria-label="Режим шумоподавления">
                <button className={preferences.noiseSuppressionMode === 'auto' ? 'is-active' : ''} type="button" onClick={() => patch('noiseSuppressionMode', 'auto')} aria-pressed={preferences.noiseSuppressionMode === 'auto'}>Автоматически</button>
                <button className={preferences.noiseSuppressionMode === 'threshold' ? 'is-active' : ''} type="button" onClick={() => patch('noiseSuppressionMode', 'threshold')} aria-pressed={preferences.noiseSuppressionMode === 'threshold'}>С нижней планкой</button>
              </div>
              {preferences.noiseSuppressionMode === 'threshold' && <VoiceRange label="Планка шума" value={preferences.noiseGateThreshold} max={100} onChange={(value) => patch('noiseGateThreshold', value)}/>}
              {preferences.noiseSuppressionMode === 'threshold' && <small className="voice-noise-hint">Коралловая линия на индикаторе — планка. Всё левее неё передаётся как тишина: помолчите и поднимайте ползунок, пока уровень в тишине не окажется слева от линии.</small>}
            </div>
            <VoiceToggle title="Эхоподавление" description="Не даёт голосу собеседников вернуться в микрофон." checked={preferences.echoCancellation} onChange={(value) => patch('echoCancellation', value)}/>
            <VoiceToggle title="Автоматическое усиление" description="Выравнивает слишком тихий и слишком громкий голос." checked={preferences.autoGainControl} onChange={(value) => patch('autoGainControl', value)}/>
          </div>
        </section>

        <section className="voice-settings__section">
          <div className="voice-settings__heading"><span><Icon name="settings"/></span><div><h3>Режим ввода и горячие клавиши</h3><p>Бинды работают во всём Voxhold, кроме полей ввода сообщений.</p></div></div>
          <div className="voice-input-mode" role="radiogroup" aria-label="Режим ввода">
            <button className={preferences.inputMode === 'voice_activity' ? 'is-active' : ''} type="button" onClick={() => patch('inputMode', 'voice_activity')}><b>Постоянный микрофон</b><small>Голос передаётся, пока микрофон не выключен.</small></button>
            <button className={preferences.inputMode === 'push_to_talk' ? 'is-active' : ''} type="button" onClick={() => patch('inputMode', 'push_to_talk')}><b>Нажми и говори</b><small>Микрофон работает только при удержании бинда.</small></button>
          </div>
          <div className="voice-shortcuts">
            <ShortcutButton label="Микрофон вкл/выкл" field="muteShortcut" value={preferences.muteShortcut} recording={recording} onStart={setRecording} onKeyDown={recordShortcut}/>
            <ShortcutButton label="Звук вкл/выкл" field="deafenShortcut" value={preferences.deafenShortcut} recording={recording} onStart={setRecording} onKeyDown={recordShortcut}/>
            <ShortcutButton label="Нажми и говори" field="pushToTalkShortcut" value={preferences.pushToTalkShortcut} recording={recording} onStart={setRecording} onKeyDown={recordShortcut}/>
          </div>
          {duplicateShortcuts && <div className="voice-shortcut-warning">Назначьте разные сочетания, иначе одно нажатие выполнит несколько действий.</div>}
        </section>

        <footer className="voice-settings__footer"><button className="button button--ghost" type="button" onClick={() => onChange({ ...DEFAULT_VOICE_PREFERENCES })}>Сбросить</button><button className="button button--primary" type="button" onClick={onClose}>Готово</button></footer>
      </div>
    </Modal>
  )
}

function VoiceRange({ label, value, max, onChange }: { label: string; value: number; max: number; onChange: (value: number) => void }) {
  return <label className="voice-range"><span><b>{label}</b><em>{value}%</em></span><input type="range" min="0" max={max} step="1" value={value} onChange={(event) => onChange(Number(event.target.value))}/></label>
}

function MeterWithGate({ level, gateEnabled, threshold }: { level: number; gateEnabled: boolean; threshold: number }) {
  const percent = Math.round(level * 100)
  const gated = gateEnabled && percent < threshold
  return (
    <div
      className={`voice-input-meter ${gateEnabled ? 'has-gate' : ''} ${gated ? 'is-gated' : ''}`}
      aria-label={gateEnabled ? `Уровень микрофона ${percent}%, планка шума ${threshold}%` : `Уровень микрофона ${percent}%`}
    >
      <span style={{ width: `${percent}%` }}/>
      {gateEnabled && <b className="voice-input-meter__gate" style={{ left: `${Math.min(100, threshold)}%` }} title={`Планка шума — ${threshold}%`}/>}
      <i/><i/><i/>
    </div>
  )
}

function VoiceToggle({ title, description, checked, onChange }: { title: string; description: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <label className="voice-setting-toggle"><span><b>{title}</b><small>{description}</small></span><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)}/><i aria-hidden="true"/></label>
}

function ShortcutButton({ label, field, value, recording, onStart, onKeyDown }: { label: string; field: ShortcutField; value: string; recording: ShortcutField | null; onStart: (field: ShortcutField) => void; onKeyDown: (field: ShortcutField, event: ReactKeyboardEvent<HTMLButtonElement>) => void }) {
  const active = recording === field
  return <div className="voice-shortcut-row"><span>{label}</span><button className={active ? 'is-recording' : ''} type="button" onClick={() => onStart(field)} onKeyDown={(event) => onKeyDown(field, event)} aria-pressed={active}>{active ? 'Нажмите сочетание…' : shortcutLabel(value)}</button></div>
}
