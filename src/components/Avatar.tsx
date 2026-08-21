import { colorFor, initials } from '../lib/format'

export function Avatar({
  name,
  size = 'medium',
  online,
}: {
  name: string
  size?: 'small' | 'medium' | 'large'
  online?: boolean
}) {
  return (
    <span className={`avatar avatar--${size} avatar--${colorFor(name)}`} aria-label={name}>
      <span>{initials(name)}</span>
      {online !== undefined && <i className={`presence ${online ? 'presence--online' : ''}`} aria-label={online ? 'В сети' : 'Не в сети'} />}
    </span>
  )
}
