import { useEffect, useMemo, useRef, useState } from 'react'
import type { Channel, Message, Server, ServerMember } from '../domain/types'
import type { VoxholdApi } from '../services/api'
import { humanError } from '../lib/format'
import { Modal } from './Modal'
import { Icon } from './Icon'
import { readableMessage } from './MessageQuote'

export function ForwardMessageDialog({ source, servers, members, api, token, onClose, onForward }: {
  source: { serverId: number; message: Message }; servers: Server[]; members: ServerMember[]; api: VoxholdApi; token: string
  onClose: () => void; onForward: (serverId: number, channel: Channel, key: string) => Promise<void>
}) {
  const [serverId, setServerId] = useState(source.serverId), [channels, setChannels] = useState<Channel[]>([])
  const [selected, setSelected] = useState<Channel | null>(null), [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true), [pending, setPending] = useState(false), [error, setError] = useState(''), [revision, setRevision] = useState(0)
  const active = useRef(true), keys = useRef(new Map<string, string>())
  useEffect(() => { active.current = true; return () => { active.current = false } }, [])
  useEffect(() => {
    const controller = new AbortController()
    setChannels([]); setSelected(null); setLoading(true)
    void api.channels.list(token, serverId, controller.signal).then((values) => {
      if (!controller.signal.aborted) { setChannels(values); setLoading(false) }
    }).catch((caught: unknown) => { if (!controller.signal.aborted) { setError(humanError(caught)); setLoading(false) } })
    return () => controller.abort()
  }, [api, token, serverId, revision])
  const visible = useMemo(() => channels.filter((channel) => (channel.kind !== 'news' || channel.can_publish) && channel.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())), [channels, query])
  const submit = async () => {
    if (!selected || pending) return
    const destination = selected, targetServer = serverId, id = `${serverId}:${destination.id}`
    let key = keys.current.get(id)
    if (!key) { key = crypto.randomUUID(); keys.current.set(id, key) }
    setPending(true); setError('')
    try { await onForward(targetServer, destination, key); if (active.current) onClose() }
    catch (caught) { if (active.current) setError(humanError(caught)) }
    finally { if (active.current) setPending(false) }
  }
  return <Modal open title="Переслать сообщение" eyebrow="ПОДЕЛИТЬСЯ С КОМАНДОЙ" size="medium" onClose={onClose}><div className="forward-dialog">
    <div className="forward-dialog__preview"><span><Icon name="forward" size={19}/></span><div><b>{source.message.forward?.author.username ?? source.message.author.username}</b><p>{readableMessage(source.message.content, members, source.message.forward?.mention_names)}</p></div></div>
    <div className="forward-dialog__tools"><label className="forward-dialog__server"><Icon name="people" size={16}/><select value={serverId} disabled={pending} aria-label="Сервер для пересылки" onChange={(event) => { setServerId(Number(event.target.value)); setQuery(''); setError('') }}>{servers.map((server) => <option key={server.id} value={server.id}>{server.name}</option>)}</select></label><label className="forward-dialog__search"><Icon name="search" size={16}/><input value={query} disabled={pending} onChange={(event) => setQuery(event.target.value)} placeholder="Найти канал" aria-label="Найти канал для пересылки"/></label></div>
    <div className="forward-dialog__list" role="group" aria-label="Канал для пересылки">{loading ? <p className="forward-dialog__empty" role="status"><span className="spinner"/>Загружаем каналы…</p> : visible.length ? visible.map((channel) => <button key={channel.id} type="button" disabled={pending} aria-pressed={selected?.id === channel.id} className={selected?.id === channel.id ? 'is-selected' : ''} onClick={() => { setSelected(channel); setError('') }}><span className="forward-dialog__channel-icon"><Icon name={channel.kind === 'news' ? 'news' : channel.kind === 'voice' ? 'volume' : 'hash'} size={21}/></span><span><b>{channel.name}</b><small>{channel.kind === 'news' ? 'Новостной канал' : channel.kind === 'voice' ? 'Чат голосового канала' : 'Текстовый канал'}{channel.access_restricted ? ' · закрытый' : ''}</small></span><i>{selected?.id === channel.id ? <Icon name="check" size={15}/> : channel.access_restricted ? <Icon name="lock" size={14}/> : null}</i></button>) : <p className="forward-dialog__empty">{query ? 'Каналов с таким именем нет' : 'Доступных каналов пока нет'}</p>}</div>
    {error && <div className="forward-dialog__error" role="alert"><span>{error}</span><button type="button" disabled={pending} onClick={() => { setError(''); setRevision((value) => value + 1) }}>Обновить каналы</button></div>}
    <footer><p>В сообщении сохранится автор оригинала.</p><button className="button button--primary" type="button" disabled={!selected || pending} onClick={() => void submit()}>{pending ? <span className="spinner"/> : <Icon name="forward" size={17}/>}<span>{pending ? 'Пересылаем…' : 'Переслать'}</span></button></footer>
  </div></Modal>
}
