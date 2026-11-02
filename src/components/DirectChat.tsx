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
import { MessageLinkPreviews } from './LazyMessageLinks'
import { ComposerTools, PollCard, openForward, saveFavorite } from './LazyCommunityFeatures'
import { MessageReactions } from './MessageReactions'
import { MessageMentions } from './MessageMentions'
import { MessageContextMenu } from './MessageContextMenu'
import { ForwardAttribution } from './MessageQuote'
import { MessageAttachments, useAttachmentUpload } from './MessageAttachments'
import { MessageAvatar, MessageHeader } from './MessageIdentity'

const problem = (error: unknown) => error instanceof Error ? error.message : 'Не удалось выполнить запрос'

export function DirectChat({ api, token, id, saved = false, currentUserId, revision, onRefresh, onLeave, onCreateGroup }: { api: VoxholdApi; token: string; id: number; saved?: boolean; currentUserId: number; revision: number; onRefresh: () => void; onLeave: () => void; onCreateGroup?: () => void }) {
  const community = useCommunity()
  const [menu, setMenu] = useState<{ message: DirectMessage; x: number; y: number } | null>(null), [reactionBusy, setReactionBusy] = useState<Record<string, boolean>>({})
  const [search, setSearch] = useState(''), [muted, setMuted] = useState(false)
  useEffect(() => { if (saved) return; const c = new AbortController(); void api.community.request<{ muted: boolean }>(token, `/conversations/${id}/notifications`, 'GET', undefined, c.signal).then((v) => { if (!c.signal.aborted) setMuted(v.muted) }).catch(() => undefined); return () => c.abort() }, [api,token,id,saved,revision])
  const [loadError, setLoadError] = useState('')
  const deletedIds=useRef(new Set<number>())
  const initialized = useRef(false), olderBusy = useRef(false), draftInput = useRef<HTMLTextAreaElement>(null)
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
            setMore(page.has_more); initialized.current = true; setLoading(false); setLoadError('')
          } catch (caught) {
            if (alive && !controller.signal.aborted && current === generation.current) { setLoading(false); setLoadError(problem(caught)) }
            break
          }
        } while (alive && dirty)
      } finally { running = false }
    }
    refreshHistory.current = () => { void refresh() }
    void refresh()
    return () => { alive = false; request?.abort(); refreshHistory.current = () => undefined }
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
    const mark = () => { if (document.visibilityState === 'visible' && document.hasFocus() && followingBottom.current && latest > readCursor.current) { readCursor.current = latest; void api.community.request(token, `/conversations/${id}/read`, 'PUT', { message_id: latest }).catch(() => { readCursor.current = 0 }) } }
    readLatest.current = mark; mark(); window.addEventListener('focus', mark); document.addEventListener('visibilitychange', mark); return () => { window.removeEventListener('focus', mark); document.removeEventListener('visibilitychange', mark) }
  }, [api, token, id, messages])
  const send = async () => {
    const content = draft.trim(); if ((!content && !upload.hasItems) || pending) return
    setPending(true); setError('')
    try {
      const attachmentIds = await upload.prepare()
      const fingerprint = JSON.stringify([content, attachmentIds])
      const key = retry.current?.content === fingerprint ? retry.current.key : crypto.randomUUID()
      retry.current = { content: fingerprint, key }
      const sent = await api.community.request<DirectMessage>(token, `/conversations/${id}/messages`, 'POST', { content, client_message_id: key, ...(attachmentIds.length ? { attachment_ids: attachmentIds } : {}) })
      setMessages((values) => [...values.filter((m) => m.id !== sent.id), sent].sort((a, b) => a.id - b.id))
      setDraft((v) => v.trim() === content ? '' : v); retry.current = null; upload.commit(attachmentIds); onRefresh()
      requestAnimationFrame(() => { const list = visible.current; if (list) list.scrollTop = list.scrollHeight })
    } catch (caught) { setError(problem(caught)) } finally { upload.release(); setPending(false) }
  }
  useLayoutEffect(() => { const input = draftInput.current; if (input) { input.style.height = 'auto'; input.style.height = `${Math.min(140, Math.max(37, input.scrollHeight))}px` } }, [draft])
  const loadOlder = async () => {
    if (olderBusy.current || !messages.length) return
    olderBusy.current = true
    const expected = ++generation.current
    const list = visible.current
    if (list) preserveDistance.current = list.scrollHeight - list.scrollTop
    try {
      const page = await api.community.request<{ messages: DirectMessage[]; has_more: boolean }>(token, `/conversations/${id}/messages?before=${messages[0]!.id}${search ? `&q=${encodeURIComponent(search)}` : ''}`)
      if (expected !== generation.current) { preserveDistance.current = null; return }
      setMessages((v) => [...new Map([...page.messages, ...v].filter((m)=>!deletedIds.current.has(m.id)).map((m) => [m.id, m])).values()].sort((a, b) => a.id - b.id)); setMore(page.has_more)
    } catch (caught) { preserveDistance.current = null; setError(problem(caught)) }
    finally { olderBusy.current = false }
  }
  const asMessage = (m: DirectMessage): Message => ({...m, channel_id:0, edited_at:null})
  const react = async (m: DirectMessage, emoji: string) => {
    const key = `${m.id}:${emoji}`; if (reactionBusy[key]) return; setReactionBusy((v) => ({...v,[key]:true}))
    try { const active=m.reactions?.some((r)=>r.emoji===emoji&&r.me); const result=await api.community.request<{reactions: Message['reactions']; revision:number}>(token,`/conversations/${id}/messages/${m.id}/reactions/${encodeURIComponent(emoji)}`,active?'DELETE':'PUT');setMessages((v)=>v.map((value)=>value.id===m.id?{...value,reactions:result.reactions,revision:result.revision,reactions_revision:result.revision}:value));onRefresh() } catch(e){setError(problem(e))} finally{setReactionBusy((v)=>({...v,[key]:false}))}
  }
  const toggleMute = async () => { try{const v=await api.community.request<{muted:boolean}>(token,`/conversations/${id}/notifications`,'PUT',{muted:!muted});setMuted(v.muted);onRefresh()}catch(e){setError(problem(e))} }
  return <section className="direct-chat" onPaste={upload.onPaste} onDrop={upload.onDrop} onDragOver={upload.onDragOver}>
    <div className="direct-chat__tools">{onCreateGroup && <button type="button" onClick={onCreateGroup}><Icon name="people" size={16}/>Создать беседу</button>}{saved ? <label>Поиск в избранном <input type="search" value={search} onChange={(e)=>{setSearch(e.target.value);initialized.current=false}} placeholder="Текст, ссылка или заметка"/></label> : <><button onClick={()=>window.dispatchEvent(new CustomEvent('voxhold:start-conversation-call',{detail:id}))}>Позвонить / присоединиться</button><button aria-pressed={muted} onClick={()=>void toggleMute()}>{muted?'Включить уведомления':'Отключить уведомления'}</button></>}</div>
    <div className="direct-chat__messages messages" ref={visible} onScroll={() => { const list = visible.current; followingBottom.current = !!list && list.scrollHeight - list.scrollTop - list.clientHeight < 60; readLatest.current() }} aria-live="polite">
      {!messages.length && !error && !loadError && <PersonalEmpty icon="message" title={loading ? 'Загружаем сообщения…' : saved ? 'Сохраните важное' : 'Начните разговор'}>{saved ? 'Перешлите сюда сообщение или добавьте свою заметку, ссылку или файл.' : 'Сообщения видны только участникам этого разговора.'}</PersonalEmpty>}
      {more && <button className="button button--ghost" onClick={() => void loadOlder()}>Раньше</button>}
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
            <div className="message__actions"><button aria-label="Действия с сообщением" onClick={(e)=>setMenu({message:m,x:e.clientX,y:e.clientY})}><Icon name="more" size={14}/></button>{!mine && <button aria-label={`Заблокировать ${m.author.username}`} title={`Заблокировать ${m.author.username}`} onClick={() => void api.community.request(token, `/me/blocks/${m.author.user_id}`, 'PUT').then(onRefresh).catch((caught) => setError(problem(caught)))}><Icon name="lock" size={14}/></button>}</div>
          </article>
        </Fragment>
      })}
    </div>
    {upload.control}
    <ComposerTools api={api} token={token} destination={{kind:'conversation',id}} content={draft} prepare={upload.prepare} commit={upload.commit} release={upload.release} onSent={()=>{setDraft((current)=>current===draft?'':current);onRefresh()}}/>
    {menu && <MessageContextMenu message={asMessage(messages.find((m)=>m.id===menu.message.id)??menu.message)} x={menu.x} y={menu.y} canEdit={false} canDelete={saved} canPin={false} canReply={false} pinned={false} pending={{}} onClose={()=>setMenu(null)} onReact={(emoji)=>void react(messages.find((m)=>m.id===menu.message.id)??menu.message,emoji)} onReply={()=>undefined} onEdit={()=>undefined} onPin={()=>undefined} onCopy={()=>{void navigator.clipboard.writeText(menu.message.content)}} onForward={()=>openForward({kind:'conversation',id:menu.message.id})} onSave={()=>saveFavorite({kind:'conversation',id:menu.message.id})} onDelete={()=>{const mid=menu.message.id;void api.community.request(token,`/conversations/${id}/messages/${mid}`,'DELETE').then(()=>{deletedIds.current.add(mid);setMessages((v)=>v.filter((m)=>m.id!==mid));onRefresh()}).catch((e)=>setError(problem(e)))}}/>}
    <form className="composer direct-chat__composer" onSubmit={(e) => { e.preventDefault(); void send() }}>
      <label className="sr-only" htmlFor={`direct-draft-${id}`}>Сообщение в беседу</label>
      <textarea ref={draftInput} id={`direct-draft-${id}`} rows={1} value={draft} maxLength={5120} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send() } }} placeholder={saved ? "Добавьте заметку, ссылку или файл…" : "Напишите сообщение…"}/>
      <button className="composer__send" aria-label={pending ? 'Отправляем…' : retry.current ? 'Повторить отправку' : 'Отправить'} title="Отправить" disabled={pending || (!draft.trim() && !upload.hasItems)}><Icon name="send" size={18}/></button>
    </form>
    {(error || loadError) && <p className="form-error" role="alert">{error || loadError}</p>}
    {!saved && <button className="button button--ghost" onClick={() => void api.community.request(token, `/conversations/${id}/members/me`, 'DELETE').then(onLeave).catch((caught) => setError(problem(caught)))}>Покинуть беседу</button>}
  </section>
}

function SavedNote({value,onSave}:{value:string;onSave:(note:string)=>Promise<void>}){
 const [editing,setEditing]=useState(false),[note,setNote]=useState(value),[busy,setBusy]=useState(false),[error,setError]=useState('')
 if(!editing)return <div className="saved-note">{value&&<p>{value}</p>}<button type="button" onClick={()=>setEditing(true)}>{value?'Изменить заметку':'Добавить заметку'}</button></div>
 return <form className="saved-note saved-note--editing" onSubmit={(e)=>{e.preventDefault();if(busy)return;setBusy(true);void onSave(note).then(()=>setEditing(false)).catch((e)=>setError(problem(e))).finally(()=>setBusy(false))}}><textarea aria-label="Заметка к сохранённому сообщению" maxLength={2000} value={note} onChange={(e)=>setNote(e.target.value)}/>{error&&<p role="alert">{error}</p>}<div><button disabled={busy}>Сохранить заметку</button><button type="button" onClick={()=>setEditing(false)}>Отмена</button></div></form>
}
