import { Suspense, lazy, useState, type ComponentProps } from 'react'
import type * as Features from './CommunityFeatures'
import { Icon } from './Icon'
import '../styles/composer-tools.css'

export { featuresChanged, openForward, saveFavorite } from '../services/communityEvents'

const LazyComposerTools = lazy(() => import('./CommunityFeatures').then((module) => ({ default: module.ComposerTools })))
const LazyPollCard = lazy(() => import('./CommunityFeatures').then((module) => ({ default: module.PollCard })))
const LazyEventsView = lazy(() => import('./ServerEventsView').then((module) => ({ default: module.EventsView })))
const LazyAuditView = lazy(() => import('./AuditView').then((module) => ({ default: module.AuditView })))
const ScheduledMessagesDialog = lazy(() => import('./ScheduledMessages').then((module) => ({ default: module.ScheduledMessagesDialog })))
const LazyDesktopNotificationSettings = lazy(() => import('./CommunityFeatures').then((module) => ({ default: module.DesktopNotificationSettings })))
const LazyUniversalForward = lazy(() => import('./CommunityFeatures').then((module) => ({ default: module.UniversalForward })))
const loading = <p role="status">Загружаем…</p>

/** The plain chat needs only the launcher buttons, until a tool is opened. */
export function ComposerTools(props: ComponentProps<typeof Features.ComposerTools>) {
  const [mode, setMode] = useState<'poll' | 'schedule' | null>(null)
  const [scheduled, setScheduled] = useState(false)
  return <><div className="composer-tools"><button type="button" onClick={() => setMode('poll')}>Опрос</button><button type="button" onClick={() => setMode('schedule')}>Отложить сообщение</button><button type="button" aria-label="Отложенные сообщения этого чата" onClick={() => setScheduled(true)}><Icon name="clock" size={14}/>Отложенные</button></div>
    {mode && <Suspense fallback={loading}><LazyComposerTools key={mode} {...props} initialMode={mode} onClose={() => setMode(null)}/></Suspense>}
    {scheduled && <Suspense fallback={loading}><ScheduledMessagesDialog api={props.api} token={props.token} destination={props.destination} onClose={() => setScheduled(false)}/></Suspense>}
  </>
}

export function PollCard(props: ComponentProps<typeof Features.PollCard>) { return <Suspense fallback={loading}><LazyPollCard {...props}/></Suspense> }
export function EventsView(props: ComponentProps<typeof LazyEventsView>) { return <Suspense fallback={loading}><LazyEventsView {...props}/></Suspense> }
export function AuditView(props: ComponentProps<typeof LazyAuditView>) { return <Suspense fallback={loading}><LazyAuditView {...props}/></Suspense> }
export function DesktopNotificationSettings() { return <Suspense fallback={loading}><LazyDesktopNotificationSettings/></Suspense> }
export function UniversalForward(props: ComponentProps<typeof Features.UniversalForward>) { return <Suspense fallback={loading}><LazyUniversalForward {...props}/></Suspense> }
