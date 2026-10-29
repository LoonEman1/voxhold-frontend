import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react'
import type { ServerMember, ServerRole } from '../domain/types'
import { roleMeta } from '../lib/roles'
import { mentionDirectory } from '../lib/mentions'
import { MentionDraft } from '../services/mentionDraft'
import { Avatar } from './Avatar'
import { Icon } from './Icon'

interface Option { key: string; label: string; detail: string; token: string; userId?: number }
export function MentionComposer({ hasAttachments = false, focusKey = 0, submitDisabled = false, draft, onChange, onSubmit, sending, channelName, members, error, submitLabel = 'Отправить', onCancel, submitOnEnter = true, inputLabel }: {
  hasAttachments?: boolean; focusKey?: number; submitDisabled?: boolean; draft: string; onChange: (value: string) => void; onSubmit: (event?: FormEvent, content?: string) => void; submitLabel?: string; onCancel?: () => void; submitOnEnter?: boolean; inputLabel?: string; sending: boolean; channelName: string; members: ServerMember[]; error: string
}) {
  const input = useRef<HTMLTextAreaElement>(null)
  const model = useRef(new MentionDraft())
  const directory = useMemo(() => mentionDirectory(members), [members])
  model.current.sync(draft, directory)
  const text = model.current.text
  useEffect(() => { if (focusKey) input.current?.focus({ preventScroll: true }) }, [focusKey])
  const [localError, setLocalError] = useState('')
  const submit = (event?: FormEvent) => {
    event?.preventDefault()
    if (submitDisabled || sending) return
    const encoded = model.current.encode()
    if ([...encoded].length > 5120) { setLocalError('Сократите сообщение: вместе с упоминаниями оно превышает 5120 символов'); return }
    setLocalError(''); onSubmit(event, encoded)
  }
  const [caret, setCaret] = useState(0), [active, setActive] = useState(0), [dismissed, setDismissed] = useState<string | null>(null)
  const id = useId()
  const editing = !!onCancel
  useEffect(() => {
    if (!editing) return
    const element = input.current
    element?.focus(); element?.setSelectionRange(element.value.length, element.value.length)
    setCaret(element?.value.length ?? 0)
  }, [editing])
  const query = /(?:^|\s)@([\p{L}\p{N}_-]*)$/u.exec(text.slice(0, caret))
  const queryKey = query ? `${caret}:${text}` : ''
  const needle = query ? (query[1] ?? '').toLowerCase() : null
  const options = useMemo<Option[]>(() => {
    if (needle === null || dismissed === queryKey) return []
    const users = members.filter((member) => member.username.toLowerCase().includes(needle)).slice(0, 6).map((member) => ({ key: `user-${member.user_id}`, label: member.username, detail: roleMeta[member.role].label, token: `<@${member.user_id}>`, userId: member.user_id }))
    const roles = (['owner', 'admin', 'member'] as ServerRole[]).filter((role) => `${roleMeta[role].label} ${role}`.toLowerCase().includes(needle)).map((role) => ({ key: `role-${role}`, label: roleMeta[role].shortLabel, detail: 'Все участники с этой ролью', token: `<@&${role}>` }))
    return [...users, ...roles]
  }, [members, needle, queryKey, dismissed]) // The query key includes caret/text.
  const choose = (option: Option) => {
    const start = caret - (query?.[1]?.length ?? 0) - 1
    const label = `@${option.label}`
    if (text.length - (caret - start) + label.length + 1 > 5120) return
    model.current.insert(start, caret, label, option.token)
    const position = start + label.length + 1
    onChange(model.current.text); setCaret(position); setActive(0); setDismissed(null); setLocalError('')
    requestAnimationFrame(() => { input.current?.focus(); input.current?.setSelectionRange(position, position) })
  }
  const selected = Math.min(active, options.length - 1)
  return <form className="composer" onSubmit={submit}>
    {options.length > 0 && <div className="mention-picker" id={id} role="listbox" aria-label="Упомянуть участника или роль"><header><b>Упомянуть</b><span>↑↓ выбрать · Enter вставить · Esc закрыть</span></header>{options.map((option, index) => <button id={`${id}-${index}`} key={option.key} type="button" role="option" aria-selected={index === selected} className={index === selected ? 'is-active' : ''} onMouseDown={(event) => event.preventDefault()} onClick={() => choose(option)}>{option.userId ? <Avatar userId={option.userId} name={option.label} size="small"/> : <span className="mention-picker__role"><Icon name="people" size={16}/></span>}<span><b>@{option.label}</b><small>{option.detail}</small></span>{!option.userId && <em>Роль</em>}</button>)}</div>}
    <span className="composer__mention-hint" title="Введите @, чтобы упомянуть участника или роль" aria-hidden="true">@</span>
    <textarea ref={input} rows={editing ? 3 : 1} value={text} onChange={(event) => { model.current.change(event.target.value); onChange(event.target.value); setLocalError(''); setCaret(event.target.selectionStart); setActive(0); setDismissed(null) }} onSelect={(event) => setCaret(event.currentTarget.selectionStart)} onKeyDown={(event) => {
      if (event.nativeEvent.isComposing) return
      if (!(event.key === 'Enter' && event.shiftKey) && options.length && ['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape'].includes(event.key)) {
        event.preventDefault()
        if (event.key === 'Escape') setDismissed(queryKey)
        else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') setActive((selected + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length)
        else if (options[selected]) choose(options[selected])
      } else if (event.key === 'Escape' && onCancel) { event.preventDefault(); onCancel() }
      else if (event.key === 'Enter' && !event.shiftKey && (submitOnEnter || event.ctrlKey || event.metaKey)) { event.preventDefault(); submit() }
    }} placeholder={`Написать в #${channelName} · @ для упоминания`} maxLength={5120} aria-label={inputLabel ?? `Сообщение в ${channelName}`} aria-autocomplete="list" aria-controls={options.length ? id : undefined} aria-activedescendant={options.length ? `${id}-${selected}` : undefined}/>
    <button type="submit" className="composer__send" disabled={(!draft.trim() && !hasAttachments) || sending || submitDisabled} aria-label={sending ? 'Отправляется' : submitLabel} title={submitLabel}>{sending ? <span className="spinner"/> : <Icon name={editing ? 'check' : 'send'}/> }</button>
    {onCancel && <button className="button button--ghost button--small" type="button" onClick={onCancel}>Отмена</button>}
    {(localError || error) && <div className="composer__error" role="alert">{localError || error}</div>}
  </form>
}
