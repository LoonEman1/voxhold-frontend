import { useCallback, useEffect, useRef, useState, type SetStateAction } from 'react'

function read(key: string) {
  try { const value: unknown = JSON.parse(localStorage.getItem(key) ?? 'null'); return typeof value === 'string' ? value.slice(0, 5120) : '' } catch { return '' }
}

// Drafts belong to an instance/account/destination, never to a rotating token.
// Persist before navigation/unmount; storage failure must not interrupt typing.
export function useDraft(scope: string): [string, (next: SetStateAction<string>) => void] {
  const key = `voxhold.draft.v1:${scope}`
  const [state, setState] = useState(() => ({ key, text: read(key) }))
  const latest = useRef(state)
  const mounted = useRef(false)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  if (latest.current.key !== key) latest.current = { key, text: read(key) }
  const text = state.key === key ? state.text : latest.current.text
  const update = useCallback((next: SetStateAction<string>) => {
    // A send may finish after this composer has unmounted and a replacement
    // composer has written a newer draft for the same destination.
    const current = mounted.current && latest.current.key === key ? latest.current.text : read(key)
    const value = (typeof next === 'function' ? next(current) : next).slice(0, 5120)
    latest.current = { key, text: value }
    try { if (value) localStorage.setItem(key, JSON.stringify(value)); else localStorage.removeItem(key) } catch { /* Keep the in-memory draft. */ }
    if (mounted.current) setState(latest.current)
  }, [key])
  return [text, update]
}
