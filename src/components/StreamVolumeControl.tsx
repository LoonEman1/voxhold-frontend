import { Icon } from './Icon'

/** The button stays compact; hover, keyboard focus and touch reveal the mixer. */
export function StreamVolumeControl({ volume, muted, onVolumeChange, onToggleMute, publisher = false, compact = false, disabled = false }: {
  volume: number; muted: boolean; onVolumeChange: (value: number) => void; onToggleMute: () => void
  publisher?: boolean; compact?: boolean; disabled?: boolean
}) {
  const silent = muted || volume === 0
  const label = publisher ? 'Исходящая громкость трансляции' : 'Громкость трансляции'
  const action = silent ? 'Включить звук трансляции' : 'Выключить звук трансляции'
  return <div className={`stream-volume-control${compact ? ' is-compact' : ''}${silent ? ' is-muted' : ''}`}>
    <button type="button" className="stream-volume-control__toggle" disabled={disabled} onClick={onToggleMute} aria-pressed={silent} aria-label={action} title={publisher ? `${action} для зрителей` : action}>
      <Icon name={silent ? 'volumeOff' : 'volume'} size={17}/>{!compact && <span>Звук трансляции</span>}
    </button>
    <div className="stream-volume-control__mixer">
      <input type="range" min="0" max="100" step="1" value={silent ? 0 : volume} disabled={disabled} aria-label={label} onChange={(event) => onVolumeChange(Number(event.target.value))}/>
      <output aria-live="off">{silent ? 0 : volume}%</output>
    </div>
  </div>
}
