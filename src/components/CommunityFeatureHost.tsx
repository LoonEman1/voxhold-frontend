import { useEffect, useRef, useState } from 'react'
import type { VoxholdApi } from '../services/api'
import type { CallState, Conversation, DirectMessage, FeatureSource } from '../domain/community'
import { UniversalForward, featuresChanged } from './CommunityFeatures'
import { ConversationCallDock } from './ConversationCallDock'
import { uiSounds } from '../services/uiSounds'
import { loadVoicePreferences } from '../services/voiceSettings'

export function CommunityFeatureHost({ api, token, userId, conversations, activeConversation }: { api: VoxholdApi; token: string; userId: number; conversations: Conversation[]; activeConversation: number | null }) {
  const [source, setSource] = useState<FeatureSource | null>(null), [status, setStatus] = useState<{ text: string; conversationId?: number; noticeId?: string } | null>(null)
  const latest = useRef({ conversations, activeConversation }); latest.current = { conversations, activeConversation }
  useEffect(() => {
    let alive = true, saving = false, lastSound = 0
    const seen = new Set<string>(), desktop = new Set<Notification>(), participated = new Set<number>()
    let timer: ReturnType<typeof setTimeout> | null = null
    const show = (text: string, conversationId?: number, noticeId?:string) => { if (!alive) return; setStatus({ text, conversationId, noticeId }); if (timer) clearTimeout(timer); timer = setTimeout(() => { if (alive) setStatus(null) }, 10_000) }
    const open = (e: Event) => setSource((e as CustomEvent<FeatureSource>).detail)
    const favorite = async (e: Event) => {
      if (saving) return; saving = true
      try { const value = await api.community.request<Conversation>(token, '/me/favorites'); await api.community.request(token, '/me/forward', 'POST', { source: (e as CustomEvent<FeatureSource>).detail, destination: { kind: 'conversation', id: value.id }, client_message_id: crypto.randomUUID() }); featuresChanged(); show('Сохранено в избранное') }
      catch (error) { show(error instanceof Error ? error.message : 'Не удалось сохранить') } finally { saving = false }
    }
    const notify = async (id: string, title: string, body: string, cid?: number, always = false) => {
      if (!alive || seen.has(id)) return; seen.add(id); if (seen.size > 1000) seen.delete(seen.values().next().value!)
      const deliver = () => {
        if (!alive) return
        try { const key = `voxhold.direct-notice:${userId}:${token.slice(-12)}`, value = JSON.parse(localStorage.getItem(key) ?? '[]') as string[]; if (Array.isArray(value) && value.includes(id)) return; localStorage.setItem(key, JSON.stringify([...(Array.isArray(value) ? value : []).slice(-200), id])) } catch { /* In-memory deduplication remains available. */ }
        const chat = latest.current.conversations.find((v) => v.id === cid)
        if (chat?.muted || !always && cid && latest.current.activeConversation === cid && document.visibilityState === 'visible' && document.hasFocus()) return
        show(`${title}: ${body}`, cid,id)
        const prefs = loadVoicePreferences(); if (prefs.uiSounds && Date.now() - lastSound > 1500) { lastSound = Date.now(); uiSounds.play('message_notification', prefs.uiSoundVolume, prefs.outputDeviceId) }
        if ((document.visibilityState !== 'visible' || !document.hasFocus()) && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          try { const n = new Notification(title, { body: body.slice(0, 180), tag: `voxhold:${id}`, silent: true }); desktop.add(n); n.onclose = () => desktop.delete(n); n.onclick = () => { window.focus(); if (cid) window.dispatchEvent(new CustomEvent('voxhold:open-conversation', { detail: cid })); n.close() } } catch { /* In-app notification remains visible. */ }
        }
      }
      if (navigator.locks?.request) { try { await navigator.locks.request(`voxhold.direct-notices:${userId}`, deliver) } catch { deliver() } } else deliver()
    }
    const event = (e: Event) => {
      const v = (e as CustomEvent<{ type: string; data: unknown }>).detail
      if (v?.type === 'conversation.notification') { const m = v.data as DirectMessage; if (m.author.user_id !== userId) void notify(`message:${m.conversation_id}:${m.id}`, m.author.username, m.content, m.conversation_id) }
      if (v?.type === 'conversation.call') {
        const call=v.data as CallState
        if(call.members.some((m)=>m.user_id===userId)){participated.add(call.conversation_id);setStatus((old)=>old?.conversationId===call.conversation_id&&old.noticeId?.startsWith('call:')?null:old);desktop.forEach((n)=>{if(n.tag.startsWith(`voxhold:call:${call.conversation_id}:`))n.close()})}
        else if(!call.members.length){participated.delete(call.conversation_id);setStatus((old)=>old?.conversationId===call.conversation_id&&old.noticeId?.startsWith('call:')?null:old);desktop.forEach((n)=>{if(n.tag.startsWith(`voxhold:call:${call.conversation_id}:`))n.close()})}
        else if(!participated.has(call.conversation_id))void notify(`call:${call.conversation_id}:${call.members[0]!.session_id}`,'Входящий звонок',`${call.members[0]!.username} приглашает в разговор`,call.conversation_id,true)
      }
      if (v?.type === 'community.event-reminder') { const n = v.data as { event_id: number; title: string; starts_at: number }; void notify(`event:${n.event_id}:${n.starts_at}`, 'Скоро событие', n.title) }
    }
    window.addEventListener('voxhold:forward', open); window.addEventListener('voxhold:favorite', favorite); window.addEventListener('voxhold:feature-event', event)
    return () => { alive = false; if (timer) clearTimeout(timer); desktop.forEach((n) => n.close()); window.removeEventListener('voxhold:forward', open); window.removeEventListener('voxhold:favorite', favorite); window.removeEventListener('voxhold:feature-event', event) }
  }, [api, token, userId])
  return <>{source && <UniversalForward key={`${source.kind}:${source.id}`} api={api} token={token} source={source} onClose={() => setSource(null)}/>}<ConversationCallDock api={api} token={token} userId={userId}/>{status && <div className="feature-status" role="status"><span>{status.text}</span>{status.conversationId && <button onClick={() => { window.dispatchEvent(new CustomEvent('voxhold:open-conversation', { detail: status.conversationId })); setStatus(null) }}>Открыть</button>}<button aria-label="Закрыть уведомление" onClick={() => setStatus(null)}>×</button></div>}</>
}
