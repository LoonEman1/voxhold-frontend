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
import { ApiError, type VoxholdApi } from '../services/api'
import { onUnauthorized } from '../services/authEvents'
import { clientDiagnostics } from '../platform/clientDiagnostics'

const STORAGE_KEY = 'voxhold.session.v1'
const REFRESH_MARGIN_SECONDS = 5 * 60

type PersistedAuth = AuthPayload

interface AuthContextValue {
  user: User | null
  token: string | null
  ready: boolean
  login(username: string, password: string): Promise<void>
  register(username: string, password: string, confirmation: string, inviteToken: string): Promise<void>
  logout(): Promise<void>
  expire(expectedToken?: string): void
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
  const generation = useRef(0)
  const mounted = useRef(false)
  const refreshFlight = useRef<{ token: string; promise: Promise<void> } | null>(null)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])

  useEffect(() => {
    clientDiagnostics.setToken(auth?.session.token ?? null)
  }, [auth?.session.token])

  const apply = useCallback((next: PersistedAuth | null, write: boolean) => {
    generation.current += 1
    authRef.current = next
    setAuth(next)
    if (write) {
      if (next) storage.write(STORAGE_KEY, next)
      else storage.remove(STORAGE_KEY)
    }
  }, [storage])
  const persist = useCallback((next: PersistedAuth | null) => apply(next, true), [apply])
  useEffect(() => storage.subscribe?.(STORAGE_KEY, () => apply(storage.read<PersistedAuth>(STORAGE_KEY), false)), [storage, apply])

  const expireNow = useCallback((expectedToken?: string) => {
    if (expectedToken && authRef.current?.session.token !== expectedToken) return
    // Another tab may already have rotated this request's token before its
    // storage notification reaches us. Adopt that generation instead.
    const saved = storage.read<PersistedAuth>(STORAGE_KEY)
    if (expectedToken && saved && saved.session.token !== expectedToken) apply(saved, false)
    else persist(null)
  }, [storage, apply, persist])

  const expire = useCallback((expectedToken?: string) => {
    if (!expectedToken) { expireNow(); return }
    if (authRef.current?.session.token !== expectedToken) return
    // Rotation revokes the old token before its response has been persisted.
    const settle = () => { if (mounted.current) expireNow(expectedToken) }
    const flight = refreshFlight.current
    if (flight?.token === expectedToken) { void flight.promise.then(settle, settle); return }
    if (storage.withLock) { void storage.withLock(STORAGE_KEY, async () => settle()).catch(settle); return }
    settle()
  }, [storage, expireNow])

  useEffect(() => onUnauthorized((token) => expire(token)), [expire])

  // One scheduler owns startup and renewal. StrictMode may replay this effect;
  // reuse the in-flight rotation and apply it only to its original generation.
  useEffect(() => {
    if (!auth) { setReady(true); return }
    if (auth.session.expires_at * 1000 <= Date.now()) { expireNow(auth.session.token); setReady(true); return }
    let timer = 0
    let retryDelay = 1_000
    let expiryTimer = 0
    const checkExpiry = () => {
      const left = auth.session.expires_at * 1000 - Date.now()
      if (left <= 0) { expireNow(auth.session.token); return }
      expiryTimer = window.setTimeout(checkExpiry, Math.min(left, 24 * 60 * 60 * 1000))
    }
    checkExpiry()
    const schedule = () => {
      const remaining = (auth.session.expires_at - REFRESH_MARGIN_SECONDS) * 1000 - Date.now()
      if (remaining > 0) {
        setReady(true)
        timer = window.setTimeout(schedule, Math.min(remaining, 24 * 60 * 60 * 1000))
        return
      }
      if (refreshFlight.current?.token === auth.session.token) return
      const sourceGeneration = generation.current
      const token = auth.session.token
      const current = () => mounted.current && generation.current === sourceGeneration && authRef.current?.session.token === token
      const rotate = async () => {
        if (!current()) return
        const saved = storage.read<PersistedAuth>(STORAGE_KEY)
        if (saved?.session.token !== token) { if (current()) apply(saved, false); return }
        const session = await api.auth.refresh(token)
        if (current()) persist({ ...auth, session })
      }
      const promise = (storage.withLock ? storage.withLock(STORAGE_KEY, rotate) : rotate()).catch((error: unknown) => {
        if (!current()) return
        const transient = error instanceof ApiError && (error.status === 0 || error.status === 408 || error.status === 429 || error.status >= 500)
        const remaining = auth.session.expires_at * 1000 - Date.now()
        if (!transient || remaining <= 0) { expireNow(token); return }
        timer = window.setTimeout(schedule, Math.min(retryDelay, remaining))
        retryDelay = Math.min(retryDelay * 2, 30_000)
      }).finally(() => {
        if (refreshFlight.current?.promise === promise) refreshFlight.current = null
        if (mounted.current) setReady(true)
      })
      refreshFlight.current = { token, promise }
    }
    schedule()
    return () => { window.clearTimeout(timer); window.clearTimeout(expiryTimer) }
  }, [api, auth, expireNow, persist, storage, apply])

  const login = useCallback(
    async (username: string, password: string) => {
      persist(null)
      const request = generation.current
      const next = await api.auth.login(username, password)
      if (mounted.current && generation.current === request) persist(next)
    },
    [api, persist],
  )
  const register = useCallback(
    async (username: string, password: string, confirmation: string, inviteToken: string) => {
      persist(null)
      const request = generation.current
      const next = await api.auth.register(username, password, confirmation, inviteToken)
      if (mounted.current && generation.current === request) persist(next)
    },
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
