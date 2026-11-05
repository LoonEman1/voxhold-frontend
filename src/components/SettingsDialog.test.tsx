// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { SettingsDialog, type SettingsTab } from './SettingsDialog'
afterEach(cleanup)

it('shows exactly three tabs in one dialog and keeps a profile draft through keyboard navigation', () => {
  function Fixture() {
    const [tab, setTab] = useState<SettingsTab>('profile')
    return <SettingsDialog open tab={tab} onTabChange={setTab} onClose={() => undefined} profile={<input aria-label="О себе"/>} voice={<p>Устройства</p>} privacy={<p>Кто может писать мне</p>}/>
  }
  render(<Fixture/>)
  expect(screen.getAllByRole('dialog')).toHaveLength(1)
  expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Профиль', 'Голос и звук', 'Приватность'])
  fireEvent.change(screen.getByLabelText('О себе'), { target: { value: 'Черновик' } })
  const profile = screen.getByRole('tab', { name: 'Профиль' }); profile.focus()
  fireEvent.keyDown(profile, { key: 'ArrowRight' })
  expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Голос и звук' }))
  expect(screen.getByRole('tabpanel').textContent).toBe('Устройства')
  fireEvent.keyDown(document.activeElement!, { key: 'End' })
  expect(screen.getByRole('tabpanel').textContent).toBe('Кто может писать мне')
  fireEvent.click(profile)
  expect((screen.getByLabelText('О себе') as HTMLInputElement).value).toBe('Черновик')
})

it('keeps a pending account operation inside the settings dialog', () => {
  const close = vi.fn(), change = vi.fn()
  render(<SettingsDialog open busy tab="profile" onTabChange={change} onClose={close} profile={<p>Сохранение</p>} voice={null} privacy={null}/>)
  fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }))
  fireEvent.keyDown(document, { key: 'Escape' })
  fireEvent.click(screen.getByRole('tab', { name: 'Голос и звук' }))
  expect(close).not.toHaveBeenCalled(); expect(change).not.toHaveBeenCalled()
})
