import { Component, useEffect, useMemo, useState, type ErrorInfo, type ReactNode } from 'react'
import { AuthProvider, useAuth } from './auth/AuthContext'
import { Brand } from './components/Brand'
import { InviteAppPrompt } from './components/InviteAppPrompt'
import { ToastProvider } from './components/Toast'
import { AuthPage } from './pages/AuthPage'
import { WorkspacePage } from './pages/WorkspacePage'
import { browserSessionStorage, createFetchTransport } from './platform/transport'
import { createApi } from './services/api'
import { ThemeProvider } from './theme/ThemeContext'
import type { InviteLinkPreview } from './domain/types'
import { humanError } from './lib/format'
import { createNativeInviteURL } from './lib/inviteLinks'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? ''

function inviteTokenFromLocation() {
  const prefix = '#/invite/'
  if (!window.location.hash.startsWith(prefix)) return null
  const token = window.location.hash.slice(prefix.length).trim()
  return token || null
}

function InviteRoute({ api, inviteToken, authToken, realtimeBaseUrl }: {
  api: ReturnType<typeof createApi>
  inviteToken: string
  authToken: string | null
  realtimeBaseUrl: string
}) {
  const [preview, setPreview] = useState<InviteLinkPreview | null>(null)
  const [error, setError] = useState('')
  const [accepted, setAccepted] = useState(false)
  const [continueInBrowser, setContinueInBrowser] = useState(false)
  const nativeURL = createNativeInviteURL(inviteToken, window.location.origin)

  useEffect(() => {
    const controller = new AbortController()
    setError('')
    setPreview(null)
    setAccepted(false)
    setContinueInBrowser(false)
    void api.inviteLinks.resolve(inviteToken, controller.signal)
      .then(setPreview)
      .catch((caught) => { if (!controller.signal.aborted) setError(humanError(caught)) })
    return () => controller.abort()
  }, [api, inviteToken])

  useEffect(() => {
    if (!continueInBrowser || !authToken || !preview || accepted) return
    let disposed = false
    void api.inviteLinks.accept(authToken, inviteToken)
      .then(() => {
        if (disposed) return
        window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`)
        setAccepted(true)
      })
      .catch((caught) => { if (!disposed) setError(humanError(caught)) })
    return () => { disposed = true }
  }, [accepted, api, authToken, continueInBrowser, inviteToken, preview])

  if (accepted && authToken) return <WorkspacePage api={api} realtimeBaseUrl={realtimeBaseUrl}/>
  if (error) return <main className="invite-gate"><Brand/><span className="eyebrow">ПРИГЛАШЕНИЕ НЕДОСТУПНО</span><h1>Ссылка не сработала</h1><p>{error}</p></main>
  if (!preview) return <div className="app-loader"><Brand/><span>Проверяем приглашение…</span><div className="loader-line"><i/></div></div>
  if (!continueInBrowser) return <>{authToken ? <div className="app-loader"><Brand/><span>Приглашение найдено</span><div className="loader-line"><i/></div></div> : <AuthPage invite={preview} inviteToken={inviteToken}/>}<InviteAppPrompt invite={preview} nativeURL={nativeURL} onStayInBrowser={() => setContinueInBrowser(true)}/></>
  if (authToken) return <div className="app-loader"><Brand/><span>Принимаем приглашение…</span><div className="loader-line"><i/></div></div>
  return <AuthPage invite={preview} inviteToken={inviteToken}/>
}

function AppRouter({ api }: { api: ReturnType<typeof createApi> }) {
  const { ready, token } = useAuth()
  if (!ready) return <div className="app-loader"><Brand/><div className="loader-line"><i/></div></div>
  const inviteToken = inviteTokenFromLocation()
  if (inviteToken) return <InviteRoute api={api} inviteToken={inviteToken} authToken={token} realtimeBaseUrl={API_BASE_URL}/>
  return token ? <WorkspacePage api={api} realtimeBaseUrl={API_BASE_URL}/> : <AuthPage/>
}

class AppErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() { return { failed: true } }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Voxhold render error', error, info)
  }

  render() {
    if (!this.state.failed) return this.props.children
    return <main className="fatal-error"><Brand/><span>Что-то пошло не так</span><h1>Интерфейс потерял нить разговора.</h1><p>Обновите страницу — сессия и сообщения останутся на месте.</p><button className="button button--primary" onClick={() => window.location.reload()}>Обновить страницу</button></main>
  }
}

export default function App() {
  const api = useMemo(() => createApi(createFetchTransport(API_BASE_URL)), [])
  return (
    <AppErrorBoundary>
      <ThemeProvider>
        <ToastProvider>
          <AuthProvider api={api} storage={browserSessionStorage}>
            <AppRouter api={api}/>
          </AuthProvider>
        </ToastProvider>
      </ThemeProvider>
    </AppErrorBoundary>
  )
}
