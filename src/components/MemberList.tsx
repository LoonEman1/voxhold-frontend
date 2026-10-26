import { memo, useCallback, useMemo, useRef, type MouseEvent } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { ServerMember } from '../domain/types'
import { relativeTime } from '../lib/format'
import { roleMeta } from '../lib/roles'
import { Avatar } from './Avatar'

interface Props {
  online: ServerMember[]
  offline: ServerMember[]
  onOpenProfile: (member: ServerMember) => void
  onMemberContextMenu: (event: MouseEvent, member: ServerMember) => void
}
type Row = { key: string; title: string } | { key: string; member: ServerMember; online: boolean }

/** Both groups share the same scroll viewport; large servers mount only it. */
export const MemberList = memo(function MemberList({ online, offline, onOpenProfile, onMemberContextMenu }: Props) {
  const root = useRef<HTMLDivElement>(null)
  const rows = useMemo<Row[]>(() => [
    ...(online.length ? [{ key: 'online', title: `В сети — ${online.length}` }, ...online.map((member) => ({ key: `member-${member.user_id}`, member, online: true }))] : []),
    ...(offline.length ? [{ key: 'offline', title: `Не в сети — ${offline.length}` }, ...offline.map((member) => ({ key: `member-${member.user_id}`, member, online: false }))] : []),
  ], [online, offline])
  const getKey = useCallback((index: number) => rows[index]!.key, [rows])
  const virtual = rows.length > 100
  const virtualizer = useVirtualizer({ count: rows.length, getScrollElement: () => root.current, getItemKey: getKey, estimateSize: (index) => 'title' in rows[index]! ? 32 : 58, overscan: 6, enabled: virtual, useAnimationFrameWithResizeObserver: true, initialRect: { width: 260, height: 700 } })
  const renderRow = (row: Row) => 'title' in row ? <div className="member-group"><h3>{row.title}</h3></div> : <button className={`member-row member-row--${row.member.role}`} onClick={() => onOpenProfile(row.member)} onContextMenu={(event) => onMemberContextMenu(event, row.member)}><Avatar userId={row.member.user_id} name={row.member.username} size="small" online={row.online}/><span><b className={`member-name member-name--${row.member.role}`}>{row.member.username}</b><small><span className={`role-dot role-dot--${row.member.role}`}/>{roleMeta[row.member.role].label}{!row.online && ` · ${relativeTime(row.member.last_seen_at)}`}</small></span>{row.member.country_code && <em>{row.member.country_code}</em>}</button>
  const items = virtualizer.getVirtualItems()
  return <div className="members-sidebar__scroll" ref={root} data-virtualized={virtual}>
    {virtual ? <><div aria-hidden="true" style={{ height: items[0]?.start ?? 0 }}/>{items.map((item) => <div key={item.key} ref={virtualizer.measureElement} data-index={item.index}>{renderRow(rows[item.index]!)}</div>)}<div aria-hidden="true" style={{ height: Math.max(0, virtualizer.getTotalSize() - (items.at(-1)?.end ?? 0)) }}/></> : rows.map((row) => <div key={row.key}>{renderRow(row)}</div>)}
  </div>
})
