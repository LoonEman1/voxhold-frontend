// Process-wide notification channel for authentication loss detected at the
// transport layer. The API module must stay decoupled from React, so instead
// of importing the auth context it emits an event; AuthProvider subscribes
// and expires the local session exactly once per 401.
type Listener = () => void

const listeners = new Set<Listener>()

export function notifyUnauthorized(): void {
  listeners.forEach((listener) => listener())
}

export function onUnauthorized(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
