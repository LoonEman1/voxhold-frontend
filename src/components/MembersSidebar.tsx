import { useCallback, useEffect, useId, useMemo, useState, type MouseEvent } from 'react'
import type { Channel, ServerMember } from '../domain/types'
import { humanError } from '../lib/format'
import { Icon } from './Icon'
import { MemberList } from './MemberList'

export type ChannelMemberLoader = (channelId: number, signal: AbortSignal) => Promise<{ user_ids: number[] }>

export function MembersSidebar({ channel, members, onlineUserIds, onLoadMembers, onClose, onOpenProfile, onMemberContextMenu }: {
  channel: Channel | null
  members: ServerMember[]
  onlineUserIds: ReadonlySet<number>
  onLoadMembers: ChannelMemberLoader
  onClose: () => void
  onOpenProfile: (member: ServerMember) => void
  onMemberContextMenu: (event: MouseEvent, member: ServerMember) => void
}) {
  const [tab, setTab] = useState<'channel' | 'all'>('channel')
  const [revision, setRevision] = useState(0)
  const [roster, setRoster] = useState<{ key: string; ids: Set<number>; error: string; loading: boolean } | null>(null)
  const key = channel ? `${channel.server_id}:${channel.id}` : ''
  const channelId = channel?.id
  const accessRevision = channel?.access_revision
  const membership = members.map((member) => `${member.user_id}:${member.role}`).join(',')
  const id = useId()
  const refresh = useCallback(() => setRevision((current) => current + 1), [])
  useEffect(() => {
    if (!channelId || tab !== 'channel') return
    const controller = new AbortController()
    setRoster({ key, ids: new Set(), error: '', loading: true })
    onLoadMembers(channelId, controller.signal).then((response) => {
      if (!controller.signal.aborted) setRoster({ key, ids: new Set(response.user_ids), error: '', loading: false })
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setRoster({ key, ids: new Set(), error: humanError(error), loading: false })
    })
    return () => controller.abort()
  }, [key, channelId, accessRevision, membership, onLoadMembers, tab, revision])
  useEffect(() => {
    if (tab !== 'channel') return
    const visible = () => { if (document.visibilityState === 'visible') refresh() }
    window.addEventListener('focus', visible)
    return () => window.removeEventListener('focus', visible)
  }, [tab, refresh])
  const current = roster?.key === key ? roster : null
  const all = tab === 'all' || !channel
  const ready = all || !!current && !current.loading && !current.error
  const displayed = useMemo(() => all ? members : ready ? members.filter((member) => current!.ids.has(member.user_id)) : [], [all, members, ready, current])
  const online = useMemo(() => displayed.filter((member) => onlineUserIds.has(member.user_id)), [displayed, onlineUserIds])
  const offline = useMemo(() => displayed.filter((member) => !onlineUserIds.has(member.user_id)), [displayed, onlineUserIds])
  return <>
    <header><span className="eyebrow">УЧАСТНИКИ{ready ? ` · ${displayed.length}` : ''}</span><button className="icon-button members-close" onClick={onClose} title="Скрыть участников"><Icon name="close"/></button></header>
    <div className="members-sidebar__tabs" role="tablist" aria-label="Список участников" onKeyDown={(event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
      const tabs = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
      const index = tabs.indexOf(document.activeElement as HTMLButtonElement)
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowLeft' ? -1 : 1) + tabs.length) % tabs.length
      event.preventDefault(); tabs[next]?.focus(); tabs[next]?.click()
    }}>
      <button role="tab" id={`${id}-channel`} aria-controls={`${id}-panel`} aria-selected={!all} tabIndex={all ? -1 : 0} disabled={!channel} onClick={() => setTab('channel')}>Участники канала</button>
      <button role="tab" id={`${id}-all`} aria-controls={`${id}-panel`} aria-selected={all} tabIndex={all ? 0 : -1} onClick={() => setTab('all')}>Все участники</button>
    </div>
    {!all && <div className="members-sidebar__scope"><span title={channel!.name}>{channel!.kind === 'voice' ? 'Могут войти в' : 'Могут видеть'} «{channel!.name}»</span><button className="button button--ghost button--small" aria-label="Обновить участников канала" disabled={current?.loading} onClick={refresh}>Обновить</button></div>}
    <div className="members-sidebar__panel" role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-${all ? 'all' : 'channel'}`}>
      {!all && (!current || current.loading) ? <p className="members-sidebar__message" role="status">Загружаем участников…</p> : !all && current?.error ? <div className="members-sidebar__message" role="alert"><p>{current.error}</p><button className="button button--ghost button--small" onClick={refresh}>Повторить</button></div> : <MemberList key={all ? 'all' : key} online={online} offline={offline} onOpenProfile={onOpenProfile} onMemberContextMenu={onMemberContextMenu}/>}
      {ready && displayed.length === 0 && <p className="members-sidebar__message">Участников пока нет.</p>}
    </div>
  </>
}
