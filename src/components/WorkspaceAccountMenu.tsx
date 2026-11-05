import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Avatar } from './Avatar'
import { ContextMenu, type ContextMenuItem, type ContextMenuState } from './ContextMenu'

interface Props {
  userId?: number
  username: string
  online: boolean
  onSettings: () => void
  onLogout: () => void
  voice?: {
    name: string; muted: boolean; deafened: boolean
    onOpen: () => void; onMute: () => void; onDeafen: () => void; onLeave: () => void
  }
}

/** Account and active-call controls stay reachable when the channel pane is absent. */
export function WorkspaceAccountMenu({ userId, username, online, voice, onSettings, onLogout }: Props) {
  const [menu, setMenu] = useState<ContextMenuState | null>(null)
  return <>
    <button type="button" className="personal-rail__item personal-rail__account" aria-label={`Аккаунт: ${username}`} title={`Аккаунт: ${username}`} aria-haspopup="menu" aria-expanded={!!menu} onClick={(event) => {
      const rect = event.currentTarget.getBoundingClientRect()
      const items: ContextMenuItem[] = [
        { key: 'settings', kind: 'action', label: 'Настройки', icon: 'settings', onSelect: onSettings },
      ]
      if (voice) items.push(
        { key: 'voice-divider', kind: 'separator' },
        { key: 'voice', kind: 'action', label: `Канал: ${voice.name}`, icon: 'headphones', onSelect: voice.onOpen },
        { key: 'mute', kind: 'action', label: voice.muted ? 'Включить микрофон' : 'Выключить микрофон', icon: voice.muted ? 'micOff' : 'mic', onSelect: voice.onMute },
        { key: 'deafen', kind: 'action', label: voice.deafened ? 'Включить звук' : 'Выключить звук', icon: voice.deafened ? 'headphonesOff' : 'headphones', onSelect: voice.onDeafen },
        { key: 'leave', kind: 'action', label: 'Отключиться от канала', icon: 'phoneOff', danger: true, onSelect: voice.onLeave },
      )
      items.push({ key: 'divider', kind: 'separator' }, { key: 'logout', kind: 'action', label: 'Выйти', icon: 'logout', danger: true, onSelect: onLogout })
      setMenu({ x: rect.right + 8, y: rect.top, title: username, items })
    }}><Avatar userId={userId} name={username} online={online}/><span className="personal-rail__label" aria-hidden="true">Аккаунт</span>{voice && <span className="personal-rail__voice" aria-label="Подключён к голосовому каналу"/>}</button>
    {menu && createPortal(<ContextMenu menu={menu} onClose={() => setMenu(null)}/>, document.body)}
  </>
}
