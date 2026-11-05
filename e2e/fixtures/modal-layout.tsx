import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { InviteUserDialog } from '../../src/components/InviteUserDialog'
import { ComposerTools } from '../../src/components/CommunityFeatures'
import { CameraSettingsDialog } from '../../src/components/CameraSettingsDialog'
import { StreamSettingsDialog } from '../../src/components/StreamSettingsDialog'
import { ConfirmDialog } from '../../src/components/ConfirmDialog'
import { VoiceSettingsDialog } from '../../src/components/VoiceSettingsDialog'
import { RecordingsDialog } from '../../src/components/RecordingsDialog'
import { DEFAULT_STREAM_PREFERENCES } from '../../src/services/streamSettings'
import { DEFAULT_VOICE_PREFERENCES } from '../../src/services/voiceSettings'
import { createApi } from '../../src/services/api'
import type { Server } from '../../src/domain/types'
import '../../src/styles/global.css'

const server = { id: 1, name: 'FirstInstance', role: 'owner' } as Server
const now = Math.floor(Date.now() / 1000)
const api = createApi({ request: async <T,>() => ({ status: 200, data: {} as T }) })
const names = ['Приглашения', 'Отложенное сообщение', 'Опрос', 'Камера', 'Трансляция', 'Подтверждение', 'Голос', 'Записи']
function Fixture() {
  const [dialog, setDialog] = useState(''), [stream, setStream] = useState(DEFAULT_STREAM_PREFERENCES), [voice, setVoice] = useState(DEFAULT_VOICE_PREFERENCES)
  const close = () => setDialog('')
  return <main style={{ padding: 24, display: 'flex', flexWrap: 'wrap', gap: 12 }}>
    {names.map((name) => <button key={name} className="button button--secondary" onClick={() => setDialog(name)}>{name}</button>)}
    <InviteUserDialog open={dialog === 'Приглашения'} server={server} onClose={close} onCreateLink={async () => ({ id: 16, token: 'fixture' }) as never} onListLinks={async () => ({ invite_links: [{ id: 15, server_id: 1, created_by: 2, creator_username: 'KOTONY', created_at: now, expires_at: now + 86400, max_uses: 25, use_count: 0, allow_registration: true }], pagination: { has_more: false, next_before_id: null } })} onRevokeLink={async () => undefined}/>
    {(dialog === 'Отложенное сообщение' || dialog === 'Опрос') && <ComposerTools api={api} token="fixture" destination={{ kind: 'channel', server_id: 1, id: 1 }} content="" initialMode={dialog === 'Опрос' ? 'poll' : 'schedule'} onClose={close}/>}
    {dialog === 'Камера' && <CameraSettingsDialog quality="medium" active={false} onApply={async () => undefined} onClose={close}/>}
    {dialog === 'Трансляция' && <StreamSettingsDialog open busy={false} preferences={stream} onChange={setStream} onClose={close} onStart={close}/>}
    <ConfirmDialog open={dialog === 'Подтверждение'} title="Подтвердить действие" description="Убедитесь, что вы хотите продолжить." confirmLabel="Продолжить" onConfirm={async () => undefined} onClose={close}/>
    <VoiceSettingsDialog open={dialog === 'Голос'} preferences={voice} onChange={setVoice} onClose={close} devices={[]} loadingDevices={false} onRefreshDevices={async () => undefined} getInputLevel={() => 0} voiceActive/>
    <RecordingsDialog open={dialog === 'Записи'} onClose={close} records={[]} locals={[]} serverId={1} progress={{}} voiceActive={false} onDownload={async () => undefined} onRemoveLocal={async () => undefined} onRetry={() => undefined}/>
  </main>
}
createRoot(document.getElementById('root')!).render(<Fixture/>)
