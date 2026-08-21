export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`brand ${compact ? 'brand--compact' : ''}`} aria-label="Voxhold">
      <span className="brand__mark"><i />V</span>
      {!compact && <span className="brand__word">voxhold</span>}
    </div>
  )
}
