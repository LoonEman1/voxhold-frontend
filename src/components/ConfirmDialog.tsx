import { useEffect, useState } from 'react'
import { humanError } from '../lib/format'
import { Modal } from './Modal'
import { Icon } from './Icon'

export function ConfirmDialog({ open, onClose, title, description, confirmLabel, onConfirm }: { open: boolean; onClose: () => void } & {
  title: string
  description: string
  confirmLabel: string
  onConfirm(): Promise<void>
}) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { if (open) { setPending(false); setError('') } }, [open])
  const confirm = async () => {
    if (pending) return
    setPending(true); setError('')
    try { await onConfirm(); onClose() } catch (caught) { setError(humanError(caught)); setPending(false) }
  }
  return (
    <Modal open={open} onClose={pending ? () => undefined : onClose} title={title} eyebrow="ПОДТВЕРЖДЕНИЕ">
      <div className="logout-confirm">
        <span><Icon name="trash" size={26}/></span>
        <p>{description}</p>
        {error && <div className="form-error" role="alert">{error}</div>}
        <div><button className="button button--ghost" type="button" onClick={onClose} disabled={pending}>Отмена</button><button className="button button--danger" type="button" onClick={() => void confirm()} disabled={pending}>{pending ? <span className="spinner"/> : confirmLabel}</button></div>
      </div>
    </Modal>
  )
}

