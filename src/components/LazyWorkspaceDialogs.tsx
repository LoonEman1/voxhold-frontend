import { lazy, Suspense, type ComponentProps } from 'react'
import type * as DialogTypes from './WorkspaceDialogs'
import type { VoiceSettingsDialog as VoiceDialog } from './VoiceSettingsDialog'
import type { MemberCard as LoadedMemberCard } from './MemberCard'
import { ModalLoading } from './ModalLoading'

const LazyChannelSettingsDialog = lazy(() => import('./WorkspaceDialogs').then((module) => ({ default: module.ChannelSettingsDialog })))
export function ChannelSettingsDialog(props: ComponentProps<typeof DialogTypes.ChannelSettingsDialog>) { return props.open ? <Suspense fallback={<ModalLoading title="Загружаем…" onClose={props.onClose}/>}><LazyChannelSettingsDialog {...props}/></Suspense> : null }

const LazyConfirmDialog = lazy(() => import('./WorkspaceDialogs').then((module) => ({ default: module.ConfirmDialog })))
export function ConfirmDialog(props: ComponentProps<typeof DialogTypes.ConfirmDialog>) { return props.open ? <Suspense fallback={<ModalLoading title="Загружаем…" onClose={props.onClose}/>}><LazyConfirmDialog {...props}/></Suspense> : null }

const LazyCreateChannelDialog = lazy(() => import('./WorkspaceDialogs').then((module) => ({ default: module.CreateChannelDialog })))
export function CreateChannelDialog(props: ComponentProps<typeof DialogTypes.CreateChannelDialog>) { return props.open ? <Suspense fallback={<ModalLoading title="Загружаем…" onClose={props.onClose}/>}><LazyCreateChannelDialog {...props}/></Suspense> : null }

const LazyInviteUserDialog = lazy(() => import('./WorkspaceDialogs').then((module) => ({ default: module.InviteUserDialog })))
export function InviteUserDialog(props: ComponentProps<typeof DialogTypes.InviteUserDialog>) { return props.open ? <Suspense fallback={<ModalLoading title="Загружаем…" onClose={props.onClose}/>}><LazyInviteUserDialog {...props}/></Suspense> : null }

const LazyLogoutConfirmDialog = lazy(() => import('./WorkspaceDialogs').then((module) => ({ default: module.LogoutConfirmDialog })))
export function LogoutConfirmDialog(props: ComponentProps<typeof DialogTypes.LogoutConfirmDialog>) { return props.open ? <Suspense fallback={<ModalLoading title="Загружаем…" onClose={props.onClose}/>}><LazyLogoutConfirmDialog {...props}/></Suspense> : null }

const LazyMemberProfileDialog = lazy(() => import('./WorkspaceDialogs').then((module) => ({ default: module.MemberProfileDialog })))
export function MemberProfileDialog(props: ComponentProps<typeof DialogTypes.MemberProfileDialog>) { return props.open ? <Suspense fallback={<ModalLoading title="Загружаем…" onClose={props.onClose}/>}><LazyMemberProfileDialog {...props}/></Suspense> : null }

const LazyProfileDialog = lazy(() => import('./WorkspaceDialogs').then((module) => ({ default: module.ProfileDialog })))
export function ProfileDialog(props: ComponentProps<typeof DialogTypes.ProfileDialog>) { return props.open ? <Suspense fallback={<ModalLoading title="Загружаем…" onClose={props.onClose}/>}><LazyProfileDialog {...props}/></Suspense> : null }

const LazyServerSettingsDialog = lazy(() => import('./WorkspaceDialogs').then((module) => ({ default: module.ServerSettingsDialog })))
export function ServerSettingsDialog(props: ComponentProps<typeof DialogTypes.ServerSettingsDialog>) { return props.open ? <Suspense fallback={<ModalLoading title="Загружаем…" onClose={props.onClose}/>}><LazyServerSettingsDialog {...props}/></Suspense> : null }

const LazyVoiceDialog = lazy(() => import('./VoiceSettingsDialog').then((module) => ({ default: module.VoiceSettingsDialog })))
export function VoiceSettingsDialog(props: ComponentProps<typeof VoiceDialog>) { return props.open ? <Suspense fallback={<ModalLoading title="Настройки голоса" onClose={props.onClose}/>}><LazyVoiceDialog {...props}/></Suspense> : null }
const LazyMemberCard = lazy(() => import('./MemberCard').then((module) => ({ default: module.MemberCard })))
export function MemberCard(props: ComponentProps<typeof LoadedMemberCard>) { return <Suspense fallback={null}><LazyMemberCard {...props}/></Suspense> }

const LazySearchPanel = lazy(() => import('./MessagePanels').then((module) => ({ default: module.MessageSearchPanel })))
export function MessageSearchPanel(props: ComponentProps<typeof import('./MessagePanels').MessageSearchPanel>) { return props.open ? <Suspense fallback={null}><LazySearchPanel {...props}/></Suspense> : null }
const LazyPinsPanel = lazy(() => import('./MessagePanels').then((module) => ({ default: module.PinnedMessagesPanel })))
export function PinnedMessagesPanel(props: ComponentProps<typeof import('./MessagePanels').PinnedMessagesPanel>) { return props.open ? <Suspense fallback={null}><LazyPinsPanel {...props}/></Suspense> : null }
const LazyVoicePanel = lazy(() => import('./VoicePanel').then((module) => ({ default: module.VoicePanel })))
export function VoicePanel(props: ComponentProps<typeof import('./VoicePanel').VoicePanel>) { return <Suspense fallback={null}><LazyVoicePanel {...props}/></Suspense> }
