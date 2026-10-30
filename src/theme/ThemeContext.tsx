import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

export type Theme = 'dark' | 'light'

interface ThemeContextValue {
  theme: Theme
  toggleTheme(): void
}

const STORAGE_KEY = 'voxhold.theme.v1'
const ThemeContext = createContext<ThemeContextValue | null>(null)

function initialTheme(): Theme {
  const initialized = document.documentElement.dataset.theme
  if (initialized === 'dark' || initialized === 'light') return initialized
  let saved: string | null = null
  try { saved = localStorage.getItem(STORAGE_KEY) } catch { /* Use the system preference. */ }
  if (saved === 'dark' || saved === 'light') return saved
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(initialTheme)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.documentElement.style.colorScheme = theme
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'light' ? '#f3f2ed' : '#10100f')
    try { localStorage.setItem(STORAGE_KEY, theme) } catch { /* Theme changes still work in memory. */ }
  }, [theme])

  const value = useMemo(() => ({
    theme,
    toggleTheme: () => setTheme((current) => current === 'dark' ? 'light' : 'dark'),
  }), [theme])

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const value = useContext(ThemeContext)
  if (!value) throw new Error('useTheme must be used inside ThemeProvider')
  return value
}
