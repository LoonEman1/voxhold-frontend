import { safeImageBlob } from '../lib/safeBlob'
import { Fragment, useEffect, useMemo, useState } from 'react'
import { textLinks } from '../lib/links'
import { useVisible } from '../hooks/useVisible'
import { useCommunity } from './Community'
import { attachmentDownload } from '../services/attachmentDownloads'
import type { VoxholdApi } from '../services/api'
import type { LinkPreview } from '../domain/community'
import './message-links.css'

export function LinkText({ text }: { text: string }) {
  let offset = 0
  const parts = textLinks(text).map((link) => {
    const before = text.slice(offset, link.start); offset = link.end
    return <Fragment key={link.start}>{before}<a className="message-link" href={link.href} target="_blank" rel="noopener noreferrer nofollow ugc" referrerPolicy="no-referrer">{link.text}</a></Fragment>
  })
  return <>{parts}{text.slice(offset)}</>
}

function PreviewImage({ api, token, path }: { api: VoxholdApi; token: string; path: string }) {
  const [url, setURL] = useState('')
  useEffect(() => {
    if (!/^\/api\/v1\/link-preview\/images\/[a-f0-9]{64}$/.test(path)) return
    const controller = new AbortController(); let objectURL = ''
    void attachmentDownload(controller.signal, () => api.linkPreviews.image(token, path, controller.signal)).then((blob) => {
      if (!controller.signal.aborted) { objectURL = URL.createObjectURL(safeImageBlob(blob)); setURL(objectURL) }
    }).catch(() => undefined)
    return () => { controller.abort(); if (objectURL) URL.revokeObjectURL(objectURL) }
  }, [api, token, path])
  return url ? <img src={url} alt="" loading="lazy"/> : null
}
export function MessageLinkPreviews({ content }: { content: string }) {
  const context = useCommunity(), { ref, visible } = useVisible<HTMLDivElement>()
  const api = context?.api, token = context?.token
  const links = useMemo(() => [...new Set(textLinks(content).filter((l) => l.href.startsWith('https://')).map((l) => l.href))].slice(0, 2), [content])
  const [previews, setPreviews] = useState<LinkPreview[]>([])
  useEffect(() => {
    setPreviews([])
    if (!visible || !api || !token || !links.length) return
    const controller = new AbortController()
    void Promise.all(links.map((href) => attachmentDownload(controller.signal, async () => {
      const value = await api.linkPreviews.get(token, href, controller.signal)
      if (!value || typeof value.title !== 'string') return null
      const requested = new URL(href), returned = new URL(value.url)
      requested.hash = ''; returned.hash = ''
      return requested.href === returned.href ? { ...value, url: href } : null
    }).catch(() => null))).then((values) => {
      if (!controller.signal.aborted) setPreviews(values.filter((value): value is LinkPreview => !!value))
    })
    return () => controller.abort()
  }, [api, token, visible, links])
  if (!links.length) return null
  return <div ref={ref} className="message-link-previews">{previews.map((preview) => <a key={preview.url} className="link-preview" href={preview.url} target="_blank" rel="noopener noreferrer nofollow ugc" referrerPolicy="no-referrer">
    {api && token && preview.image_path && <PreviewImage api={api} token={token} path={preview.image_path}/>}<span><small>{preview.site_name}</small><b>{preview.title}</b>{preview.description && <span>{preview.description}</span>}<small>{new URL(preview.url).hostname}</small></span>
  </a>)}</div>
}
