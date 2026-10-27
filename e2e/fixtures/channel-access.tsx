import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ChannelSettingsDialog } from '../../src/components/WorkspaceDialogs'
import { ChannelAccessSettings } from '../../src/components/ChannelAccessSettings'
import { VoicePanel } from '../../src/components/VoicePanel'
import { PersistentStreamPlayer } from '../../src/components/PersistentStreamPlayer'
import { DEFAULT_STREAM_PREFERENCES } from '../../src/services/streamSettings'
import { ThemeProvider } from '../../src/theme/ThemeContext'
import type { ActiveStream, Channel, ChannelAccess, ServerMember } from '../../src/domain/types'
import type { VoxholdApi } from '../../src/services/api'
import '../../src/styles/global.css'

const channel = { id: 1, server_id: 1, name: 'дизайн-комната', kind: 'voice', access_restricted: true } as Channel
const members = [{ user_id: 1, username: 'Александр', role: 'owner' }, { user_id: 2, username: 'Мария', role: 'member' }, { user_id: 3, username: 'Николай', role: 'member' }, { user_id: 4, username: 'ОченьДлинноеИмяУчастникаКоманды', role: 'member' }] as ServerMember[]
const stream: ActiveStream = { server_id: 1, channel_id: 1, publisher_user_id: 1, publisher_connection_id: 'a', mode: 'server', codec: 'vp9', has_audio: true, viewer_count: 2, started_at_ms: Date.now()-60000 }
const api = { channels: { access: async () => ({ restricted: true, user_ids: [2], roles: [] }), setAccess: async (_t: string, _s: number, _c: number, access: ChannelAccess) => access } } as unknown as VoxholdApi
function Fixture() {
  const [settings, setSettings] = useState(false), [expanded, setExpanded] = useState(false)
  const [audioMuted, setAudioMuted] = useState(false)
  const [media, setMedia] = useState<MediaStream | null>(null)
  const [preferences, setPreferences] = useState(DEFAULT_STREAM_PREFERENCES)
  useEffect(() => {
    const canvas = document.createElement('canvas'); canvas.width=1280; canvas.height=720
    const ctx = canvas.getContext('2d')!
    const draw = () => {
      const gradient=ctx.createLinearGradient(0,0,1280,720); gradient.addColorStop(0,'#283b31'); gradient.addColorStop(1,'#101b28'); ctx.fillStyle=gradient; ctx.fillRect(0,0,1280,720)
      ctx.fillStyle='#e7ff5b'; ctx.font='bold 58px sans-serif'; ctx.fillText('Voxhold',90,180)
      ctx.fillStyle='#fafbf8'; ctx.font='32px sans-serif'; ctx.fillText('Пространство для ваших идей',90,250)
      for(let i=0;i<3;i++){ctx.fillStyle=['#54795a','#526b8f','#73608e'][i];ctx.beginPath();ctx.roundRect(90+i*370,340,330,210,22);ctx.fill();ctx.fillStyle='#ffffff';ctx.font='20px sans-serif';ctx.fillText(['Обсуждаем','Создаём','Делимся'][i],120+i*370,395)}
      ctx.fillStyle='#bac7bd';ctx.font='18px sans-serif';ctx.fillText(new Date().toLocaleTimeString(),90,650)
    }; draw(); const timer=setInterval(draw,1000); const capture=canvas.captureStream(5); setMedia(capture)
    return()=>{clearInterval(timer);capture.getTracks().forEach((track)=>track.stop())}
  },[])
  const participants=members.slice(0,3).map((member)=>({connection_id:String(member.user_id),user_id:member.user_id,server_id:1,channel_id:1,self_mute:false,self_deaf:false}))
  return <ThemeProvider><main style={{height:'100dvh',display:'flex',flexDirection:'column'}}><div style={{padding:16,display:'flex',gap:12}}><button className="button button--secondary" onClick={()=>setSettings(true)}>Настроить доступ</button><button className="button button--ghost" onClick={()=>document.documentElement.dataset.theme=document.documentElement.dataset.theme==='light'?'dark':'light'}>Сменить тему</button></div><VoicePanel channel={channel} activeChannel={channel} participants={participants} members={members} currentUserId={1} speakingUserIds={[2]} connectionStatus="connected" realtimeOnline selfMute={false} selfDeaf={false} error="" onJoin={()=>{}} onLeave={()=>{}} onToggleMute={()=>{}} onToggleDeaf={()=>{}} onOpenProfile={()=>{}} stream={stream} streamStatus="connected" streamError="" streamMedia={expanded?null:media} streamPreferences={preferences} streamAudioMuted={audioMuted} onToggleStreamAudio={()=>setAudioMuted((value)=>!value)} onStreamPreferencesChange={setPreferences} onOpenStreamSettings={()=>{}} onWatchStream={()=>setExpanded(true)} onLeaveStream={()=>{}} onExpandStream={()=>setExpanded(true)} onFullscreenStream={()=>setExpanded(true)}/>
  <ChannelSettingsDialog open={settings} onClose={()=>setSettings(false)} channel={channel} onRename={async()=>{}} onRemove={async()=>{}} accessPanel={<ChannelAccessSettings api={api} token="fixture" channel={channel} members={members} onSaved={()=>{}}/>}/>
  {expanded && media && <PersistentStreamPlayer mode="expanded" stream={stream} role="publisher" audioMuted={audioMuted} onToggleAudio={()=>setAudioMuted((value)=>!value)} status="connected" media={media} channelName={channel.name} preferences={preferences} onPreferencesChange={setPreferences} onExpand={()=>{}} onCollapse={()=>setExpanded(false)} onLeave={()=>setExpanded(false)} participants={<><button className="stream-focused-participant">Александр</button><button className="stream-focused-participant is-speaking">Мария</button></>}/>}</main></ThemeProvider>
}
createRoot(document.getElementById('root')!).render(<Fixture/> )
