import { useEffect, useState } from 'react'
import { humanError } from '../lib/format'
import { E2EE_RECORDING_NOTICE, E2EE_VOICE_NOTICE } from '../services/e2ee/notices'

export interface E2EEPolicyActions { load(): Promise<boolean>; save(required: boolean): Promise<boolean> }

/** Owner/admin switch: the voice channel admits only end-to-end encrypting clients. */
export function E2EESettings({ actions, channelId }: { actions: E2EEPolicyActions; channelId: number }) {
  const [required, setRequired] = useState<boolean | null>(null)
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  useEffect(() => {
    let cancelled = false
    setRequired(null); setError('')
    actions.load().then((value) => { if (!cancelled) setRequired(value) }).catch((caught) => { if (!cancelled) setError(humanError(caught)) })
    return () => { cancelled = true }
  }, [actions, channelId])
  const change = async (value: boolean) => {
    if (pending) return
    setPending(true); setError('')
    try { setRequired(await actions.save(value)) } catch (caught) { setError(humanError(caught)) } finally { setPending(false) }
  }
  return (
    <section className="dialog-form settings-section" aria-label="Сквозное шифрование">
      <div>
        <h3>Сквозное шифрование голоса</h3>
        <p>{E2EE_VOICE_NOTICE}. Подключиться смогут только браузеры с поддержкой шифрования. Видео трансляций не шифруется; {E2EE_RECORDING_NOTICE.toLowerCase()}. При изменении все участники канала переподключатся.</p>
      </div>
      <label className="settings-toggle">
        <input type="checkbox" checked={required ?? false} disabled={required === null || pending} onChange={(event) => void change(event.target.checked)}/>
        <span>Требовать сквозное шифрование</span>
      </label>
      {error && <div className="form-error" role="alert">{error}</div>}
    </section>
  )
}
