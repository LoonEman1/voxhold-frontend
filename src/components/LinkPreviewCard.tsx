import type { ReactNode } from 'react'
import type { LinkPreview } from '../domain/community'
import './message-links.css'

export function LinkPreviewCard({ href, preview, children }: { href: string; preview?: LinkPreview; children?: ReactNode }) {
  const host = new URL(href).hostname
  return <a className="link-preview" href={href} target="_blank" rel="noopener noreferrer nofollow ugc" referrerPolicy="no-referrer">
    {children}<span><small>{preview?.site_name ?? host}</small><b>{preview?.title ?? host}</b><span>{preview?.description}</span><small>{host}</small></span>
  </a>
}

export function LinkPreviewPlaceholders({ links }: { links: string[] }) {
  return <div className="message-link-previews">{links.map((href) => <LinkPreviewCard key={href} href={href}/>)}</div>
}
