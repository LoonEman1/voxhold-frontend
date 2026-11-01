import { useEffect, useState } from 'react'
import { humanError } from '../lib/format'

/** Security code of you and this member (FEAT-13): compare it in person or by phone. */
export function SafetyCode({ compute, userId }: { compute: () => Promise<string>; userId: number }) {
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  useEffect(() => { setCode(''); setError('') }, [userId])
  const show = async () => {
    if (pending) return
    setPending(true); setError('')
    try { setCode(await compute()) } catch (caught) { setError(humanError(caught)) } finally { setPending(false) }
  }
  return (
    <section className="safety-code" aria-label="Код безопасности">
      <div><b>Код безопасности</b><small>Совпадает у вас обоих, если сервер не подменил ключи сквозного шифрования. Сверьте его лично или по телефону.</small></div>
      {code
        ? <code aria-label="Код безопасности">{code}</code>
        : <button type="button" className="button button--ghost button--small" onClick={() => void show()} disabled={pending}>{pending ? <span className="spinner"/> : 'Показать код'}</button>}
      {error && <div className="form-error" role="alert">{error}</div>}
    </section>
  )
}
