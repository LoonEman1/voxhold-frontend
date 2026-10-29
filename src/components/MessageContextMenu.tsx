import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Message } from '../domain/types'
import { QUICK_REACTIONS, REACTION_CATALOG, reactionLabel, recentReactions, type ReactionCategory } from '../lib/reactionCatalog'
import { Icon, type IconName } from './Icon'

interface Action { key: string; label: string; icon: IconName; danger?: boolean; run: () => void }
export function MessageContextMenu({ message, x, y, expanded: initiallyExpanded = false, canEdit, canDelete, canPin, canReply = true, pinned, pending, onClose, onReact, onDiscuss, onReply, onEdit, onPin, onCopy, onForward, onDelete }: {
  message: Message; x: number; y: number; expanded?: boolean; canEdit: boolean; canDelete: boolean; canPin: boolean; canReply?: boolean; pinned: boolean
  pending: Readonly<Record<string, boolean>>; onClose: () => void; onReact?: (emoji: string) => void
  onDiscuss?: () => void; onReply: () => void; onEdit: () => void; onPin: () => void; onCopy: () => void; onForward?: () => void; onDelete: () => void
}) {
  const root = useRef<HTMLDivElement>(null), search = useRef<HTMLInputElement>(null)
  const [expanded, setExpanded] = useState(initiallyExpanded), [query, setQuery] = useState('')
  const [category, setCategory] = useState<ReactionCategory | 'all' | 'recent'>('all')
  const [position, setPosition] = useState({ x, y })
  const close = useRef(onClose); close.current = onClose
  const recents = useMemo(recentReactions, [])
  const options = useMemo(() => REACTION_CATALOG.filter((option) => (category === 'all' || category === 'recent' && recents.includes(option.emoji) || option.category === category) && `${option.label} ${option.emoji}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())), [category, query, recents])
  const selected = new Set(message.reactions?.filter((reaction) => reaction.me).map((reaction) => reaction.emoji))
  const actions: Action[] = [
    ...(onDiscuss ? [{ key: 'discuss', label: (message.comment_count ?? 0) > 0 ? 'Открыть обсуждение' : 'Начать обсуждение', icon: 'chat' as const, run: onDiscuss }] : []),
    ...(canReply ? [{ key: 'reply', label: 'Ответить', icon: 'reply' as const, run: onReply }] : []),
    ...(canEdit ? [{ key: 'edit', label: 'Изменить', icon: 'edit' as const, run: onEdit }] : []),
    ...(canPin ? [{ key: 'pin', label: pinned ? 'Открепить' : 'Закрепить', icon: 'pin' as const, run: onPin }] : []),
    { key: 'copy', label: 'Копировать текст', icon: 'copy', run: onCopy },
    ...(onForward ? [{ key: 'forward', label: 'Переслать', icon: 'forward' as const, run: onForward }] : []),
    ...(canDelete ? [{ key: 'delete', label: 'Удалить', icon: 'trash' as const, run: onDelete, danger: true }] : []),
  ]
  useLayoutEffect(() => {
    const box = root.current?.getBoundingClientRect()
    if (box) setPosition({ x: Math.max(12, Math.min(x, window.innerWidth - box.width - 12)), y: Math.max(12, Math.min(y, window.innerHeight - box.height - 12)) })
  }, [x, y, expanded, category, query])
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    root.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true })
    const pointer = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) close.current() }
    const scroll = (event: Event) => { if (!root.current?.contains(event.target as Node)) close.current() }
    const dismiss = () => close.current()
    window.addEventListener('pointerdown', pointer, true); document.addEventListener('scroll', scroll, true)
    window.addEventListener('blur', dismiss); window.addEventListener('resize', dismiss)
    return () => {
      window.removeEventListener('pointerdown', pointer, true); document.removeEventListener('scroll', scroll, true)
      window.removeEventListener('blur', dismiss); window.removeEventListener('resize', dismiss)
      if (previous?.isConnected) previous.focus({ preventScroll: true })
    }
  }, [])
  const emojiButton = (emoji: string) => <button key={emoji} type="button" role="menuitemcheckbox" aria-checked={pending[emoji] ?? selected.has(emoji)} className={(pending[emoji] ?? selected.has(emoji)) ? 'is-selected' : ''} disabled={!onReact || Object.hasOwn(pending, emoji)} aria-label={reactionLabel(emoji)} title={reactionLabel(emoji)} onClick={() => { onReact?.(emoji); onClose() }}>{emoji}</button>
  return createPortal(<div ref={root} className="message-context" role="menu" aria-label="Действия с сообщением" style={{ left: position.x, top: position.y }} onContextMenu={(event) => event.preventDefault()} onKeyDown={(event) => {
    if (event.key === 'Escape') { event.stopPropagation(); onClose(); return }
    if (event.key === 'Tab') { onClose(); return }
    const typing = event.target === search.current
    if (typing && !['ArrowDown', 'ArrowUp'].includes(event.key)) return
    if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    if (typing && event.key === 'ArrowDown') { event.preventDefault(); root.current?.querySelector<HTMLButtonElement>('.message-context__grid button:not(:disabled)')?.focus(); return }
    const withinGrid = (event.target as HTMLElement).closest('.message-context__grid')
    const container = withinGrid ?? root.current
    const buttons = [...(container?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])]
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
    const step = withinGrid && ['ArrowDown', 'ArrowUp'].includes(event.key) ? 8 : 1
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (['ArrowUp', 'ArrowLeft'].includes(event.key) ? -step : step) + buttons.length) % buttons.length
    event.preventDefault(); buttons[next]?.focus({ preventScroll: false })
  }}>
    <div className="message-context__quick" role="group" aria-label="Быстрые реакции">{QUICK_REACTIONS.map(emojiButton)}<button type="button" className={`message-context__expand ${expanded ? 'is-expanded' : ''}`} aria-label={expanded ? 'Скрыть реакции' : 'Все реакции'} aria-expanded={expanded} onClick={() => setExpanded((current) => !current)}><Icon name="chevron" size={17}/></button></div>
    {expanded && <section className="message-context__picker" aria-label="Выбор реакции"><label className="message-context__search"><Icon name="search" size={16}/><input ref={search} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Найти эмодзи" aria-label="Найти эмодзи"/>{query && <button type="button" onClick={() => { setQuery(''); search.current?.focus() }} aria-label="Очистить поиск"><Icon name="close" size={14}/></button>}</label><div className="message-context__categories" role="group" aria-label="Категории реакций">{([['all', 'Все', '✨'], ['recent', 'Недавние', '◷'], ['faces', 'Лица', '🙂'], ['hands', 'Жесты', '👍'], ['celebrate', 'Праздник', '🎉'], ['nature', 'Природа', '🌿']] as const).map(([value, label, icon]) => <button key={value} type="button" aria-label={label} title={label} aria-pressed={category === value} onClick={() => setCategory(value)}>{icon}</button>)}</div><div className="message-context__grid" role="group" aria-label="Эмодзи">{options.map((option) => emojiButton(option.emoji))}{!options.length && <p>{category === 'recent' && !query ? 'Здесь появятся ваши недавние реакции' : 'Ничего не нашли'}</p>}</div></section>}
    <div className="message-context__actions">{actions.map((action) => <button type="button" role="menuitem" key={action.key} className={action.danger ? 'is-danger' : ''} onClick={() => { action.run(); onClose() }}><Icon name={action.icon} size={17}/><span>{action.label}</span></button>)}</div>
  </div>, document.fullscreenElement ?? document.body)
}
