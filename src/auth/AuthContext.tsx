import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { AuthPayload, User } from '../domain/types'
import type { SessionStorageAdapter } from '../platform/transport'
import type { VoxholdApi } from '../services/api'
import { clientDiagnostics } from '../platform/clientDiagnostics'

const STORAGE_KEY = 'voxhold.session.v1'
const REFRESH_MARGIN_SECONDS = 5 * 60

interface PersistedAuth extends AuthPayload {}

interface AuthContextValue {
  user: User | null
  token: string | null
  ready: boolean
  login(username: string, password: string): Promise<void>
  register(username: string, password: string, confirmation: string, inviteToken: string): Promise<void>
  logout(): Promise<void>
  expire(): void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({
  api,
  storage,
  children,
}: {
  api: VoxholdApi
  storage: SessionStorageAdapter
  children: ReactNode
}) {
  const [auth, setAuth] = useState<PersistedAuth | null>(() => storage.read<PersistedAuth>(STORAGE_KEY))
  const [ready, setReady] = useState(false)
  const authRef = useRef(auth)
  authRef.current = auth

  useEffect(() => {
    clientDiagnostics.setToken(auth?.session.token ?? null)
  }, [auth?.session.token])

  const persist = useCallback(
    (next: PersistedAuth | null) => {
      authRef.current = next
      setAuth(next)
      if (next) storage.write(STORAGE_KEY, next)
      else storage.remove(STORAGE_KEY)
    },
    [storage],
  )

  const expire = useCallback(() => persist(null), [persist])

  useEffect(() => {
    const current = authRef.current
    if (!current) {
      setReady(true)
      return
    }

    const controller = new AbortController()
    const refresh = async () => {
      const now = Math.floor(Date.now() / 1000)
      if (current.session.expires_at <= now) {
        persist(null)
      } else if (current.session.expires_at - now <= REFRESH_MARGIN_SECONDS) {
        try {
          const session = await api.auth.refresh(current.session.token)
          persist({ ...current, session })
        } catch {
          persist(null)
        }
      }
      if (!controller.signal.aborted) setReady(true)
    }
    void refresh()
    return () => controller.abort()
  }, [api, persist])

  useEffect(() => {
    if (!auth) return
    let timer = 0
    let disposed = false
    const refreshAt = (auth.session.expires_at - REFRESH_MARGIN_SECONDS) * 1000
    const schedule = () => {
      const remaining = refreshAt - Date.now()
      if (remaining > 0) {
        // Browser timers overflow beyond ~24.8 days; wake daily for 30-day sessions.
        timer = window.setTimeout(schedule, Math.min(remaining, 24 * 60 * 60 * 1000))
        return
      }
      void api.auth.refresh(auth.session.token)
        .then((session) => { if (!disposed) persist({ ...auth, session }) })
        .catch(() => { if (!disposed) persist(null) })
    }
    schedule()
    return () => { disposed = true; window.clearTimeout(timer) }
  }, [api, auth, persist])

  const login = useCallback(
    async (username: string, password: string) => persist(await api.auth.login(username, password)),
    [api, persist],
  )
  const register = useCallback(
    async (username: string, password: string, confirmation: string, inviteToken: string) =>
      persist(await api.auth.register(username, password, confirmation, inviteToken)),
    [api, persist],
  )
  const logout = useCallback(async () => {
    const token = authRef.current?.session.token
    persist(null)
    if (token) {
      try {
        await api.auth.logout(token)
      } catch {
        // Local logout is definitive even when the network is unavailable.
      }
    }
  }, [api, persist])

  const value = useMemo<AuthContextValue>(
    () => ({
      user: auth?.user ?? null,
      token: auth?.session.token ?? null,
      ready,
      login,
      register,
      logout,
      expire,
    }),
    [auth, ready, login, register, logout, expire],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside AuthProvider')
  return value
}
