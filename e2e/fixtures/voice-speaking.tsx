import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { VoicePanel } from '../../src/components/VoicePanel'
import { createMediaActivity, MediaActivityProvider } from '../../src/components/MediaActivity'
import { BrowserVoiceSession } from '../../src/services/voice'
import { BrowserVoiceInput } from '../../src/services/voiceInput'
import { DEFAULT_VOICE_PREFERENCES } from '../../src/services/voiceSettings'
import { DEFAULT_STREAM_PREFERENCES } from '../../src/services/streamSettings'
import type { ServerMember, VoiceParticipant } from '../../src/domain/types'
import '../../src/styles/global.css'
import '../../src/styles/workspace.css'

const channel = { id: 1, server_id: 1, name: 'Voice', kind: 'voice' as const, position: 0, created_by: 1, created_at: 1 }
const members = [1, 2].map((id) => ({ user_id: id, username: id === 1 ? 'Alice' : 'Bob', role: 'member' })) as ServerMember[]
const participants = members.map((member) => ({ connection_id: `conn${member.user_id}`, user_id: member.user_id, channel_id: 1, server_id: 1, self_mute: false, self_deaf: false })) as VoiceParticipant[]
const activity = [createMediaActivity(), createMediaActivity()]
const levels = [new Map<number, number>(), new Map<number, number>()]
const update = (client: number, user: number, level: number) => {
  levels[client]!.set(user, level)
  activity[client]!.speakers.set([...levels[client]!].filter(([, value]) => value >= .07).map(([id]) => id))
}
const gains: GainNode[] = []
async function start() {
  const context = new AudioContext()
  const raw = [0, 1].map((index) => {
    const oscillator = context.createOscillator()
    oscillator.frequency.value = 300 + index * 200
    const gain = context.createGain(); gain.gain.value = 0; gains.push(gain)
    const destination = context.createMediaStreamDestination()
    oscillator.connect(gain); gain.connect(destination); oscillator.start()
    return destination.stream
  })
  let next = 0
  navigator.mediaDevices.getUserMedia = async () => raw[next++]!
  const inputs = [0, 1].map((index) => new BrowserVoiceInput({ onLevel: (value) => update(index, index + 1, value) }))
  await Promise.all(inputs.map((input) => input.start(DEFAULT_VOICE_PREFERENCES)))
  const relays = [new RTCPeerConnection(), new RTCPeerConnection()]
  const sessions = inputs.map((input, index) => new BrowserVoiceSession({
    input,
    onAnswer: (sdp) => { void relays[index]!.setRemoteDescription({ type: 'answer', sdp }) },
    onICECandidate: (candidate) => { void relays[index]!.addIceCandidate({ candidate: candidate.candidate, sdpMid: candidate.sdp_mid, sdpMLineIndex: candidate.sdp_mline_index, usernameFragment: candidate.username_fragment }) },
    onConnectionStateChange: () => undefined,
    onError: (error) => { document.getElementById('result')!.textContent = error.message },
    onRemoteLevels: (remote) => remote.forEach(({ connectionId, level }) => update(index, Number(connectionId.slice(4)), level)),
  }))
  await Promise.all(sessions.map((session) => session.start(false, false, DEFAULT_VOICE_PREFERENCES)))
  await Promise.all(relays.map(async (relay, index) => {
    const other = 1 - index
    const track = inputs[other]!.currentTrack()!
    relay.addTrack(track, inputs[other]!.currentStream()!)
    relay.onicecandidate = (event) => { if (event.candidate) void sessions[index]!.addICECandidate({ candidate: event.candidate.candidate, sdp_mid: event.candidate.sdpMid, sdp_mline_index: event.candidate.sdpMLineIndex, username_fragment: event.candidate.usernameFragment }) }
    const offer = await relay.createOffer()
    await relay.setLocalDescription(offer)
    // Same server track naming as the SFU. Receiver track IDs may differ.
    await sessions[index]!.acceptOffer(offer.sdp!.replaceAll(track.id, `audio-conn${other + 1}`))
  }))
  document.getElementById('result')!.textContent = 'ready'
  window.addEventListener('pagehide', () => { sessions.forEach((session) => session.close()); relays.forEach((relay) => relay.close()); inputs.forEach((input) => input.close()); void context.close() }, { once: true })
}
function Fixture() {
  const [started, setStarted] = useState(false)
  return <main><button disabled={started} onClick={() => { setStarted(true); void start() }}>Connect both clients</button><output id="result"/>{[0, 1].map((index) => <button key={index} onClick={() => { const gain = gains[index]; if (gain) gain.gain.value = gain.gain.value ? 0 : .1 }}>Toggle {index === 0 ? 'Alice' : 'Bob'}</button>)}<div style={{ display: 'flex', height: 550 }}>{[0, 1].map((index) => <section key={index} aria-label={`Client ${index + 1}`} style={{ width: '50%' }}><MediaActivityProvider value={activity[index]!}><VoicePanel channel={channel} activeChannel={channel} participants={participants} members={members} currentUserId={index + 1} connectionStatus="connected" realtimeOnline selfMute={false} selfDeaf={false} error="" onJoin={async () => undefined} onLeave={() => undefined} onToggleMute={() => undefined} onToggleDeaf={() => undefined} onOpenProfile={() => undefined} stream={null} streamStatus="idle" streamError="" streamMedia={null} streamPreferences={DEFAULT_STREAM_PREFERENCES} onStreamPreferencesChange={() => undefined} onOpenStreamSettings={() => undefined} onWatchStream={() => undefined} onLeaveStream={() => undefined} onExpandStream={() => undefined}/></MediaActivityProvider></section>)}</div></main>
}
createRoot(document.getElementById('root')!).render(<Fixture/>)
