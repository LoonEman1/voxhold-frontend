import { useEffect, useRef, useState } from 'react'
import { humanError } from '../lib/format'

/** A completed request belongs to the dialog opening that submitted it. */
export function useDialogAction(open: boolean, identity?: number) {
  const generation = useRef(0), busy = useRef(false)
  const [pending, setPending] = useState(false), [error, setError] = useState('')
  useEffect(() => {
    const current = ++generation.current
    busy.current = false; setPending(false); setError('')
    return () => { generation.current = current + 1 }
  }, [open, identity])
  const run = async (action: () => Promise<void>, success: () => void) => {
    if (!open || busy.current) return
    const requested = generation.current
    busy.current = true; setPending(true); setError('')
    try { await action(); if (generation.current === requested) success() }
    catch (caught) { if (generation.current === requested) setError(humanError(caught)) }
    finally { if (generation.current === requested) { busy.current = false; setPending(false) } }
  }
  return { pending, error, setError, run }
}
