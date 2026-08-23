import { useMemo } from 'react'
import type { ActiveStream, Channel, ServerMember, ServerRole, VoiceParticipant } from '../domain/types'
import type { StreamPreferences } from '../services/streamSettings'
import type { StreamQualityStats } from '../services/stream'
import { roleMeta } from '../lib/roles'
import { Avatar } from './Avatar'
import { Icon } from './Icon'
import { StreamPanel } from './StreamPanel'

export type VoiceConnectionStatus = 'idle' | 'requesting' | 'signaling' | 'connected'

interface VoicePanelProps {
  channel: Channel
  activeChannel: Pick<Channel, 'id' | 'name'> | null
  participants: VoiceParticipant[]
  members: ServerMember[]
  currentUserId: number
  speakingUserIds: number[]
  connectionStatus: VoiceConnectionStatus
  realtimeOnline: boolean
  selfMute: boolean
  selfDeaf: boolean
  error: string
  onJoin: () => Promise<void>
  onLeave: () => void
  onToggleMute: () => void
  onToggleDeaf: () => void
  onOpenProfile: (userId: number, role: ServerRole) => void
  stream: ActiveStream | null
  streamStatus: 'idle' | 'requesting' | 'signaling' | 'connected'
  streamError: string
  streamMedia: MediaStream | null
  streamPreferences: StreamPreferences
  streamQuality?: StreamQualityStats | null
  onStreamPreferencesChange: (value: StreamPreferences) => void
  onOpenStreamSettings: () => void
  onWatchStream: () => void
  onLeaveStream: () => void
  onExpandStream: () => void
}

const statusLabel: Record<VoiceConnectionStatus, string> = {
  idle: 'Не подключён',
  requesting: 'Запрашиваем микрофон',
  signaling: 'Устанавливаем защищённое соединение',
  connected: 'Голосовая связь установлена',
}

export function VoicePanel({ channel, activeChannel, participants, members, currentUserId, speakingUserIds, connectionStatus, realtimeOnline, selfMute, selfDeaf, error, onJoin, onLeave, onToggleMute, onToggleDeaf, onOpenProfile, stream, streamStatus, streamError, streamMedia, streamPreferences, streamQuality, onStreamPreferencesChange, onOpenStreamSettings, onWatchStream, onLeaveStream, onExpandStream }: VoicePanelProps) {
  const activeHere = activeChannel?.id === channel.id
  const connecting = activeHere && (connectionStatus === 'requesting' || connectionStatus === 'signaling')
  const speakingUsers = useMemo(() => new Set(speakingUserIds), [speakingUserIds])

  return (
    <section className="chat-panel voice-room voice-room--active">
      <div className="voice-room__hero">
        <div className={`voice-orbit ${activeHere ? 'is-active' : ''} ${connectionStatus === 'connected' ? 'is-connected' : ''}`}><span><Icon name="volume" size={34}/></span><i/><i/><i/></div>
        <div className="voice-room__intro">
          <span className="eyebrow">ГОЛОСОВАЯ КОМНАТА</span>
          <h2>{channel.name}</h2>
          <p>{activeHere ? statusLabel[connectionStatus] : activeChannel ? `Сейчас вы подключены к «${activeChannel.name}»` : 'Подключитесь, чтобы общаться с участниками в реальном времени.'}</p>
          {error && <div className="voice-error" role="alert">{error}</div>}
          {!activeHere ? <button className="button button--primary button--large" onClick={() => void onJoin()} disabled={!realtimeOnline}><Icon name="mic"/>{activeChannel ? 'Перейти в канал' : 'Подключиться'}</button> : <div className="voice-controls">
            <button className={`voice-control ${selfMute ? 'is-disabled' : ''}`} onClick={onToggleMute} disabled={connecting} title={selfMute ? 'Включить микрофон' : 'Выключить микрофон'}><span><Icon name="mic"/></span><small>{selfMute ? 'Микрофон выкл.' : 'Микрофон'}</small></button>
            <button className={`voice-control ${selfDeaf ? 'is-disabled' : ''}`} onClick={onToggleDeaf} disabled={connecting} title={selfDeaf ? 'Включить звук' : 'Выключить звук'}><span><Icon name="headphones"/></span><small>{selfDeaf ? 'Звук выключен' : 'Звук'}</small></button>
            {!stream && <button className="voice-control" onClick={onOpenStreamSettings} disabled={connectionStatus !== 'connected' || streamStatus !== 'idle'} title="Поделиться экраном"><span><Icon name="monitor"/></span><small>Экран</small></button>}
            <button className="voice-control voice-control--leave" onClick={onLeave}><span><Icon name="logout"/></span><small>Отключиться</small></button>
          </div>}
          {!realtimeOnline && <small className="voice-offline-note">Голос станет доступен после восстановления WebSocket-соединения.</small>}
        </div>
      </div>

      <section className="voice-participants">
        <header><div><span className="eyebrow">В КОМНАТЕ</span><h3>{participants.length} {participantWord(participants.length)}</h3></div><span className="voice-secure"><i/><span>DTLS-SRTP</span></span></header>
        {participants.length ? <div className="voice-participant-grid">{participants.map((participant) => {
          const member = members.find((item) => item.user_id === participant.user_id)
          const username = member?.username ?? `Пользователь #${participant.user_id}`
          const role = member?.role ?? 'member'
          const isMe = participant.user_id === currentUserId
          const isSpeaking = !participant.self_mute && speakingUsers.has(participant.user_id)
          return <button className={`voice-participant ${isMe ? 'is-me' : ''} ${isSpeaking ? 'is-speaking' : ''}`} key={participant.connection_id} onClick={() => onOpenProfile(participant.user_id, role)}>
            <div className="voice-participant__avatar"><Avatar name={username}/><i className={participant.self_mute ? 'is-muted' : ''}/></div>
            <span><b className={`member-name--${role}`}>{username}{isMe && <small>вы</small>}</b><em>{roleMeta[role].shortLabel}</em></span>
            <div className="voice-participant__state">{participant.self_deaf && <span title="Звук выключен"><Icon name="headphonesOff" size={14}/></span>}{participant.self_mute && <span title="Микрофон выключен"><Icon name="micOff" size={14}/></span>}</div>
          </button>
        })}</div> : <div className="voice-empty"><span><Icon name="people" size={25}/></span><div><b>Здесь пока тихо</b><p>Подключитесь первым — остальные увидят вас в комнате сразу.</p></div></div>}
      </section>

      <StreamPanel stream={stream} currentUserId={currentUserId} voiceActive={activeHere && connectionStatus === 'connected'} status={streamStatus} error={streamError} media={streamMedia} preferences={streamPreferences} quality={streamQuality} onPreferencesChange={onStreamPreferencesChange} onOpenSettings={onOpenStreamSettings} onWatch={onWatchStream} onLeave={onLeaveStream} onExpand={onExpandStream}/>
    </section>
  )
}

function participantWord(count: number) {
  const mod100 = count % 100
  const mod10 = count % 10
  if (mod100 >= 11 && mod100 <= 14) return 'участников'
  if (mod10 === 1) return 'участник'
  if (mod10 >= 2 && mod10 <= 4) return 'участника'
  return 'участников'
}
