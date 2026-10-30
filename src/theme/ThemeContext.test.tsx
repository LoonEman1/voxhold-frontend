// @vitest-environment jsdom
import themeInit from '../../public/theme-init.js?raw'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ThemeProvider, useTheme } from './ThemeContext'

function Probe() { const { theme, toggleTheme } = useTheme(); return <button onClick={toggleTheme}>{theme}</button> }
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); delete document.documentElement.dataset.theme; document.documentElement.style.colorScheme = ''; document.head.replaceChildren(); localStorage.clear() })
it('initializes before React and remains usable with blocked storage', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('blocked', 'SecurityError') })
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('blocked', 'SecurityError') })
  vi.stubGlobal('matchMedia', () => ({ matches: true }))
  document.head.innerHTML = '<meta name="theme-color" content="#10100f">'
  window.eval(themeInit)
  expect(document.documentElement.dataset.theme).toBe('light')
  expect(document.documentElement.style.colorScheme).toBe('light')
  render(<ThemeProvider><Probe/></ThemeProvider>)
  fireEvent.click(screen.getByRole('button', { name: 'light' }))
  expect(document.documentElement.dataset.theme).toBe('dark')
  expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe('#10100f')
})
