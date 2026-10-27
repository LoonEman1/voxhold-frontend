import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { CreatedInviteLink, Server } from '../domain/types'
import { humanError } from '../lib/format'
import { createWebInviteURL } from '../lib/inviteLinks'
import { ActiveInviteLinks, type InviteLinkLoader } from './ActiveInviteLinks'
import { Modal } from './Modal'

export function InviteUserDialog({ open, onClose, server, onCreateLink, onListLinks, onRevokeLink }: {
  open: boolean
  onClose: () => void
  server: Server | null
  onCreateLink(input: { expires_in_seconds: number; max_uses: number | null; allow_registration: boolean }): Promise<CreatedInviteLink>
  onListLinks: InviteLinkLoader
  onRevokeLink: (id: number) => Promise<void>
}) {
  const [tab, setTab] = useState<'create' | 'active'>('create')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const [lifetime, setLifetime] = useState(24 * 60 * 60)
  const [maxUses, setMaxUses] = useState(25)
  const [generated, setGenerated] = useState<{ id: number; url: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const generation = useRef(0)
  const canManage = server?.role === 'owner' || server?.role === 'admin'
  useEffect(() => {
    const current = ++generation.current
    if (open) { setTab('create'); setError(''); setPending(false); setGenerated(null); setCopied(false); setLifetime(24 * 60 * 60); setMaxUses(25) }
    return () => { generation.current = current + 1 }
  }, [open, server?.id, canManage])
  const createLink = async (event: FormEvent) => {
    event.preventDefault()
    if (pending || !canManage) return
    const current = generation.current
    setPending(true); setError('')
    try {
      const link = await onCreateLink({ expires_in_seconds: lifetime, max_uses: maxUses, allow_registration: true })
      if (current === generation.current) setGenerated({ id: link.id, url: createWebInviteURL(link.token, `${window.location.origin}${window.location.pathname}`) })
    } catch (caught) { if (current === generation.current) setError(humanError(caught)) }
    finally { if (current === generation.current) setPending(false) }
  }
  const copyLink = async () => {
    if (!generated) return
    const current = generation.current
    try { await navigator.clipboard.writeText(generated.url); if (current === generation.current) { setCopied(true); setError('') } }
    catch { if (current === generation.current) setError('Не удалось скопировать ссылку. Выделите её и скопируйте вручную.') }
  }
  return <Modal open={open} onClose={onClose} title={`Пригласить в ${server?.name ?? 'сервер'}`} eyebrow="ПРИГЛАШЕНИЯ" size="medium">
    {!canManage ? <p>Управлять приглашениями могут администраторы и владелец сервера.</p> : <>
      <div className="voice-channel-chat__tabs invite-dialog__tabs" role="group" aria-label="Разделы приглашений"><button type="button" aria-pressed={tab === 'create'} onClick={() => setTab('create')}>Новая ссылка</button><button type="button" aria-pressed={tab === 'active'} onClick={() => setTab('active')}>Активные ссылки</button></div>
      {tab === 'active' && open && server ? <ActiveInviteLinks key={server.id} onListLinks={onListLinks} onRevokeLink={onRevokeLink} onRevoked={(id) => { setGenerated((current) => current?.id === id ? null : current); setCopied(false) }}/> : generated ? <div className="dialog-form invite-link-result">
        <p><b>Ссылка №{generated.id}.</b> Отправьте ссылку новому участнику: он сможет создать аккаунт и сразу присоединиться к этому инстансу.</p>
        <label><span>Ссылка-приглашение</span><input readOnly value={generated.url} onFocus={(event) => event.currentTarget.select()}/></label>
        {error && <div className="form-error" role="alert">{error}</div>}
        <div className="dialog-actions"><button className="button button--ghost" type="button" onClick={() => { setGenerated(null); setCopied(false) }}>Создать ещё</button><button className="button button--primary" type="button" onClick={() => void copyLink()}>{copied ? 'Скопировано' : 'Копировать'}</button></div>
      </div> : <form className="dialog-form" onSubmit={createLink}>
        <p>Новые участники регистрируются по ссылке. Пользователи с аккаунтом уже состоят в этом инстансе.</p>
        <label><span>Срок действия</span><select value={lifetime} onChange={(event) => setLifetime(Number(event.target.value))}><option value={60 * 60}>1 час</option><option value={6 * 60 * 60}>6 часов</option><option value={24 * 60 * 60}>1 сутки</option></select></label>
        <label><span>Количество использований</span><input type="number" min={1} max={100} value={maxUses} onChange={(event) => setMaxUses(Number(event.target.value))} required/></label>
        {error && <div className="form-error" role="alert">{error}</div>}
        <div className="dialog-actions"><button className="button button--ghost" type="button" onClick={onClose}>Отмена</button><button className="button button--primary" disabled={pending}>{pending ? <span className="spinner"/> : 'Создать ссылку'}</button></div>
      </form>}
    </>}
  </Modal>
}
