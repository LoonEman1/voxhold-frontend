import { ThemeProvider } from '../../src/theme/ThemeContext'
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Avatar } from '../../src/components/Avatar'
import { AvatarProvider } from '../../src/components/AvatarProvider'
import { CallControls } from '../../src/components/CallControls'
import { RecordingsDialog } from '../../src/components/RecordingsDialog'
import { ProfileDialog } from '../../src/components/WorkspaceDialogs'
import { createApi } from '../../src/services/api'
import { createFetchTransport } from '../../src/platform/transport'
import type { ChannelRecording, Profile } from '../../src/domain/types'
import '../../src/styles/global.css'

const api = createApi(createFetchTransport())
const fixtureApi = { ...api, profile: { ...api.profile, avatar: async () => new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#a993ff"/><circle cx="32" cy="25" r="12" fill="#272722"/></svg>'], { type: 'image/svg+xml' }) } }
const now = Math.floor(Date.now() / 1000)
const record: ChannelRecording = { id: 'fixture', server_id: 1, channel_id: 7, owner_user_id: 1, owner_username: 'Александр', status: 'uploading', mime_type: 'video/webm', size_bytes: 4600000, duration_ms: 38000, created_at: now, updated_at: now, expires_at: now + 86400 }
const profile = { user_id: 1, username: 'Александр', about: '', country_code: '', created_at: now } as Profile
function Fixture() {
  const [dialog, setDialog] = useState('')
  const [version, setVersion] = useState('fixture')
  const [active, setActive] = useState(true)
  return <AvatarProvider api={fixtureApi} token="fixture" versions={new Map(version ? [[1, version]] : [])}>
    <main style={{ display: 'flex', height: '100vh' }}>
      <aside className="channel-sidebar" style={{ width: 260, padding: 16 }}><b>FirstInstance</b><div className="channel-row is-active" style={{ marginTop: 24 }}><button className="channel-row__main"><span>первый-голосовой</span><span className="record-dot is-active" title="Канал записывается"/><i>1</i></button></div><div className="user-dock"><button className="user-dock__profile" onClick={() => setDialog('profile')}><Avatar userId={1} name="Александр" online/><span><b>Александр</b><small>В сети</small></span></button></div></aside>
      <section className="voice-stage-layout"><div className="voice-room"><header className="voice-stage-status"><span>Голосовая связь установлена</span></header><div className="voice-stage-content"><button className="voice-participant"><div className="voice-participant__avatar"><Avatar userId={1} name="Александр"/></div><span><b>Александр</b></span></button></div><footer className="voice-stage-footer"><CallControls selfMute={false} selfDeaf={false} recording={active} recordBusy={false} canRecord canShare chatOpen={false} onMute={() => {}} onDeaf={() => {}} onRecord={() => setActive(!active)} onRecordings={() => setDialog('records')} onChat={() => {}} onShare={() => {}} onLeave={() => {}}/></footer><button className="button" onClick={() => setDialog('profile')}>Профиль</button></div></section>
      <aside className="members-sidebar" style={{ width: 220 }}><header>УЧАСТНИКИ · 2</header><div className="member-group">{['Александр', 'ОченьДлинноеИмяУчастника'].map((name, index) => <button key={name} className="member-row"><Avatar userId={index ? undefined : 1} name={name} size="small" online={!index}/><span><b>{name}</b><small>Владелец сервера</small></span></button>)}</div></aside>
    </main>
    <RecordingsDialog open={dialog === 'records'} onClose={() => setDialog('')} records={[record]} locals={[{ key: 'scope:fixture', scope: 'scope', record, bytes: record.size_bytes, chunks: 1, duration: 38000, finished: true }]} serverId={1} progress={{}} voiceActive onDownload={async () => {}} onRemoveLocal={async () => {}} onRetry={() => {}} channels={[{ id: 7, name: 'первый-голосовой' } as never]}/>
    <ProfileDialog open={dialog === 'profile'} profile={profile} hasAvatar={!!version} onClose={() => setDialog('')} onSubmit={async () => {}} onAvatar={async (file, crop) => { if (file) setVersion((await api.profile.uploadAvatar('fixture', file, crop)).etag); else { await api.profile.removeAvatar('fixture'); setVersion('') } }}/>
  </AvatarProvider>
}
createRoot(document.getElementById('root')!).render(<ThemeProvider><Fixture/></ThemeProvider>)
