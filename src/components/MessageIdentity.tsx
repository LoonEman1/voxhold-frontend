import type { ReactNode } from 'react'
import type { ServerRole } from '../domain/types'
import { formatTime } from '../lib/format'
import { roleMeta } from '../lib/roles'
import { Avatar } from './Avatar'

export function MessageAvatar({ userId, name, onOpen }: { userId: number; name: string; onOpen?: () => void }) {
  const avatar = <Avatar userId={userId} name={name}/>
  return onOpen ? <button className="message__avatar-button" onClick={onOpen} aria-label={`Открыть профиль ${name}`}>{avatar}</button> : avatar
}
export function MessageHeader({ name, createdAt, mine, role, badges, onOpen }: { name: string; createdAt: number; mine: boolean; role?: ServerRole; badges?: ReactNode; onOpen?: () => void }) {
  return <header>{onOpen ? <button className={`message__author ${role ? `message__author--${role}` : ''}`} onClick={onOpen}>{name}</button> : <b>{name}</b>}{role && <span className={`role-badge role-badge--${role}`}>{roleMeta[role].shortLabel}</span>}{badges}{mine && <span className="you-tag">вы</span>}<time dateTime={new Date(createdAt * 1000).toISOString()}>{formatTime(createdAt)}</time></header>
}
