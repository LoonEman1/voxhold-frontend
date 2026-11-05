import { Suspense, lazy, useState, type ComponentProps, type ReactNode } from 'react'
import type * as Features from './CommunityFeatures'
import { ComposerAttachmentButton } from './ComposerActions'
import '../styles/composer-tools.css'

export { featuresChanged, openForward, saveFavorite } from '../services/communityEvents'

const LazyComposerTools = lazy(() => import('./CommunityFeatures').then((module) => ({ default: module.ComposerTools })))
const LazyPollCard = lazy(() => import('./CommunityFeatures').then((module) => ({ default: module.PollCard })))
const LazyEventsView = lazy(() => import('./ServerEventsView').then((module) => ({ default: module.EventsView })))
const LazyAuditView = lazy(() => import('./AuditView').then((module) => ({ default: module.AuditView })))
const LazyScheduledHistory = lazy(() => import('./ScheduledMessages').then((module) => ({ default: module.ScheduledHistory })))
const LazyDesktopNotificationSettings = lazy(() => import('./CommunityFeatures').then((module) => ({ default: module.DesktopNotificationSettings })))
const LazyUniversalForward = lazy(() => import('./CommunityFeatures').then((module) => ({ default: module.UniversalForward })))
const loading = <p role="status">Загружаем…</p>

/** The plain chat needs only the launcher buttons, until a tool is opened. */
export function ComposerTools({ children, onAttach, attachmentDisabled, disabled, onScheduled, ...props }: ComponentProps<typeof Features.ComposerTools> & {
  children: (controls: { attachmentButton: ReactNode; onSchedule: () => void }) => ReactNode
  onAttach: () => void; attachmentDisabled?: boolean; disabled?: boolean; onScheduled: () => void
}) {
  const [mode, setMode] = useState<'poll' | 'schedule' | null>(null)
  return <>{children({ attachmentButton: <ComposerAttachmentButton onAttach={onAttach} attachmentDisabled={attachmentDisabled} disabled={disabled} onPoll={() => setMode('poll')} onSchedule={() => setMode('schedule')} onScheduled={onScheduled}/>, onSchedule: () => setMode('schedule') })}
    {mode && <Suspense fallback={loading}><LazyComposerTools key={mode} {...props} initialMode={mode} onClose={() => setMode(null)}/></Suspense>}
  </>
}

export function ScheduledHistory(props: ComponentProps<typeof LazyScheduledHistory>) { return <Suspense fallback={<div className="scheduled-history">{loading}</div>}><LazyScheduledHistory {...props}/></Suspense> }

export function PollCard(props: ComponentProps<typeof Features.PollCard>) { return <Suspense fallback={loading}><LazyPollCard {...props}/></Suspense> }
export function EventsView(props: ComponentProps<typeof LazyEventsView>) { return <Suspense fallback={loading}><LazyEventsView {...props}/></Suspense> }
export function AuditView(props: ComponentProps<typeof LazyAuditView>) { return <Suspense fallback={loading}><LazyAuditView {...props}/></Suspense> }
export function DesktopNotificationSettings() { return <Suspense fallback={loading}><LazyDesktopNotificationSettings/></Suspense> }
export function UniversalForward(props: ComponentProps<typeof Features.UniversalForward>) { return <Suspense fallback={loading}><LazyUniversalForward {...props}/></Suspense> }
