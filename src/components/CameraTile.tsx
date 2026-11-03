import { useEffect, useRef, useState } from 'react'
import { Icon } from './Icon'
import { Modal } from './Modal'
import { pictureInPictureAvailable, togglePictureInPicture } from '../lib/pictureInPicture'
import '../styles/camera.css'

function CameraVideo({ media, name, mirrored = false }: { media: MediaStream; name: string; mirrored?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const video = ref.current
    if (!video) return
    video.srcObject = media
    void video.play().catch(() => undefined)
    return () => { video.pause(); video.srcObject = null }
  }, [media])
  return <video ref={ref} className={mirrored ? 'is-mirrored' : ''} autoPlay playsInline muted aria-label={`Камера: ${name}`}/>
}
export function CameraTile({ media, name, isMe = false, speaking = false, onContextMenu }: { media: MediaStream; name: string; isMe?: boolean; speaking?: boolean; onContextMenu?: React.MouseEventHandler }) {
  const [expanded, setExpanded] = useState(false)
  const expandedRef = useRef<HTMLDivElement>(null)
  return <><div className={`camera-tile ${speaking ? 'is-speaking' : ''}`} onContextMenu={onContextMenu}>
    <button type="button" className="camera-tile__preview" onClick={() => setExpanded(true)} aria-label={`Развернуть камеру: ${name}`}><CameraVideo media={media} name={name} mirrored={isMe}/><span className="camera-tile__expand"><Icon name="maximize"/>Развернуть</span></button>
    <footer><Icon name="camera" size={14}/><b>{name}</b>{isMe && <small>вы</small>}</footer>
  </div>{expanded && <Modal open title={`Камера · ${name}`} size="medium" className="camera-expanded" onClose={() => setExpanded(false)}><div ref={expandedRef} className="camera-expanded__video"><CameraVideo media={media} name={name} mirrored={isMe}/></div><div className="stream-dialog-actions">{pictureInPictureAvailable() && <button className="button button--ghost" onClick={() => void togglePictureInPicture(expandedRef.current?.querySelector('video') ?? null)}><Icon name="pip"/>Картинка в картинке</button>}<button className="button button--ghost" onClick={() => { void expandedRef.current?.requestFullscreen?.().catch(() => undefined) }}><Icon name="maximize"/>Полный экран</button></div></Modal>}</>
}
