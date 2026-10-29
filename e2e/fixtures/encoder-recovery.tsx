import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserServerStreamSession } from '../../src/services/stream'
import { DEFAULT_STREAM_PREFERENCES } from '../../src/services/streamSettings'

function Fixture() {
  const video = useRef<HTMLVideoElement>(null), dispose = useRef(() => {})
  const [connection, setConnection] = useState('idle'), [errors, setErrors] = useState<string[]>([])
  const [started, setStarted] = useState(false)
  useEffect(() => () => dispose.current(), [])
  const start = async () => {
    setStarted(true)
    const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 360
    const context = canvas.getContext('2d')!
    let picture = 0
    const draw = () => { context.fillStyle = `hsl(${picture++ % 360} 60% 40%)`; context.fillRect(0, 0, 640, 360); context.fillStyle = 'white'; context.font = '40px sans-serif'; context.fillText(String(picture), 80, 180) }
    draw()
    const paint = setInterval(draw, 40)
    // Keep the original capture alive, but emulate a transform that produces
    // one frame and then stops writing frames into its publish track.
    const capture = canvas.captureStream(25), frozen = canvas.captureStream(0)
    const stalled = frozen.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack
    stalled.requestFrame()
    const receiver = new RTCPeerConnection()
    receiver.addTransceiver('video', { direction: 'recvonly' })
    const failures: string[] = []
    const fail = (error: Error) => { failures.push(error.message); setErrors([...failures]) }
    const remote = new MediaStream()
    receiver.ontrack = (event) => { remote.addTrack(event.track); if (video.current) { video.current.srcObject = remote; void video.current.play().catch(fail) } }
    let repairs = 0
    const session: BrowserServerStreamSession = new BrowserServerStreamSession({
      localStream: frozen, preferences: DEFAULT_STREAM_PREFERENCES, codec: 'vp8',
      onConnectionStateChange: setConnection, onError: fail,
      onAnswer: (sdp) => { void receiver.setRemoteDescription({ type: 'answer', sdp }).catch(fail) },
      onICECandidate: (candidate) => { void receiver.addIceCandidate({ candidate: candidate.candidate, sdpMid: candidate.sdp_mid, sdpMLineIndex: candidate.sdp_mline_index, usernameFragment: candidate.username_fragment }).catch(fail) },
      onPublisherStalled: async () => { await session.replacePublisherVideoTrack(capture.getVideoTracks()[0]!); repairs++ },
    })
    receiver.onicecandidate = (event) => { if (event.candidate) void session.addICECandidate({ candidate: event.candidate.candidate, sdp_mid: event.candidate.sdpMid ?? undefined, sdp_mline_index: event.candidate.sdpMLineIndex ?? undefined, username_fragment: event.candidate.usernameFragment ?? undefined }) }
    const originalPeer = (session as unknown as { peer: RTCPeerConnection }).peer
    Object.assign(window, { recoveryProbe: {
      get repairs() { return repairs },
      samePeer: () => (session as unknown as { peer: RTCPeerConnection }).peer === originalPeer && originalPeer.connectionState === 'connected',
      originalCaptureLive: () => capture.getVideoTracks()[0]?.readyState === 'live',
      decoded: async () => { let count = 0; (await receiver.getStats()).forEach((value) => { if (value.type === 'inbound-rtp' && value.kind === 'video') count += value.framesDecoded ?? 0 }); return count },
    } })
    dispose.current = () => { clearInterval(paint); stalled.stop(); session.close(); receiver.close(); capture.getTracks().forEach((track) => track.stop()); frozen.getTracks().forEach((track) => track.stop()) }
    try { const offer = await receiver.createOffer(); await receiver.setLocalDescription(offer); await session.acceptOffer(offer.sdp!) } catch (error) { fail(error as Error) }
  }
  return <><button disabled={started} onClick={() => void start()}>Начать проверку</button><output data-testid="connection">{connection}</output><output data-testid="errors">{errors.join('\n')}</output><video ref={video} muted autoPlay playsInline width={640}/></>
}
createRoot(document.getElementById('root')!).render(<Fixture/>)
