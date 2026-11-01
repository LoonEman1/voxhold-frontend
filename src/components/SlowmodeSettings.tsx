import { useEffect, useState } from 'react'
import { humanError } from '../lib/format'

export interface SlowmodeActions { load(): Promise<number>; save(seconds: number): Promise<void> }

export const slowmodeOptions: [number, string][] = [
  [0, 'Выключен'], [5, '5 секунд'], [10, '10 секунд'], [30, '30 секунд'], [60, '1 минута'],
  [300, '5 минут'], [900, '15 минут'], [3600, '1 час'], [21600, '6 часов'],
]

export function SlowmodeSettings({ actions, channelId }: { actions: SlowmodeActions; channelId: number }) {
  const [seconds, setSeconds] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  useEffect(() => {
    let cancelled = false
    setSeconds(null); setError('')
    actions.load().then((value) => { if (!cancelled) setSeconds(value) }).catch((caught) => { if (!cancelled) setError(humanError(caught)) })
    return () => { cancelled = true }
  }, [actions, channelId])
  const change = async (value: number) => {
    if (pending) return
    setPending(true); setError('')
    try { await actions.save(value); setSeconds(value) } catch (caught) { setError(humanError(caught)) } finally { setPending(false) }
  }
  const options = seconds !== null && !slowmodeOptions.some(([value]) => value === seconds) ? [...slowmodeOptions, [seconds, `${seconds} с`] as [number, string]] : slowmodeOptions
  return (
    <section className="dialog-form settings-section" aria-label="Медленный режим">
      <div><h3>Медленный режим</h3><p>Участники смогут отправлять сообщения не чаще, чем раз в выбранный интервал. Владелец и администраторы не ограничены.</p></div>
      <label><span>Интервал</span>
        <select value={seconds ?? 0} disabled={seconds === null || pending} onChange={(event) => void change(Number(event.target.value))}>
          {options.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      {error && <div className="form-error" role="alert">{error}</div>}
    </section>
  )
}
