import '../styles/direct-chat.css'
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { VoxholdApi } from '../services/api'
import type { DirectMessage } from '../domain/community'
import type { Message } from '../domain/types'
import { conversationWindow } from '../services/conversations'
import { useDraft } from '../hooks/useDraft'
import { preferNativeContextMenu } from '../lib/contextMenu'
import { formatDate, formatTime } from '../lib/format'
import { useCommunity } from './Community'
import { PersonalEmpty } from './PersonalEmpty'
import { Icon } from './Icon'
import { ComposerSendButton } from './ComposerActions'
import { MessageLinkPreviews } from './LazyMessageLinks'
import { ComposerTools, PollCard, ScheduledHistory, openForward, saveFavorite } from './LazyCommunityFeatures'
import { MessageReactions } from './MessageReactions'
import { MessageMentions } from './MessageMentions'
import { MessageContextMenu } from './MessageContextMenu'
import { ForwardAttribution } from './MessageQuote'
import { MessageAttachments, useAttachmentUpload } from './MessageAttachments'
import { MessageAvatar, MessageHeader } from './MessageIdentity'

const problem = (error: unknown) => error instanceof Error ? error.message : 'Не удалось выполнить запрос'

export function DirectChat({ api, token, id, saved = false, currentUserId, revision, onRefresh, onLeave, onCreateGroup }: { api: VoxholdApi; token: string; id: number; saved?: boolean; currentUserId: number; revision: number; onRefresh: () => void; onLeave: () => void; onCreateGroup?: () => void }) {
  const community = useCommunity()
  const [scheduled, setScheduled] = useState(false)
  const [menu, setMenu] = useState<{ message: DirectMessage; x: number; y: number } | null>(null), [reactionBusy, setReactionBusy] = useState<Record<string, boolean>>({})
  const [searchInput, setSearchInput] = useState(''), [search, setSearch] = useState(''), [muted, setMuted] = useState(false), [mutePending, setMutePending] = useState(false)
  const sendBusy = useRef(false), notificationBusy = useRef(false), notificationGeneration = useRef(0)
  useEffect(() => { if (saved || notificationBusy.current) return; const c = new AbortController(), request = ++notificationGeneration.current; void api.community.request<{ muted: boolean }>(token, `/conversations/${id}/notifications`, 'GET', undefined, c.signal).then((v) => { if (!c.signal.aborted && request === notificationGeneration.current) setMuted(v.muted) }).catch(() => undefined); return () => c.abort() }, [api,token,id,saved,revision])
  const [loadError, setLoadError] = useState('')
  const deletedIds=useRef(new Set<number>())
  const initialized = useRef(false), olderRequest = useRef<AbortController | null>(null), draftInput = useRef<HTMLTextAreaElement>(null)
  const [olderPending, setOlderPending] = useState(false)
  useEffect(() => {
    if (searchInput.trim() === search) return
    const timer = window.setTimeout(() => { initialized.current = false; setSearch(searchInput.trim()) }, 200)
    return () => window.clearTimeout(timer)
  }, [searchInput, search])
  const [draft, setDraft] = useDraft(`${api.storageScope}:${currentUserId}:conversation:${id}`)
  const [messages, setMessages] = useState<DirectMessage[]>([]), [error, setError] = useState(''), [pending, setPending] = useState(false), [more, setMore] = useState(false), [loading, setLoading] = useState(true)
  const retry = useRef<{ content: string; key: string } | null>(null), generation = useRef(0), visible = useRef<HTMLDivElement>(null)
  const upload = useAttachmentUpload({ id, server_id: 0, name: 'Беседа', kind: 'text', position: 0, created_by: 0, created_at: 0 }, true, undefined, id)
  useEffect(()=>{const removed=(e:Event)=>{const value=(e as CustomEvent<{type:string;data:{conversation_id?:number;message_id?:number}}>).detail;if(value?.type==='conversation.deleted'&&value.data.conversation_id===id&&value.data.message_id){deletedIds.current.add(value.data.message_id);setMessages((v)=>v.filter((m)=>m.id!==value.data.message_id))}};window.addEventListener('voxhold:feature-event',removed);return()=>window.removeEventListener('voxhold:feature-event',removed)},[id])
  const loadedMessages = useRef(messages); loadedMessages.current = messages
  const readCursor = useRef(0), followingBottom = useRef(true), preserveDistance = useRef<number | null>(null), readLatest = useRef<() => void>(() => undefined)
  useLayoutEffect(() => { if(menu)return; const list = visible.current; if (!list) return; if (preserveDistance.current !== null) { list.scrollTop = list.scrollHeight - preserveDistance.current; preserveDistance.current = null } else if (followingBottom.current) list.scrollTop = list.scrollHeight }, [messages,menu])
  const refreshHistory = useRef<() => void>(() => undefined)
  const lastHistoryRevision = useRef(revision)
  useEffect(() => {
    let alive = true, running = false, dirty = false
    olderRequest.current?.abort(); olderRequest.current = null; setOlderPending(false)
    let request: AbortController | null = null
    const refresh = async () => {
      dirty = true
      if (running) return
      running = true
      try {
        do {
          dirty = false
          const controller = new AbortController(); request = controller
          const current = ++generation.current
          const oldest = initialized.current ? loadedMessages.current[0]?.id : undefined
          const snapshotIDs = new Set(loadedMessages.current.map((message) => message.id))
          try {
            const page = await conversationWindow(api, token, id, oldest, search, controller.signal)
            if (!alive || controller.signal.aborted || current !== generation.current) continue
            setMessages((values) => {
              const reconciled = new Map(page.messages.map((message) => [message.id, message]))
              for (const message of values) {
                const fetched = reconciled.get(message.id)
                if (!snapshotIDs.has(message.id) || fetched && (message.revision ?? 0) > (fetched.revision ?? 0)) reconciled.set(message.id, message)
              }
              return [...reconciled.values()].filter((m) => !deletedIds.current.has(m.id)).sort((a,b) => a.id-b.id)
            })
            // A prepend may complete while this catch-up request is in flight.
            // Its exhausted cursor belongs to the now-earlier history window.
            if (oldest === undefined || (loadedMessages.current[0]?.id ?? oldest) >= oldest) setMore(page.has_more)
            initialized.current = true; setLoading(false); setLoadError('')
          } catch (caught) {
            if (alive && !controller.signal.aborted && current === generation.current) { setLoading(false); setLoadError(problem(caught)) }
            break
          }
        } while (alive && dirty)
      } finally { running = false }
    }
    refreshHistory.current = () => { void refresh() }
    void refresh()
    return () => { alive = false; request?.abort(); olderRequest.current?.abort(); refreshHistory.current = () => undefined }
  }, [api, token, id, search])
  // Do not cancel a multi-page catch-up on every incoming event. Finish the
  // current window, then coalesce those events into one more reconciliation.
  useEffect(() => {
    if (lastHistoryRevision.current === revision) return
    lastHistoryRevision.current = revision; refreshHistory.current()
  }, [revision])
  useEffect(() => {
    const latest = messages.at(-1)?.id
    if (!latest || latest <= readCursor.current) return
    const mark = () => { if (!visible.current?.hidden && document.visibilityState === 'visible' && document.hasFocus() && followingBottom.current && latest > readCursor.current) { readCursor.current = latest; void api.community.request(token, `/conversations/${id}/read`, 'PUT', { message_id: latest }).catch(() => { readCursor.current = 0 }) } }
    readLatest.current = mark; mark(); window.addEventListener('focus', mark); document.addEventListener('visibilitychange', mark); return () => { window.removeEventListener('focus', mark); document.removeEventListener('visibilitychange', mark) }
  }, [api, token, id, messages])
  const send = async () => {
    const content = draft.trim(); if ((!content && !upload.hasItems) || sendBusy.current) return
    sendBusy.current = true; setPending(true); setError('')
    try {
      const attachmentIds = await upload.prepare()
      const fingerprint = JSON.stringify([content, attachmentIds])
      const key = retry.current?.content === fingerprint ? retry.current.key : crypto.randomUUID()
      retry.current = { content: fingerprint, key }
      const sent = await api.community.request<DirectMessage>(token, `/conversations/${id}/messages`, 'POST', { content, client_message_id: key, ...(attachmentIds.length ? { attachment_ids: attachmentIds } : {}) })
      setMessages((values) => [...values.filter((m) => m.id !== sent.id), sent].sort((a, b) => a.id - b.id))
      setDraft((v) => v.trim() === content ? '' : v); retry.current = null; upload.commit(attachmentIds); onRefresh()
      requestAnimationFrame(() => { const list = visible.current; if (list) list.scrollTop = list.scrollHeight })
    } catch (caught) { setError(problem(caught)) } finally { upload.release(); sendBusy.current = false; setPending(false) }
  }
  useLayoutEffect(() => { const input = draftInput.current; if (input) { input.style.height = 'auto'; input.style.height = `${Math.min(140, Math.max(37, input.scrollHeight))}px` } }, [draft])
  const loadOlder = async () => {
    if (olderRequest.current || !messages.length) return
    const controller = new AbortController()
    olderRequest.current = controller; setOlderPending(true)
    const list = visible.current
    try {
      const page = await api.community.request<{ messages: DirectMessage[]; has_more: boolean }>(token, `/conversations/${id}/messages?before=${messages[0]!.id}${search ? `&q=${encodeURIComponent(search)}` : ''}`, 'GET', undefined, controller.signal)
      if (controller.signal.aborted) return
      if (list) preserveDistance.current = list.scrollHeight - list.scrollTop
      setMessages((v) => [...new Map([...page.messages, ...v].filter((m)=>!deletedIds.current.has(m.id)).map((m) => [m.id, m])).values()].sort((a, b) => a.id - b.id)); setMore(page.has_more)
    } catch (caught) { if (!controller.signal.aborted) { preserveDistance.current = null; setError(problem(caught)) } }
    finally { if (olderRequest.current === controller) { olderRequest.current = null; setOlderPending(false) } }
  }
  const asMessage = (m: DirectMessage): Message => ({...m, channel_id:0, edited_at:null})
  const react = async (m: DirectMessage, emoji: string) => {
    const key = `${m.id}:${emoji}`; if (reactionBusy[key]) return; setReactionBusy((v) => ({...v,[key]:true}))
    try { const active=m.reactions?.some((r)=>r.emoji===emoji&&r.me); const result=await api.community.request<{reactions: Message['reactions']; revision:number}>(token,`/conversations/${id}/messages/${m.id}/reactions/${encodeURIComponent(emoji)}`,active?'DELETE':'PUT');setMessages((v)=>v.map((value)=>value.id===m.id?{...value,reactions:result.reactions,revision:result.revision,reactions_revision:result.revision}:value));onRefresh() } catch(e){setError(problem(e))} finally{setReactionBusy((v)=>({...v,[key]:false}))}
  }
  const toggleMute = async () => {
    if (notificationBusy.current) return
    notificationBusy.current = true; ++notificationGeneration.current; setMutePending(true); setError('')
    try { const value = await api.community.request<{muted: boolean}>(token, `/conversations/${id}/notifications`, 'PUT', { muted: !muted }); setMuted(value.muted); onRefresh() }
    catch (caught) { setError(problem(caught)) }
    finally { notificationBusy.current = false; setMutePending(false) }
  }
  return <section className="direct-chat" onPaste={upload.onPaste} onDrop={upload.onDrop} onDragOver={upload.onDragOver}>
    <div className="direct-chat__tools" hidden={scheduled} role="toolbar" aria-label={saved ? 'Инструменты избранного' : 'Действия в разговоре'}>{saved ? <label className="direct-chat__search"><Icon name="search" size={18}/><input type="search" aria-label="Поиск в избранном" value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="Найти заметку, ссылку или файл"/></label> : <><button type="button" className="direct-chat__call" aria-label="Позвонить / присоединиться" title="Начать звонок или присоединиться к участникам" onClick={() => window.dispatchEvent(new CustomEvent('voxhold:start-conversation-call', { detail: id }))}><Icon name="phone" size={18}/><span>Позвонить</span></button>{onCreateGroup && <button type="button" onClick={onCreateGroup}><Icon name="userPlus" size={18}/><span>Создать беседу</span></button>}<button type="button" className="direct-chat__notification" aria-label={muted ? 'Включить уведомления' : 'Отключить уведомления'} title={muted ? 'Включить уведомления' : 'Отключить уведомления'} aria-pressed={muted} disabled={mutePending} onClick={() => void toggleMute()}>{mutePending ? <span className="spinner"/> : <Icon name={muted ? 'bellOff' : 'bell'} size={18}/>}<span>{muted ? 'Без звука' : 'Уведомления'}</span></button></>}</div>
    <div className="direct-chat__messages messages" hidden={scheduled} ref={visible} onScroll={() => { const list = visible.current; followingBottom.current = !!list && list.scrollHeight - list.scrollTop - list.clientHeight < 60; readLatest.current() }} aria-live="polite">
      {!messages.length && !error && !loadError && <PersonalEmpty icon={saved ? 'bookmark' : 'message'} title={loading ? 'Загружаем сообщения…' : saved ? search ? 'Ничего не найдено' : 'Сохраните важное' : 'Начните разговор'}>{saved ? search ? 'Попробуйте другую фразу или очистите поиск.' : 'Ваше личное место для заметок, ссылок и файлов. Перешлите сообщение сюда или напишите себе.' : 'Сообщения видны только участникам этого разговора.'}</PersonalEmpty>}
      {more && <button className="button button--ghost" disabled={olderPending} onClick={() => void loadOlder()}>{olderPending ? <><span className="spinner"/>Загружаем историю…</> : 'Раньше'}</button>}
      {messages.map((m, index) => {
        const previous = messages[index - 1], sameDay = !!previous && new Date(previous.created_at * 1000).toDateString() === new Date(m.created_at * 1000).toDateString()
        const grouped = sameDay && previous.author.user_id === m.author.user_id && m.created_at - previous.created_at < 300
        const mine = m.author.user_id === currentUserId
        const openProfile = community?.onOpenProfile ? () => community.onOpenProfile?.(m.author.user_id, m.author.username, community.members.find((member) => member.user_id === m.author.user_id)?.role ?? 'member') : undefined
        return <Fragment key={m.id}>
          {!sameDay && <div className="date-divider"><span>{formatDate(m.created_at)}</span></div>}
          <article onContextMenu={(e)=>{if(preferNativeContextMenu(e))return;e.preventDefault();setMenu({message:m,x:e.clientX,y:e.clientY})}} data-message-id={m.id} className={`message ${mine ? 'message--mine' : ''} ${grouped ? 'message--grouped' : ''}`}>
            {!grouped && <MessageAvatar userId={m.author.user_id} name={m.author.username} onOpen={openProfile}/>}
            <div className="message__body">
              {!grouped && <MessageHeader name={m.author.username} createdAt={m.created_at} mine={mine} onOpen={openProfile}/>}
              {m.forward && <ForwardAttribution message={asMessage(m)}/>}<p><MessageMentions content={m.content} mentions={[]} currentUserId={currentUserId}/></p><MessageLinkPreviews content={m.content}/><MessageAttachments conversationId={id} attachments={m.attachments}/>{m.poll && <PollCard initial={m.poll} api={api} token={token}/>}
              <MessageReactions message={asMessage(m)} currentUserId={currentUserId} onReact={(emoji)=>void react(m,emoji)} loadReactors={(mid,emoji,signal,after)=>api.community.request(token,`/conversations/${id}/messages/${mid}/reactions/${encodeURIComponent(emoji)}?after=${after??0}`,'GET',undefined,signal)}/>
              {saved && <SavedNote key={`${m.id}:${m.note}`} value={m.note??''} onSave={async(note)=>{await api.community.request(token,`/conversations/${id}/messages/${m.id}/note`,'PATCH',{note});setMessages((v)=>v.map((value)=>value.id===m.id?{...value,note}:value));onRefresh()}}/>}
            </div>
            {grouped && <time className="message__hover-time" dateTime={new Date(m.created_at * 1000).toISOString()}>{formatTime(m.created_at)}</time>}
            <div className="message__actions"><button type="button" aria-label="Действия с сообщением" title="Действия с сообщением" onClick={(e)=>setMenu({message:m,x:e.clientX,y:e.clientY})}><Icon name="more" size={16}/></button></div>
          </article>
        </Fragment>
      })}
    </div>
    {scheduled && <ScheduledHistory api={api} token={token} destination={{ kind: 'conversation', id }} onClose={() => setScheduled(false)}/>}
    <div className="chat-composer-slot" hidden={scheduled}>{upload.control}
    {menu && <MessageContextMenu message={asMessage(messages.find((m)=>m.id===menu.message.id)??menu.message)} x={menu.x} y={menu.y} canEdit={false} canDelete={saved} canPin={false} canReply={false} pinned={false} pending={{}} onClose={()=>setMenu(null)} onReact={(emoji)=>void react(messages.find((m)=>m.id===menu.message.id)??menu.message,emoji)} onReply={()=>undefined} onEdit={()=>undefined} onPin={()=>undefined} onCopy={()=>{void navigator.clipboard.writeText(menu.message.content)}} onForward={()=>openForward({kind:'conversation',id:menu.message.id})} onSave={saved ? undefined : () => saveFavorite({kind:'conversation',id:menu.message.id})} onBlock={menu.message.author.user_id !== currentUserId ? () => { void api.community.request(token, `/me/blocks/${menu.message.author.user_id}`, 'PUT').then(onRefresh).catch((caught) => setError(problem(caught))) } : undefined} onDelete={()=>{const mid=menu.message.id;void api.community.request(token,`/conversations/${id}/messages/${mid}`,'DELETE').then(()=>{deletedIds.current.add(mid);setMessages((v)=>v.filter((m)=>m.id!==mid));onRefresh()}).catch((e)=>setError(problem(e)))}}/>}
    <ComposerTools onScheduled={() => { setMenu(null); setScheduled(true) }} api={api} token={token} destination={{kind:'conversation',id}} content={draft} prepare={upload.prepare} commit={upload.commit} release={upload.release} onSent={()=>{setDraft((current)=>current===draft?'':current);onRefresh()}} onAttach={upload.pickFiles} attachmentDisabled={upload.attachmentDisabled} disabled={pending}>{({ attachmentButton, onSchedule }) => <form className="composer direct-chat__composer" onSubmit={(e) => { e.preventDefault(); void send() }}>
      {attachmentButton}
      <label className="sr-only" htmlFor={`direct-draft-${id}`}>Сообщение в беседу</label>
      <textarea ref={draftInput} id={`direct-draft-${id}`} rows={1} value={draft} maxLength={5120} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send() } }} placeholder={saved ? "Добавьте заметку, ссылку или файл…" : "Напишите сообщение…"}/>
      <ComposerSendButton label={pending ? 'Отправляем…' : retry.current ? 'Повторить отправку' : 'Отправить'} disabled={pending || (!draft.trim() && !upload.hasItems)} onSchedule={onSchedule}><Icon name="send" size={18}/></ComposerSendButton>
    </form>}</ComposerTools></div>
    {(error || loadError) && <p className="form-error" role="alert">{error || loadError}</p>}
    {!saved && !scheduled && <button className="button button--ghost" onClick={() => void api.community.request(token, `/conversations/${id}/members/me`, 'DELETE').then(onLeave).catch((caught) => setError(problem(caught)))}>Покинуть беседу</button>}
  </section>
}

function SavedNote({value,onSave}:{value:string;onSave:(note:string)=>Promise<void>}){
 const [editing,setEditing]=useState(false),[note,setNote]=useState(value),[busy,setBusy]=useState(false),[error,setError]=useState('')
 if(!editing)return <div className="saved-note">{value&&<p>{value}</p>}<button type="button" onClick={()=>setEditing(true)}>{value?'Изменить заметку':'Добавить заметку'}</button></div>
 return <form className="saved-note saved-note--editing" onSubmit={(e)=>{e.preventDefault();if(busy)return;setBusy(true);void onSave(note).then(()=>setEditing(false)).catch((e)=>setError(problem(e))).finally(()=>setBusy(false))}}><textarea aria-label="Заметка к сохранённому сообщению" maxLength={2000} value={note} onChange={(e)=>setNote(e.target.value)}/>{error&&<p role="alert">{error}</p>}<div><button disabled={busy}>Сохранить заметку</button><button type="button" onClick={()=>setEditing(false)}>Отмена</button></div></form>
}
