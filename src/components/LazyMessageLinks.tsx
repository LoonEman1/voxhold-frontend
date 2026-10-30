import { Component, lazy, Suspense, useMemo, type ReactNode } from 'react'
import { textLinks } from '../lib/links'

const Previews = lazy(() => import('./MessageLinks').then((module) => ({ default: module.MessageLinkPreviews })))
class PreviewBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() { return this.state.failed ? null : this.props.children }
}
/** Optional cards load only for a message containing a supported URL. */
export function MessageLinkPreviews({ content }: { content: string }) {
  const enabled = useMemo(() => textLinks(content).some((link) => link.href.startsWith('https://')), [content])
  return enabled ? <PreviewBoundary key={content}><Suspense fallback={null}><Previews content={content}/></Suspense></PreviewBoundary> : null
}
