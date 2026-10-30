import { ApiError, type VoxholdApi } from './api'
import type { CallMember, CallState, CallSignal } from '../domain/community'
import { parseWebRTCConfig } from './webrtcConfig'
import { loadVoicePreferences } from './voiceSettings'
import { captureScreen } from './stream'
import { loadStreamPreferences } from './streamSettings'

interface Peer { member: CallMember; pc: RTCPeerConnection; makingOffer: boolean; ignoreOffer: boolean; settingAnswer: boolean; pending: RTCIceCandidateInit[]; serial: Promise<void>; media:MediaStream; screenSharing:boolean; screenRevision:number }
export class ConversationCall {
  readonly sessionId = crypto.randomUUID()
  private peers = new Map<number, Peer>()
  private microphone: MediaStream | null = null
  private screen: MediaStream | null = null
  private configuration: RTCConfiguration = {}
  private heartbeat: ReturnType<typeof setInterval> | null = null
  private closed = false
  private controller = new AbortController()
  private syncing = false
  private joined=false
  private screenRevision=0
  private revision=-1
  private latestState: CallState | null = null
  private lastHeartbeat = 0
  private screenPending = false
  private earlySignals: CallSignal[] = []
  constructor(private api: VoxholdApi, private token: string, readonly conversationId: number, private userId: number, private callbacks: { state: (v: CallState) => void; media: (userId: number, stream: MediaStream) => void; removed: (userId: number) => void; error: (message: string) => void; screen: (active: boolean) => void; ended: () => void }) {}
  setToken(token: string) { this.token = token }
  async start() {
    const preferences = loadVoicePreferences()
    const microphone = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: preferences.echoCancellation, noiseSuppression: preferences.noiseSuppression, autoGainControl: preferences.autoGainControl, ...(preferences.inputDeviceId ? { deviceId: { exact: preferences.inputDeviceId } } : {}) }, video: false })
    if (this.closed) { microphone.getTracks().forEach((t) => t.stop()); return }
    this.microphone = microphone
    try {
      this.configuration = parseWebRTCConfig(await this.api.webrtc.config(this.token, this.controller.signal))
      if (this.closed) return
      // Let an in-flight join finish so a close can remove a lease committed
      // after the first DELETE. Aborting it can leave a ghost call for 45s.
      const state = await this.api.community.request<CallState>(this.token, `/conversations/${this.conversationId}/call`, 'PUT', { session_id: this.sessionId, replace:true })
      if (this.closed) { await this.leaveRemote(); return }
      this.joined = true; this.lastHeartbeat = Date.now()
      this.update(this.latestState && this.latestState.revision > state.revision && this.latestState.revision > this.revision ? this.latestState : state)
      if (this.closed) return
      this.heartbeat = setInterval(() => { void this.refresh() }, 12_000)
    } catch (e) { this.close(); void this.leaveRemote(); throw e }
  }
  private async refresh() {
    if (this.closed || this.syncing) return
    this.syncing = true
    const requestedToken = this.token
    try { const state = await this.api.community.request<CallState>(this.token, `/conversations/${this.conversationId}/call`, 'PUT', { session_id: this.sessionId }, this.controller.signal); if (!this.closed) { this.lastHeartbeat = Date.now(); this.update(state) } }
    catch (e) {
      if (!this.closed) {
        if (e instanceof ApiError && e.status === 401 && requestedToken !== this.token) return
        const transient = e instanceof ApiError && (e.status === 0 || e.status === 401 || e.status === 408 || e.status === 429 || e.status >= 500)
        if (transient && Date.now() - this.lastHeartbeat < 40_000) return
        this.callbacks.error(e instanceof Error ? e.message : 'Звонок недоступен'); this.close(); this.callbacks.ended()
      }
    }
    finally { this.syncing = false }
  }
  update(state: CallState) {
    if (this.closed || state.conversation_id !== this.conversationId || state.revision < this.revision) return
    if (!this.latestState || state.revision >= this.latestState.revision) this.latestState = state
    const mine = state.members.find((m) => m.user_id === this.userId)
    if (!mine || mine.session_id !== this.sessionId) { if(this.joined){this.close();this.callbacks.ended()} return }
    this.revision=state.revision
    const remote = state.members.filter((m) => m.user_id !== this.userId)
    for (const [id, peer] of this.peers) if (!remote.some((m) => m.user_id === id && m.session_id === peer.member.session_id)) { peer.pc.close(); this.peers.delete(id); this.callbacks.removed(id) }
    for (const member of remote) if (!this.peers.has(member.user_id)) this.addPeer(member)
    this.callbacks.state(state)
    for (const signal of this.earlySignals.splice(0)) this.signal(signal)
  }
  private addPeer(member: CallMember) {
    const pc = new RTCPeerConnection(this.configuration)
    const peer: Peer = { member, pc, makingOffer: false, ignoreOffer: false, settingAnswer: false, pending: [], serial: Promise.resolve(), media:new MediaStream(), screenSharing:false, screenRevision:-1 }
    this.peers.set(member.user_id, peer)
    const media = peer.media
    pc.ontrack = ({ track }) => { if(track.kind!=='video'||peer.screenSharing)media.addTrack(track); this.callbacks.media(member.user_id, media); const remove = () => { media.removeTrack(track); this.callbacks.media(member.user_id, media) }; track.onended = remove; track.onmute = () => { if (track.kind === 'video') remove() }; track.onunmute = () => { if (!media.getTracks().includes(track)) if(track.kind!=='video'||peer.screenSharing)media.addTrack(track); this.callbacks.media(member.user_id, media) } }
    pc.onicecandidate = ({ candidate }) => { if (candidate) void this.send(peer, { candidate: candidate.toJSON() }).catch((e: unknown) => this.report(e)) }
    pc.onnegotiationneeded = async () => {
      if (this.closed) return
      try { peer.makingOffer = true; await pc.setLocalDescription(); if (pc.localDescription) await this.send(peer, { description: pc.localDescription.toJSON() }) }
      catch (e) { this.report(e) } finally { peer.makingOffer = false }
    }
    pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed' && !this.closed) { this.callbacks.error(`Нет соединения с ${member.username}. Проверьте доступность TURN-сервера.`); pc.restartIce() } }
    void this.send(peer,{media:{screen:!!this.screen,revision:this.screenRevision}}).catch((e:unknown)=>this.report(e))
    for (const stream of [this.microphone, this.screen]) if (stream) for (const track of stream.getTracks()) pc.addTrack(track, stream)
  }
  private async send(peer: Peer, data: { candidate?: RTCIceCandidateInit; description?: RTCSessionDescriptionInit; media?:{screen:boolean;revision:number} }) {
    for(let attempt=0;attempt<4;attempt++){
      if(this.closed)return
      const requestedToken = this.token
      try{return await this.api.community.request(this.token, `/conversations/${this.conversationId}/call/signal`, 'POST', { session_id: this.sessionId, target_user_id: peer.member.user_id, target_session_id: peer.member.session_id, ...data }, this.controller.signal)}
      catch(error){if(this.closed)return;if(error instanceof ApiError && error.status===401 && requestedToken!==this.token)continue;if(!(error instanceof ApiError)||![0,401,429,502,503,504].includes(error.status)||attempt===3)throw error;await new Promise<void>((resolve)=>setTimeout(resolve,1000*(attempt+1)))}
    }
  }
  signal(value: CallSignal) {
    if (this.closed || value.conversation_id !== this.conversationId || value.target_session_id !== this.sessionId) return
    const peer = this.peers.get(value.from_user_id)
    if (!peer) { if (this.earlySignals.length < 128) this.earlySignals.push(value); return }
    if (peer.member.session_id !== value.session_id) return
    const target = peer
    target.serial = target.serial.then(async () => {
      const pc = target.pc
      if (this.closed || pc.signalingState === 'closed') return
      if(value.media){
        if(value.media.revision<target.screenRevision)return
        target.screenRevision=value.media.revision;target.screenSharing=value.media.screen
        for(const receiver of pc.getReceivers()){const track=receiver.track;if(track.kind==='video'){if(target.screenSharing&&track.readyState==='live'&&!target.media.getTracks().includes(track))target.media.addTrack(track);if(!target.screenSharing)target.media.removeTrack(track)}}
        this.callbacks.media(target.member.user_id,target.media)
      } else if (value.description) {
        if(pc.remoteDescription?.type===value.description.type&&pc.remoteDescription.sdp===value.description.sdp)return
        const ready = !target.makingOffer && (pc.signalingState === 'stable' || target.settingAnswer)
        const collision = value.description.type === 'offer' && !ready
        target.ignoreOffer = this.userId < target.member.user_id && collision
        if (target.ignoreOffer) return
        if (collision && pc.signalingState !== 'stable') await pc.setLocalDescription({ type: 'rollback' })
        target.settingAnswer = value.description.type === 'answer'
        await pc.setRemoteDescription(value.description); target.settingAnswer = false
        for (const candidate of target.pending.splice(0)) await this.addCandidate(target,candidate,false)
        if (value.description.type === 'offer') { await pc.setLocalDescription(); if (pc.localDescription) await this.send(target, { description: pc.localDescription.toJSON() }) }
      } else if (value.candidate) {
        await this.addCandidate(target,value.candidate,true)
      }
    }).catch((e: unknown) => { target.settingAnswer = false; this.report(e) })
  }
  private async addCandidate(peer:Peer,candidate:RTCIceCandidateInit,queue:boolean){
    const description=peer.pc.remoteDescription
    // HTTP responses and trickle ICE may arrive in a different order. In
    // particular, glare can deliver valid answer candidates before the answer.
    // Preserve them, then discard candidates belonging to a rolled-back offer.
    if(!description || candidate.usernameFragment && !description.sdp.includes(`a=ice-ufrag:${candidate.usernameFragment}`)){
      if(queue && peer.pending.length<256)peer.pending.push(candidate)
      return
    }
    try{await peer.pc.addIceCandidate(candidate)}catch(error){if(!peer.ignoreOffer)throw error}
  }
  private report(e: unknown) { if (!this.closed) this.callbacks.error(e instanceof Error ? e.message : 'Ошибка соединения звонка') }
  mute(muted: boolean) { this.microphone?.getAudioTracks().forEach((track) => { track.enabled = !muted }) }
  async shareScreen() {
    if (this.screenPending) return
    if (this.screen) { this.stopScreen(); return }
    this.screenPending = true
    try {
      const stream = await captureScreen(loadStreamPreferences())
      if (this.closed) { stream.getTracks().forEach((t) => t.stop()); return }
      this.screen = stream; this.screenRevision++
      for (const peer of this.peers.values()) void this.send(peer, { media: { screen: true, revision: this.screenRevision } }).catch((e: unknown) => this.report(e))
      for (const peer of this.peers.values()) for (const track of stream.getTracks()) peer.pc.addTrack(track, stream)
      stream.getVideoTracks()[0]?.addEventListener('ended', () => { if (this.screen === stream) this.stopScreen() }, { once: true })
      this.callbacks.screen(true)
    } finally { this.screenPending = false }
  }
  private stopScreen() {
    const stream = this.screen; if (!stream) return; this.screen = null;this.screenRevision++
    for(const peer of this.peers.values())void this.send(peer,{media:{screen:false,revision:this.screenRevision}}).catch((e:unknown)=>this.report(e))
    for (const peer of this.peers.values()) for (const sender of peer.pc.getSenders()) if (sender.track && stream.getTracks().includes(sender.track)) peer.pc.removeTrack(sender)
    stream.getTracks().forEach((t) => t.stop()); this.callbacks.screen(false)
  }
  private async leaveRemote() {
    await this.api.community.request(this.token, `/conversations/${this.conversationId}/call`, 'DELETE', { session_id: this.sessionId }).catch(() => undefined)
  }
  close() {
    if (this.closed) return
    this.closed = true; this.controller.abort(); if (this.heartbeat) clearInterval(this.heartbeat); this.heartbeat = null
    for (const peer of this.peers.values()) peer.pc.close(); this.peers.clear()
    this.microphone?.getTracks().forEach((t) => t.stop()); this.microphone = null; this.stopScreen()
    this.earlySignals = []
    void this.leaveRemote()
  }
}
