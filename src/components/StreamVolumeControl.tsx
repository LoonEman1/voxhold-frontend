import { Icon } from './Icon'
import { useRef, type CSSProperties } from 'react'
import { MAX_STREAM_VOLUME } from '../services/streamSettings'

/** The button stays compact; hover, keyboard focus and touch reveal the mixer. */
export function StreamVolumeControl({ volume, muted, onVolumeChange, onToggleMute, publisher = false, compact = false, disabled = false }: {
  volume: number; muted: boolean; onVolumeChange: (value: number) => void; onToggleMute: () => void
  publisher?: boolean; compact?: boolean; disabled?: boolean
}) {
  const silent = muted || volume === 0
  const label = publisher ? 'Исходящая громкость трансляции' : 'Громкость трансляции'
  const action = silent ? 'Включить звук трансляции' : 'Выключить звук трансляции'
  const root = useRef<HTMLDivElement>(null), mixer = useRef<HTMLDivElement>(null)
  const position = () => {
    const anchor = root.current?.getBoundingClientRect(), popup = mixer.current?.getBoundingClientRect()
    if (!root.current || !anchor || !popup) return
    const container = root.current.closest('.floating-window, .stream-mini-player')?.getBoundingClientRect()
    const left = Math.max(8, container ? container.left + 8 : 8), right = Math.min(window.innerWidth - 8, container ? container.right - 8 : window.innerWidth - 8)
    const desired = Math.max(left, Math.min(right - popup.width, anchor.left + anchor.width / 2 - popup.width / 2))
    root.current.style.setProperty('--stream-mixer-left', `${desired - anchor.left}px`)
  }
  const displayed = silent ? 0 : Math.max(0, Math.min(MAX_STREAM_VOLUME, Math.round(volume)))
  return <div ref={root} style={{ '--volume-fill': `${displayed / MAX_STREAM_VOLUME * 100}%` } as CSSProperties} className={`stream-volume-control${compact ? ' is-compact' : ''}${silent ? ' is-muted' : ''}${displayed > 100 ? ' is-boosted' : ''}`} onPointerEnter={position} onFocusCapture={position}>
    <button type="button" className="stream-volume-control__toggle" disabled={disabled} onClick={onToggleMute} aria-pressed={silent} aria-label={action} title={publisher ? `${action} для зрителей` : action}>
      <Icon name={silent ? 'volumeOff' : 'volume'} size={17}/>{!compact && <span>Звук трансляции</span>}
    </button>
    <div ref={mixer} className="stream-volume-control__mixer">
      <div className="stream-volume-control__caption"><span>{publisher ? 'Для зрителей' : 'Громкость'}</span><output aria-live="off">{displayed}%</output></div>
      <input type="range" min="0" max={MAX_STREAM_VOLUME} step="1" value={displayed} disabled={disabled} aria-label={label} aria-valuetext={`${displayed}%${displayed > 100 ? ', усиление' : ''}`} onChange={(event) => onVolumeChange(Number(event.target.value))}/>
      <div className="stream-volume-control__scale" aria-hidden="true"><span>0%</span><span>100%</span><span>200%</span></div>
    </div>
  </div>
}
