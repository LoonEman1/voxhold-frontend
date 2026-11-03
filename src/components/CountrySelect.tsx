import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { countries, countryByCode } from '../lib/countries'
import { Icon } from './Icon'

export function CountryFlag({ code }: { code: string }) {
  return <img className="country-flag" src={`/flags/${code.toLowerCase()}.svg`} alt="" width="22" height="16" loading="lazy" decoding="async" />
}

export function CountrySelect({ value, onChange, id }: { value: string; onChange(value: string): void; id?: string }) {
  const generatedId = useId(), pickerId = id ?? generatedId
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const selected = countryByCode(value)
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('ru')
    if (!normalized) return countries
    return countries.filter((country) => country.name.toLocaleLowerCase('ru').includes(normalized) || country.code.toLowerCase().includes(normalized))
  }, [query])

  useEffect(() => {
    if (!open) return
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', closeOnOutsideClick)
    const timer = window.setTimeout(() => searchRef.current?.focus(), 0)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('pointerdown', closeOnOutsideClick)
    }
  }, [open])

  const choose = (code: string) => {
    onChange(code)
    setOpen(false)
    setQuery('')
    triggerRef.current?.focus()
  }

  return (
    <div className="country-picker" ref={rootRef} onKeyDown={(event) => {
      if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); triggerRef.current?.focus(); return }
      if (!open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) { event.preventDefault(); setOpen(true); return }
      if (!open) return
      const options = [...(rootRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? [])]
      const index = options.indexOf(document.activeElement as HTMLButtonElement)
      const next = event.key === 'ArrowDown' ? Math.min(index + 1, options.length - 1) : event.key === 'ArrowUp' ? index <= 0 ? options.length - 1 : index - 1 : index >= 0 && event.key === 'Home' ? 0 : index >= 0 && event.key === 'End' ? options.length - 1 : -1
      if (next >= 0) { event.preventDefault(); options[next]?.focus() }
    }}>
      <button ref={triggerRef} id={pickerId} className="country-picker__trigger" type="button" role="combobox" aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? `${pickerId}-listbox` : undefined} onClick={() => setOpen((current) => !current)}>
        {selected ? <><CountryFlag code={selected.code}/><span>{selected.name}</span><small>{selected.code}</small></> : <span className="country-picker__placeholder">Выберите страну</span>}
        <span className="country-picker__chevron" aria-hidden="true">⌄</span>
      </button>
      {open && <div className="country-picker__popover">
        <div className="country-picker__search"><Icon name="search" size={15}/><input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Найти страну…" aria-label="Поиск страны"/></div>
        <div className="country-picker__list" id={`${pickerId}-listbox`} role="listbox">
          <button type="button" tabIndex={-1} className={!value ? 'is-selected' : ''} role="option" aria-selected={!value} onClick={() => choose('')}><span className="country-picker__empty-flag">—</span><span>Не указывать</span>{!value && <Icon name="check" size={14}/>}</button>
          {filtered.map((country) => <button type="button" tabIndex={-1} key={country.code} className={value === country.code ? 'is-selected' : ''} role="option" aria-selected={value === country.code} onClick={() => choose(country.code)}><CountryFlag code={country.code}/><span>{country.name}</span><small>{country.code}</small>{value === country.code && <Icon name="check" size={14}/>}</button>)}
          {filtered.length === 0 && <p>Страна не найдена</p>}
        </div>
      </div>}
    </div>
  )
}
