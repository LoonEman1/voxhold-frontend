import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Channel, ChannelRead, Message, ServerMember, VoiceParticipant } from '../domain/types'
import { RealtimeClient } from './realtime'

type FakeEvent = { data?: string; code?: number }
type FakeListener = (event: FakeEvent) => void

class FakeWebSocket {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3
  static latest: FakeWebSocket | null = null

  readyState = FakeWebSocket.CONNECTING
  readonly sent: string[] = []
  private readonly listeners = new Map<string, FakeListener[]>()

  constructor(readonly url: string) {
    FakeWebSocket.latest = this
  }

  addEventListener(type: string, listener: FakeListener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
  }

  send(payload: string) {
    this.sent.push(payload)
  }

  close(code = 1000) {
    this.readyState = FakeWebSocket.CLOSED
    this.emit('close', { code })
  }

  open() {
    this.readyState = FakeWebSocket.OPEN
    this.emit('open', {})
  }

  serverEvent(type: string, data: unknown) {
    this.emit('message', { data: JSON.stringify({ type, data }) })
  }

  private emit(type: string, event: FakeEvent) {
    this.listeners.get(type)?.forEach((listener) => listener(event))
  }
}

describe('RealtimeClient', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {
      location: { protocol: 'http:', host: 'localhost:3000', href: 'http://localhost:3000/' },
      setTimeout,
      clearTimeout,
    })
    vi.stubGlobal('WebSocket', FakeWebSocket)
  })

  afterEach(() => {
    FakeWebSocket.latest = null
    vi.unstubAllGlobals()
  })

  it('dispatches chat, server, channel, invitation and read events', () => {
    const onMessage = vi.fn()
    const onMessageUpdated = vi.fn()
    const onMessageDeleted = vi.fn()
    const onMessagePinned = vi.fn()
    const onMessageUnpinned = vi.fn()
    const onPresenceSnapshot = vi.fn()
    const onPresenceUpdated = vi.fn()
    const onServerMemberJoined = vi.fn()
    const onServerMemberRoleUpdated = vi.fn()
    const onServerMemberRemoved = vi.fn()
    const onServerDeleted = vi.fn()
    const onInvitationReceived = vi.fn()
    const onChannelCreated = vi.fn()
    const onChannelUpdated = vi.fn()
    const onChannelDeleted = vi.fn()
    const onReadSnapshot = vi.fn()
    const onChannelReadSnapshot = vi.fn()
    const onChannelRead = vi.fn()
    const onVoiceJoined = vi.fn()
    const onVoiceLeft = vi.fn()
    const onVoiceParticipantJoined = vi.fn()
    const onVoiceParticipantLeft = vi.fn()
    const onVoiceStateUpdated = vi.fn()
    const onVoiceSnapshot = vi.fn()
    const onVoiceWebRTCOffer = vi.fn()
    const onVoiceICECandidate = vi.fn()
    const onVoiceWebRTCClosed = vi.fn()
    const onStreamStarted = vi.fn()
    const onStreamUpdated = vi.fn()
    const onStreamStopped = vi.fn()
    const onStreamSnapshot = vi.fn()
    const onStreamViewerJoined = vi.fn()
    const onStreamWebRTCOffer = vi.fn()
    const onStreamICECandidate = vi.fn()
    const onStreamP2POffer = vi.fn()
    const onStreamP2PRestart = vi.fn()
    const client = new RealtimeClient({
      token: 'secret',
      onMessage,
      onMessageUpdated,
      onMessageDeleted,
      onMessagePinned,
      onMessageUnpinned,
      onPresenceSnapshot,
      onPresenceUpdated,
      onServerMemberJoined,
      onServerMemberRoleUpdated,
      onServerMemberRemoved,
      onServerDeleted,
      onInvitationReceived,
      onChannelCreated,
      onChannelUpdated,
      onChannelDeleted,
      onReadSnapshot,
      onChannelReadSnapshot,
      onChannelRead,
      onVoiceJoined,
      onVoiceLeft,
      onVoiceParticipantJoined,
      onVoiceParticipantLeft,
      onVoiceStateUpdated,
      onVoiceSnapshot,
      onVoiceWebRTCOffer,
      onVoiceICECandidate,
      onVoiceWebRTCClosed,
      onStreamStarted,
      onStreamUpdated,
      onStreamStopped,
      onStreamSnapshot,
      onStreamViewerJoined,
      onStreamWebRTCOffer,
      onStreamICECandidate,
      onStreamP2POffer,
      onStreamP2PRestart,
      onStateChange: vi.fn(),
      onUnauthorized: vi.fn(),
    })

    client.subscribe(3, 7)
    client.connect()
    const socket = FakeWebSocket.latest
    expect(socket?.url).toBe('ws://localhost:3000/api/v1/ws')
    socket?.open()
    socket?.serverEvent('ready', { user_id: 1, protocol_version: 5 })

    const message: Message = { id: 9, channel_id: 7, author: { user_id: 1, username: 'niko' }, content: 'обновлено', created_at: 10, edited_at: 11 }
    socket?.serverEvent('message.created', message)
    socket?.serverEvent('message.updated', message)
    socket?.serverEvent('message.deleted', { channel_id: 7, message_id: 9 })
    const pinned = { channel_id: 7, message_id: 9, message, pinned_by: message.author, pinned_at: 12 }
    socket?.serverEvent('message.pinned', pinned)
    socket?.serverEvent('message.unpinned', { channel_id: 7, message_id: 9 })
    socket?.serverEvent('presence.snapshot', { servers: [{ server_id: 3, online_user_ids: [1, 2] }] })
    socket?.serverEvent('presence.updated', { server_id: 3, user_id: 2, status: 'offline' })

    const member: ServerMember = {
      user_id: 2,
      username: 'anna',
      created_at: 1,
      role: 'member',
      joined_at: 2,
      about: '',
      country_code: 'RU',
      last_seen_at: null,
    }
    const channel: Channel = {
      id: 7,
      server_id: 3,
      name: 'general',
      kind: 'text',
      position: 0,
      created_by: 1,
      created_at: 3,
    }
    const read: ChannelRead = {
      server_id: 3,
      channel_id: 7,
      user_id: 2,
      last_read_message_id: 9,
      updated_at: 13,
    }
    const invite = {
      id: 4,
      server_id: 3,
      server_name: 'Voxhold',
      inviter_user_id: 1,
      inviter_username: 'niko',
      invitee_user_id: 2,
      status: 'pending',
      expires_at: 100,
      created_at: 10,
    }
    socket?.serverEvent('server.member_joined', { server_id: 3, member })
    socket?.serverEvent('server.member_role_updated', { server_id: 3, member: { ...member, role: 'admin' } })
    socket?.serverEvent('server.member_removed', { server_id: 3, user_id: 2 })
    socket?.serverEvent('server.deleted', { server_id: 3 })
    socket?.serverEvent('invitation.received', invite)
    socket?.serverEvent('channel.created', channel)
    socket?.serverEvent('channel.updated', { ...channel, name: 'updates' })
    socket?.serverEvent('channel.deleted', { server_id: 3, channel_id: 7 })
    socket?.serverEvent('read.snapshot', { reads: [read] })
    socket?.serverEvent('channel.read_snapshot', { server_id: 3, channel_id: 7, reads: [read] })
    socket?.serverEvent('channel.read', read)

    const voiceParticipant: VoiceParticipant = {
      connection_id: 'voice-connection',
      user_id: 2,
      server_id: 3,
      channel_id: 8,
      self_mute: false,
      self_deaf: false,
    }
    const voiceLeft = { connection_id: 'voice-connection', user_id: 2, server_id: 3, channel_id: 8 }
    const iceCandidate = { candidate: 'candidate:1 1 UDP 1 127.0.0.1 50000 typ host', sdp_mid: '0', sdp_mline_index: 0 }
    socket?.serverEvent('voice.snapshot', { participants: [voiceParticipant] })
    socket?.serverEvent('voice.joined', { participant: voiceParticipant, participants: [voiceParticipant] })
    socket?.serverEvent('voice.participant_joined', voiceParticipant)
    socket?.serverEvent('voice.state_updated', { ...voiceParticipant, self_mute: true })
    socket?.serverEvent('voice.participant_left', voiceLeft)
    socket?.serverEvent('voice.left', voiceLeft)
    socket?.serverEvent('voice.webrtc_offer', { sdp: 'offer-sdp' })
    socket?.serverEvent('voice.ice_candidate', iceCandidate)
    socket?.serverEvent('voice.webrtc_closed', { reason: 'closed by server' })

    const stream = {
      server_id: 3,
      channel_id: 8,
      publisher_user_id: 2,
      publisher_connection_id: 'voice-connection',
      mode: 'server',
      codec: 'vp9',
      has_audio: true,
      viewer_count: 0,
    }
    socket?.serverEvent('stream.snapshot', { streams: [stream] })
    socket?.serverEvent('stream.started', stream)
    socket?.serverEvent('stream.updated', { ...stream, viewer_count: 1 })
    socket?.serverEvent('stream.viewer_joined', { connection_id: 'viewer', user_id: 3 })
    socket?.serverEvent('stream.webrtc_offer', { sdp: 'stream-offer' })
    socket?.serverEvent('stream.ice_candidate', iceCandidate)
    socket?.serverEvent('stream.p2p_offer', { from_connection_id: 'publisher', sdp: 'p2p-offer' })
    socket?.serverEvent('stream.p2p_restart', { connection_id: 'viewer', user_id: 3 })
    socket?.serverEvent('stream.stopped', { server_id: 3, channel_id: 8, reason: 'done' })

    expect(socket?.sent.map((payload) => JSON.parse(payload).type)).toEqual(['auth', 'channel.subscribe'])
    expect(onMessage).toHaveBeenCalledWith(message)
    expect(onMessageUpdated).toHaveBeenCalledWith(message)
    expect(onMessageDeleted).toHaveBeenCalledWith({ channel_id: 7, message_id: 9 })
    expect(onMessagePinned).toHaveBeenCalledWith(pinned)
    expect(onMessageUnpinned).toHaveBeenCalledOnce()
    expect(onPresenceSnapshot).toHaveBeenCalledOnce()
    expect(onPresenceUpdated).toHaveBeenCalledWith({ server_id: 3, user_id: 2, status: 'offline' })
    expect(onServerMemberJoined).toHaveBeenCalledWith({ server_id: 3, member })
    expect(onServerMemberRoleUpdated).toHaveBeenCalledWith({ server_id: 3, member: { ...member, role: 'admin' } })
    expect(onServerMemberRemoved).toHaveBeenCalledWith({ server_id: 3, user_id: 2 })
    expect(onServerDeleted).toHaveBeenCalledWith({ server_id: 3 })
    expect(onInvitationReceived).toHaveBeenCalledWith(invite)
    expect(onChannelCreated).toHaveBeenCalledWith(channel)
    expect(onChannelUpdated).toHaveBeenCalledWith({ ...channel, name: 'updates' })
    expect(onChannelDeleted).toHaveBeenCalledWith({ server_id: 3, channel_id: 7 })
    expect(onReadSnapshot).toHaveBeenCalledWith({ reads: [read] })
    expect(onChannelReadSnapshot).toHaveBeenCalledWith({ server_id: 3, channel_id: 7, reads: [read] })
    expect(onChannelRead).toHaveBeenCalledWith(read)
    expect(onVoiceSnapshot).toHaveBeenCalledWith({ participants: [voiceParticipant] })
    expect(onVoiceJoined).toHaveBeenCalledWith({ participant: voiceParticipant, participants: [voiceParticipant] })
    expect(onVoiceParticipantJoined).toHaveBeenCalledWith(voiceParticipant)
    expect(onVoiceStateUpdated).toHaveBeenCalledWith({ ...voiceParticipant, self_mute: true })
    expect(onVoiceParticipantLeft).toHaveBeenCalledWith(voiceLeft)
    expect(onVoiceLeft).toHaveBeenCalledWith(voiceLeft)
    expect(onVoiceWebRTCOffer).toHaveBeenCalledWith({ sdp: 'offer-sdp' })
    expect(onVoiceICECandidate).toHaveBeenCalledWith(iceCandidate)
    expect(onVoiceWebRTCClosed).toHaveBeenCalledWith({ reason: 'closed by server' })
    expect(onStreamSnapshot).toHaveBeenCalledWith({ streams: [stream] })
    expect(onStreamStarted).toHaveBeenCalledWith(stream)
    expect(onStreamUpdated).toHaveBeenCalledWith({ ...stream, viewer_count: 1 })
    expect(onStreamViewerJoined).toHaveBeenCalledWith({ connection_id: 'viewer', user_id: 3 })
    expect(onStreamWebRTCOffer).toHaveBeenCalledWith({ sdp: 'stream-offer' })
    expect(onStreamICECandidate).toHaveBeenCalledWith(iceCandidate)
    expect(onStreamP2POffer).toHaveBeenCalledWith({ from_connection_id: 'publisher', sdp: 'p2p-offer' })
    expect(onStreamP2PRestart).toHaveBeenCalledWith({ connection_id: 'viewer', user_id: 3 })
    expect(onStreamStopped).toHaveBeenCalledWith({ server_id: 3, channel_id: 8, reason: 'done' })

    client.joinVoice(3, 8, false, false)
    client.updateVoiceState(true, false)
    client.answerVoice('answer-sdp')
    client.sendVoiceICECandidate(iceCandidate)
    client.leaveVoice()
    client.startStream(3, 8, 'server', 'vp9', true)
    client.watchStream(3, 8)
    client.answerStream('stream-answer')
    client.sendStreamICECandidate(iceCandidate)
    client.requestStreamP2PRestart('publisher')
    client.stopStream()
    expect(socket?.sent.map((payload) => JSON.parse(payload).type).slice(2)).toEqual([
      'voice.join',
      'voice.state_update',
      'voice.webrtc_answer',
      'voice.ice_candidate',
      'voice.leave',
      'stream.start',
      'stream.watch',
      'stream.webrtc_answer',
      'stream.ice_candidate',
      'stream.p2p_restart',
      'stream.stop',
    ])

    client.close()
  })
})
