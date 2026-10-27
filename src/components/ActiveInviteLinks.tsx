import { useCallback, useEffect, useRef, useState } from 'react'
import type { ActiveInviteLink, InviteLinkPage } from '../domain/types'
import { humanError } from '../lib/format'
import { Icon } from './Icon'

export type InviteLinkLoader = (beforeId?: number, signal?: AbortSignal) => Promise<InviteLinkPage>

export function ActiveInviteLinks({ onListLinks, onRevokeLink, onRevoked }: {
  onListLinks: InviteLinkLoader
  onRevokeLink: (id: number) => Promise<void>
  onRevoked: (id: number) => void
}) {
  const [links, setLinks] = useState<ActiveInviteLink[]>([])
  const [loading, setLoading] = useState(true)
  const [hasMore, setHasMore] = useState(false)
  const [error, setError] = useState('')
  const [confirmId, setConfirmId] = useState<number | null>(null)
  const [revoking, setRevoking] = useState<number | null>(null)
  const cursor = useRef<number | null>(null)
  const request = useRef<AbortController | null>(null)
  const alive = useRef(false)
  const revoked = useRef(new Set<number>())

  const load = useCallback(async (append = false) => {
    if (append && cursor.current === null) return
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    setLoading(true); setError('')
    if (!append) setConfirmId(null)
    try {
      const page = await onListLinks(append ? cursor.current ?? undefined : undefined, controller.signal)
      if (!alive.current || controller.signal.aborted) return
      cursor.current = page.pagination.next_before_id
      setHasMore(page.pagination.has_more)
      setLinks((current) => {
        const merged = new Map((append ? current : []).map((link) => [link.id, link]))
        page.invite_links.forEach((link) => { if (!revoked.current.has(link.id)) merged.set(link.id, link) })
        return [...merged.values()].sort((left, right) => right.id - left.id)
      })
    } catch (caught) {
      if (alive.current && !controller.signal.aborted) setError(humanError(caught))
    } finally {
      if (alive.current && request.current === controller) setLoading(false)
    }
  }, [onListLinks])

  useEffect(() => {
    alive.current = true
    void load()
    return () => { alive.current = false; request.current?.abort() }
  }, [load])

  const revoke = async (id: number) => {
    if (revoking !== null) return
    setRevoking(id); setError('')
    try {
      await onRevokeLink(id)
      if (!alive.current) return
      revoked.current.add(id)
      setLinks((current) => current.filter((link) => link.id !== id))
      setConfirmId(null)
      onRevoked(id)
    } catch (caught) {
      if (alive.current) setError(humanError(caught))
    } finally { if (alive.current) setRevoking(null) }
  }

  return <section className="invite-links" aria-label="Активные приглашения">
    <div className="invite-links__heading"><p>Действующие приглашения всех администраторов и владельца.</p><button className="button button--ghost button--small" type="button" disabled={loading || revoking !== null} onClick={() => void load()}>Обновить</button></div>
    {error && <div className="form-error" role="alert">{error}</div>}
    {loading && <p role="status"><span className="spinner"/> Загружаем ссылки…</p>}
    <div className="invite-links__list">{links.map((link) => <article className="invite-links__row" key={link.id} aria-label={`Ссылка №${link.id}`}>
      <header><b>Ссылка №{link.id}</b><span>{link.allow_registration ? 'С регистрацией' : 'Для участников с аккаунтом'}</span></header>
      <dl><div><dt>Создал</dt><dd>{link.creator_username}</dd></div><div><dt>Использований</dt><dd>{link.use_count} / {link.max_uses ?? 'без лимита'}</dd></div><div><dt>Создана</dt><dd><time dateTime={new Date(link.created_at * 1000).toISOString()}>{new Date(link.created_at * 1000).toLocaleString('ru-RU')}</time></dd></div><div><dt>Действует до</dt><dd><time dateTime={new Date(link.expires_at * 1000).toISOString()}>{new Date(link.expires_at * 1000).toLocaleString('ru-RU')}</time></dd></div></dl>
      {confirmId === link.id ? <div className="invite-links__confirm"><p>Закрыть ссылку для новых приглашений? Восстановить её не получится.</p><div><button className="button button--danger-outline button--small" type="button" disabled={revoking !== null} onClick={() => void revoke(link.id)}>{revoking === link.id ? 'Закрываем…' : 'Да, закрыть'}</button><button className="button button--ghost button--small" type="button" disabled={revoking !== null} onClick={() => setConfirmId(null)}>Отмена</button></div></div> : <button className="button button--danger-outline button--small" type="button" disabled={loading || revoking !== null} onClick={() => setConfirmId(link.id)}><Icon name="close" size={13}/>Закрыть ссылку</button>}
    </article>)}</div>
    {!loading && !error && links.length === 0 && <p className="invite-links__empty">Активных ссылок пока нет.</p>}
    {hasMore && <button className="button button--secondary button--small" type="button" disabled={loading || revoking !== null} onClick={() => void load(true)}>Показать ещё</button>}
    <p className="invite-links__note">Полный адрес ссылки доступен при её создании.</p>
  </section>
}
