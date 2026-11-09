import { safeImageBlob } from '../lib/safeBlob'
import { Fragment, useEffect, useMemo, useState } from 'react'
import { previewLinks, textLinks } from '../lib/links'
import { LinkPreviewCard } from './LinkPreviewCard'
import { useVisible } from '../hooks/useVisible'
import { retryBusy } from '../lib/retryBusy'
import { useCommunity } from './Community'
import { attachmentDownload } from '../services/attachmentDownloads'
import type { VoxholdApi } from '../services/api'
import type { LinkPreview } from '../domain/community'

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
    void attachmentDownload(controller.signal, () => retryBusy(controller.signal, () => api.linkPreviews.image(token, path, controller.signal))).then((blob) => {
      if (!controller.signal.aborted) { objectURL = URL.createObjectURL(safeImageBlob(blob)); setURL(objectURL) }
    }).catch(() => undefined)
    return () => { controller.abort(); if (objectURL) URL.revokeObjectURL(objectURL) }
  }, [api, token, path])
  return url ? <img src={url} alt="" loading="lazy"/> : null
}
export function MessageLinkPreviews({ content }: { content: string }) {
  const context = useCommunity(), { ref, visible } = useVisible<HTMLDivElement>()
  const api = context?.api, token = context?.token
  const links = useMemo(() => previewLinks(content), [content])
  const [previews, setPreviews] = useState<LinkPreview[]>([])
  useEffect(() => {
    setPreviews([])
    if (!visible || !api || !token || !links.length) return
    const controller = new AbortController()
    for (const href of links) {
      void attachmentDownload(controller.signal, () => retryBusy(controller.signal, () => api.linkPreviews.get(token, href, controller.signal))).then((value) => {
        if (controller.signal.aborted || !value || typeof value.title !== 'string') return
        const requested = new URL(href), returned = new URL(value.url)
        requested.hash = ''; returned.hash = ''
        if (requested.href === returned.href) setPreviews((current) => [...current, { ...value, url: href }])
      }).catch(() => undefined)
    }
    return () => controller.abort()
  }, [api, token, visible, links])
  if (!links.length) return null
  // One fixed-size slot per URL, from the first render through failures and
  // late image downloads. Metadata must never change the history geometry.
  return <div ref={ref} className="message-link-previews">{links.map((href) => {
    const preview = previews.find((value) => value.url === href)
    return <LinkPreviewCard key={href} href={href} preview={preview}>
      {api && token && preview?.image_path && <PreviewImage api={api} token={token} path={preview.image_path}/>}
    </LinkPreviewCard>
  })}</div>
}
