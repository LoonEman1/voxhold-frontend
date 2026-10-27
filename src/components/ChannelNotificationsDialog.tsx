import { useEffect, useRef, useState } from 'react'
import type { Channel, NotificationMode, NotificationSettings } from '../domain/types'
import type { VoxholdApi } from '../services/api'
import { humanError } from '../lib/format'
import { Icon } from './Icon'
import { Modal } from './Modal'

const choices: { value: NotificationMode; title: string; description: string; icon: 'message' | 'bell' | 'volumeOff' }[] = [
  { value: 'all', title: 'Все сообщения', description: 'Уведомлять о каждом новом сообщении в канале', icon: 'message' },
  { value: 'mentions', title: 'Только упоминания', description: 'Когда упоминают вас, вашу роль или отвечают на ваше сообщение', icon: 'bell' },
  { value: 'none', title: 'Ничего', description: 'Без уведомлений и звука из этого канала', icon: 'volumeOff' },
]
const permission = () => typeof Notification !== 'undefined' ? Notification.permission : 'unsupported'
export function ChannelNotificationsDialog({ open, channel, api, token, onClose, onSaved, liveSettings, onPreviewSound }: {
  open: boolean; channel: Channel; api: VoxholdApi; token: string; onClose: () => void; onSaved: (value: NotificationSettings) => void; liveSettings?: NotificationSettings | null; onPreviewSound: () => void
}) {
  const [mode, setMode] = useState<NotificationMode | null>(null), [saved, setSaved] = useState<NotificationMode | null>(null)
  const [error, setError] = useState(''), [pending, setPending] = useState(false), [revision, setRevision] = useState(0)
  const [desktop, setDesktop] = useState(permission)
  const active = useRef(open)
  useEffect(() => { active.current = open; return () => { active.current = false } }, [open])
  const generation = useRef(0)
  useEffect(() => {
    if (!open) return
    const controller = new AbortController(), request = ++generation.current
    setMode(null); setSaved(null); setError(''); setDesktop(permission())
    api.channels.notifications(token, channel.server_id, channel.id, controller.signal).then((value) => {
      if (!controller.signal.aborted && generation.current === request) { setMode(value.mode); setSaved(value.mode) }
    }).catch((caught: unknown) => { if (!controller.signal.aborted && generation.current === request) setError(humanError(caught)) })
    return () => controller.abort()
  }, [api, token, channel.server_id, channel.id, open, revision])
  useEffect(() => {
    if (open && liveSettings?.channel_id === channel.id && liveSettings.server_id === channel.server_id) {
      generation.current++; setMode(liveSettings.mode); setSaved(liveSettings.mode); setError('')
    }
  }, [liveSettings, open, channel.id, channel.server_id])
  const save = async () => {
    if (!mode || pending) return
    setPending(true); setError('')
    try { const value = await api.channels.setNotifications(token, channel.server_id, channel.id, mode); if (active.current) { setSaved(value.mode); onSaved(value); onClose() } }
    catch (caught) { setError(humanError(caught)) } finally { setPending(false) }
  }
  return <Modal open={open} onClose={onClose} title="Уведомления" eyebrow={`# ${channel.name}`} size="medium"><div className="channel-notifications">
    <p className="channel-notifications__intro">Выберите, что заслуживает вашего внимания. Настройка сохраняется на аккаунте для этого канала. Уведомления приходят, пока Voxhold открыт.</p>
    {mode ? <fieldset disabled={pending} className="channel-notifications__choices"><legend className="sr-only">Какие уведомления получать</legend>{choices.map((choice) => <label key={choice.value} className={mode === choice.value ? 'is-selected' : ''}><span className="channel-notifications__icon"><Icon name={choice.icon} size={21}/></span><span><b>{choice.title}{choice.value === 'mentions' && <small>По умолчанию</small>}</b><em>{choice.description}</em></span><input type="radio" name="channel-notifications" value={choice.value} checked={mode === choice.value} onChange={() => { setMode(choice.value); setError('') }}/></label>)}</fieldset> : error ? <button className="button button--ghost" onClick={() => setRevision((value) => value + 1)}>Повторить загрузку</button> : <p role="status">Загружаем настройки…</p>}
    <div className="channel-notifications__desktop"><div><b>Системные уведомления</b><p>{desktop === 'granted' ? 'Разрешены в этом браузере. Показываем, когда окно не активно.' : desktop === 'denied' ? 'Заблокированы браузером. Разрешение можно изменить в настройках сайта.' : desktop === 'unsupported' ? 'Этот браузер не поддерживает системные уведомления.' : 'Показывать уведомления, когда Voxhold открыт в фоновой вкладке.'}</p></div>{desktop === 'default' && <button className="button button--secondary button--small" onClick={() => void Notification.requestPermission().then(setDesktop).catch(() => setError('Не удалось запросить разрешение браузера'))}>Разрешить</button>}</div>
    <footer><button className="button button--ghost" onClick={onPreviewSound}><Icon name="volume" size={16}/>Послушать звук</button><button className="button button--primary" disabled={!mode || mode === saved || pending} onClick={() => void save()}>{pending ? <span className="spinner"/> : 'Сохранить'}</button></footer>
    {error && <div className="form-error" role="alert">{error}</div>}
  </div></Modal>
}
