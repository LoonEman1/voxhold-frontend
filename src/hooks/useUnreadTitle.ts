import { useEffect } from 'react'

const BASE_TITLE = 'Voxhold'

/** Builds the tab title: "(N) Voxhold" for mentions, "• Voxhold" for plain unread. */
export function unreadTitle(count: number, mentions: number): string {
  if (mentions > 0) return `(${mentions > 99 ? '99+' : mentions}) ${BASE_TITLE}`
  if (count > 0) return `• ${BASE_TITLE}`
  return BASE_TITLE
}

/** Reflects unread state in the tab title and, where supported, the app badge. */
export function useUnreadTitle(count: number, mentions: number) {
  useEffect(() => {
    document.title = unreadTitle(count, mentions)
    const badge = mentions > 0 ? mentions : count
    // The badge promise rejects outside installed apps (e.g. NotAllowedError);
    // left unhandled it would be reported as a client error on every change.
    try {
      const update = badge > 0 ? navigator.setAppBadge?.(badge) : navigator.clearAppBadge?.()
      void update?.catch(() => undefined)
    } catch { /* badge API is optional */ }
  }, [count, mentions])
  useEffect(() => () => { document.title = BASE_TITLE }, [])
}
