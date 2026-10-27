import { useEffect, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { previewMentions } from '../lib/mentions'
import type { MessageNotificationCenter } from '../services/messageNotifications'
import { Avatar } from './Avatar'
import { Icon } from './Icon'

export function MessageNotifications({ center, userId }: { center: MessageNotificationCenter; userId: number }) {
  const items = useSyncExternalStore(center.subscribe, center.snapshot)
  const [host, setHost] = useState<Element>(document.fullscreenElement ?? document.body)
  useEffect(() => { const update = () => setHost(document.fullscreenElement ?? document.body); document.addEventListener('fullscreenchange', update); return () => document.removeEventListener('fullscreenchange', update) }, [])
  return createPortal(<aside className="message-notifications" aria-label="Новые сообщения" aria-live="polite" aria-relevant="additions">{items.map((event) => <article className={`message-notification ${event.mentioned ? 'is-mention' : ''}`} key={event.message.id}>
    <button type="button" className="message-notification__open" onClick={() => center.open(event)}><Avatar userId={event.message.author.user_id} name={event.message.author.username} size="small"/><span><small><Icon name="hash" size={11}/>{event.channel_name}<em>{event.server_name}</em></small><b>{event.message.author.username}{event.mentioned && <i>Вас упомянули</i>}</b><span>{previewMentions(event.message.content, userId).slice(0, 180)}</span></span></button>
    <button type="button" className="icon-button" aria-label="Закрыть уведомление" onClick={() => center.dismiss(event.message.id)}><Icon name="close" size={14}/></button>
  </article>)}</aside>, host)
}
