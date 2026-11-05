import { useId, type ReactNode } from 'react'
import { Icon } from './Icon'
import { Modal } from './Modal'
import '../styles/settings.css'

export type SettingsTab = 'profile' | 'voice' | 'privacy'
const tabs = [
  { id: 'profile', label: 'Профиль', icon: 'people' },
  { id: 'voice', label: 'Голос и звук', icon: 'headphones' },
  { id: 'privacy', label: 'Приватность', icon: 'lock' },
] as const

export function SettingsDialog({ open, tab, onTabChange, onClose, busy = false, profile, voice, privacy }: {
  open: boolean; tab: SettingsTab; onTabChange: (tab: SettingsTab) => void; onClose: () => void; busy?: boolean
  profile: ReactNode; voice: ReactNode; privacy: ReactNode
}) {
  const id = useId()
  const select = (next: SettingsTab) => { if (!busy) onTabChange(next) }
  return <Modal open={open} title="Настройки" size="medium" className="settings-dialog" onClose={() => { if (!busy) onClose() }}>
    <div className="settings-tabs" role="tablist" aria-label="Раздел настроек" onKeyDown={(event) => {
      if (busy) return
      const index = tabs.findIndex((item) => item.id === tab)
      const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : -1
      if (next < 0) return
      event.preventDefault(); select(tabs[next]!.id)
      document.getElementById(`${id}-tab-${tabs[next]!.id}`)?.focus()
    }}>{tabs.map((item) => <button type="button" role="tab" key={item.id} id={`${id}-tab-${item.id}`} aria-selected={tab === item.id} aria-controls={`${id}-panel-${item.id}`} tabIndex={tab === item.id ? 0 : -1} disabled={busy} onClick={() => select(item.id)}><Icon name={item.icon} size={16}/>{item.label}</button>)}</div>
    {tabs.map((item) => <section key={item.id} className="settings-panel" id={`${id}-panel-${item.id}`} role="tabpanel" aria-labelledby={`${id}-tab-${item.id}`} hidden={tab !== item.id}>
      {item.id === 'profile' ? profile : item.id === 'voice' ? voice : privacy}
    </section>)}
  </Modal>
}
