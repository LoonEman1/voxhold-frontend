import { useSpeakingUsers } from './MediaActivity'
import { useMemo, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import type { ActiveStream, Channel, ServerMember, ServerRole, VoiceParticipant } from '../domain/types'
import type { StreamPreferences } from '../services/streamSettings'
import type { StreamQualityStats } from '../services/stream'
import { roleMeta } from '../lib/roles'
import { Avatar } from './Avatar'
import { Icon } from './Icon'
import { StreamPanel } from './StreamPanel'

export type VoiceConnectionStatus = 'idle' | 'requesting' | 'signaling' | 'connected'

interface VoicePanelProps {
  controls?: ReactNode
  chat?: ReactNode
  recordingLabel?: string
  channel: Channel
  activeChannel: Pick<Channel, 'id' | 'name'> | null
  participants: VoiceParticipant[]
  members: ServerMember[]
  currentUserId: number
  speakingUserIds?: number[]
  connectionStatus: VoiceConnectionStatus
  realtimeOnline: boolean
  selfMute: boolean
  selfDeaf: boolean
  error: string
  /** Automatic reconnection after a short signalling loss is in progress. */
  recovering?: boolean
  /** Microphone reacquire failed; receiving others still works. */
  micUnavailable?: boolean
  onRetryMic?: () => void
  /** Browser blocked audible playback; an explicit user action can fix it. */
  playbackBlocked?: boolean
  onEnablePlayback?: () => void
  onJoin: () => Promise<void>
  onLeave: () => void
  onToggleMute: () => void
  onToggleDeaf: () => void
  onOpenProfile: (userId: number, role: ServerRole) => void
  onParticipantContextMenu?: (event: ReactMouseEvent, participant: VoiceParticipant, member: ServerMember | undefined) => void
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
  onFullscreenStream?: () => void
  /** Publisher only: the outgoing stream audio is muted for viewers. */
  streamAudioMuted?: boolean
  onToggleStreamAudio?: () => void
}

const statusLabel: Record<VoiceConnectionStatus, string> = {
  idle: 'Не подключён',
  requesting: 'Запрашиваем микрофон',
  signaling: 'Устанавливаем защищённое соединение',
  connected: 'Голосовая связь установлена',
}

export function VoicePanel({ channel, activeChannel, participants, members, currentUserId, speakingUserIds, connectionStatus, realtimeOnline, selfMute, selfDeaf, error, recovering = false, micUnavailable = false, onRetryMic, playbackBlocked = false, onEnablePlayback, onJoin, onLeave, onToggleMute, onToggleDeaf, onOpenProfile, onParticipantContextMenu, stream, streamStatus, streamError, streamMedia, streamPreferences, streamQuality, onStreamPreferencesChange, onOpenStreamSettings, onWatchStream, onLeaveStream, onExpandStream, onFullscreenStream, streamAudioMuted = false, onToggleStreamAudio, controls, chat, recordingLabel }: VoicePanelProps) {
  const activeHere = activeChannel?.id === channel.id
  const publisherName = stream ? members.find((item) => item.user_id === stream.publisher_user_id)?.username : undefined
  const connecting = activeHere && (connectionStatus === 'requesting' || connectionStatus === 'signaling')
  const speakers = useSpeakingUsers(speakingUserIds)
  const speakingUsers = useMemo(() => new Set(speakers), [speakers])
  const statusText = recovering
    ? 'Восстанавливаем соединение…'
    : micUnavailable
      ? 'Микрофон недоступен'
      : statusLabel[connectionStatus]

  return (
    <section className="voice-stage-layout" data-voice-state={connectionStatus} data-voice-channel-id={channel.id}><div className="chat-panel voice-room voice-room--active">
      <header className="voice-stage-status"><span><i className={connectionStatus === 'connected' ? 'connection-dot connection-dot--online' : 'connection-dot'}/>{activeHere ? statusText : channel.name}</span>{recordingLabel && <span className="recording-label"><i className="record-dot is-active"/>Записывает {recordingLabel}</span>}</header>
      {error && <div className="voice-error" role="alert">{error}</div>}
      {micUnavailable && onRetryMic && <button className="button button--ghost" onClick={onRetryMic}>Повторить подключение микрофона</button>}
      {playbackBlocked && onEnablePlayback && <button className="button button--primary" onClick={onEnablePlayback}>Включить звук</button>}
      <div className="voice-stage-content">
      {/* The stream is the main content of the room while it runs. */}
      <StreamPanel stream={stream} currentUserId={currentUserId} publisherName={publisherName} voiceActive={activeHere && connectionStatus === 'connected'} status={streamStatus} error={streamError} media={streamMedia} preferences={streamPreferences} quality={streamQuality} audioMuted={streamAudioMuted} onPreferencesChange={onStreamPreferencesChange} onOpenSettings={onOpenStreamSettings} onWatch={onWatchStream} onLeave={onLeaveStream} onExpand={onExpandStream} onFullscreen={onFullscreenStream} onToggleAudio={onToggleStreamAudio}/>

      <section className="voice-participants">
        {participants.length ? <div className="voice-participant-grid">{participants.map((participant) => {
          const member = members.find((item) => item.user_id === participant.user_id)
          const username = member?.username ?? `Пользователь #${participant.user_id}`
          const role = member?.role ?? 'member'
          const isMe = participant.user_id === currentUserId
          const isSpeaking = !participant.self_mute && speakingUsers.has(participant.user_id)
          return <button className={`voice-participant ${isMe ? 'is-me' : ''} ${isSpeaking ? 'is-speaking' : ''}`} key={participant.connection_id} onClick={() => onOpenProfile(participant.user_id, role)} onContextMenu={(event) => onParticipantContextMenu?.(event, participant, member)}>
            <div className="voice-participant__avatar"><Avatar userId={participant.user_id} name={username}/><i className={participant.self_mute ? 'is-muted' : ''}/></div>
            <span><b className={`member-name--${role}`}>{username}{isMe && <small>вы</small>}</b><em>{roleMeta[role].shortLabel}</em></span>
            {stream?.publisher_user_id === participant.user_id && <b className="voice-participant__live" title="Показывает экран"><Icon name="monitor" size={11}/>В эфире</b>}
            <div className="voice-participant__state">{participant.self_deaf && <span title="Звук выключен"><Icon name="headphonesOff" size={14}/></span>}{participant.self_mute && <span title="Микрофон выключен"><Icon name="micOff" size={14}/></span>}</div>
          </button>
        })}</div> : <div className="voice-empty"><span><Icon name="people" size={25}/></span><div><b>Здесь пока тихо</b><p>Подключитесь первым — остальные увидят вас в комнате сразу.</p></div></div>}
      </section></div>
      <footer className="voice-stage-footer">{activeHere ? controls ?? <div className="voice-controls"><button disabled={connecting} onClick={onToggleMute}>{selfMute ? 'Включить микрофон' : 'Выключить микрофон'}</button><button onClick={onToggleDeaf}>{selfDeaf ? 'Включить звук' : 'Выключить звук'}</button><button onClick={onLeave}>Отключиться</button></div> : <button className="button button--primary" disabled={!realtimeOnline} onClick={() => void onJoin()}><Icon name="volume"/>{activeChannel ? 'Перейти в канал' : 'Подключиться к каналу'}</button>}</footer>
    </div>{chat}</section>
  )
}
