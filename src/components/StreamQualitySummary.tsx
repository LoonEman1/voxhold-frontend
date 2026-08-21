import type { StreamQualityStats } from '../services/stream'

interface StreamQualitySummaryProps {
  stats: StreamQualityStats | null | undefined
}

const limitationLabels: Partial<Record<StreamQualityStats['qualityLimitationReason'], string>> = {
  bandwidth: 'сеть ограничивает качество',
  cpu: 'процессор ограничивает качество',
  other: 'браузер ограничивает качество',
}

export function StreamQualitySummary({ stats }: StreamQualitySummaryProps) {
  if (!stats) return null

  const values = [
    stats.width > 0 && stats.height > 0 ? `${stats.width}×${stats.height}` : '',
    stats.framesPerSecond > 0 ? `${stats.framesPerSecond} FPS` : '',
    stats.bitrateKbps > 0
      ? stats.bitrateKbps >= 1000
        ? `${(stats.bitrateKbps / 1000).toFixed(1)} Мбит/с`
        : `${stats.bitrateKbps} Кбит/с`
      : '',
    stats.codec,
  ].filter(Boolean)
  const limitation = limitationLabels[stats.qualityLimitationReason]

  if (!values.length && !limitation && stats.packetsLost === 0) return null

  return <div className={`stream-quality ${limitation ? 'is-limited' : ''}`}>
    <span>{values.join(' · ')}</span>
    {limitation && <em>{limitation}</em>}
    {stats.packetsLost > 0 && <em>потеряно пакетов: {stats.packetsLost}</em>}
  </div>
}
