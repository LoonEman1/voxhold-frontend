import { Component, lazy, Suspense, useMemo, type ReactNode } from 'react'
import { previewLinks } from '../lib/links'
import { LinkPreviewPlaceholders } from './LinkPreviewCard'

const Previews = lazy(() => import('./MessageLinks').then((module) => ({ default: module.MessageLinkPreviews })))
class PreviewBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() { return this.state.failed ? this.props.fallback : this.props.children }
}
/** Optional cards load only for a message containing a supported URL. */
export function MessageLinkPreviews({ content }: { content: string }) {
  const links = useMemo(() => previewLinks(content), [content])
  const fallback = <LinkPreviewPlaceholders links={links}/>
  return links.length ? <PreviewBoundary key={content} fallback={fallback}><Suspense fallback={fallback}><Previews content={content}/></Suspense></PreviewBoundary> : null
}
