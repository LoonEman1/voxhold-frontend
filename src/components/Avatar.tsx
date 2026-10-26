import { colorFor, initials } from '../lib/format'
import { useAvatar } from './AvatarProvider'

export function Avatar({
  name,
  size = 'medium',
  online,
  userId,
}: {
  name: string
  size?: 'small' | 'medium' | 'large'
  online?: boolean
  userId?: number
}) {
  const { ref, url } = useAvatar(userId)
  return (
    <span ref={ref} className={`avatar avatar--${size} avatar--${colorFor(name)}`} aria-label={name}>
      {url ? <img src={url} alt="" decoding="async"/> : <span>{initials(name)}</span>}
      {online !== undefined && <i className={`presence ${online ? 'presence--online' : ''}`} aria-label={online ? 'В сети' : 'Не в сети'} />}
    </span>
  )
}
