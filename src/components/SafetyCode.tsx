import { useEffect, useState } from 'react'
import { humanError } from '../lib/format'
import type { SafetyCodeResult } from '../services/e2ee/safetyCode'

/** Security code of you and this member (FEAT-13): compare it in person or by phone. */
export function SafetyCode({ compute, userId }: { compute: () => Promise<SafetyCodeResult>; userId: number }) {
  const [result, setResult] = useState<SafetyCodeResult | null>(null)
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  useEffect(() => { setResult(null); setError('') }, [userId])
  const show = async () => {
    if (pending) return
    setPending(true); setError('')
    try { setResult(await compute()) } catch (caught) { setError(humanError(caught)) } finally { setPending(false) }
  }
  return (
    <section className="safety-code" aria-label="Код безопасности">
      <div><b>Код безопасности</b><small>Совпадает у вас обоих, если сервер не подменил ключи сквозного шифрования. Сверьте его лично или по телефону.</small></div>
      {result
        ? <><code aria-label="Код безопасности">{result.code}</code><small>Устройств с ключами: у вас {result.myDevices}, у собеседника {result.theirDevices}. Незнакомое устройство — повод не доверять коду</small>{result.keyChanged && <div className="voice-e2ee-warning" role="alert">Ключи собеседника изменились с прошлого раза. Сверьте код заново</div>}</>
        : <button type="button" className="button button--ghost button--small" onClick={() => void show()} disabled={pending}>{pending ? <span className="spinner"/> : 'Показать код'}</button>}
      {error && <div className="form-error" role="alert">{error}</div>}
    </section>
  )
}
