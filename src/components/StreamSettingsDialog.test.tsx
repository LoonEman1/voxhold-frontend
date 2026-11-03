// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { useState } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { DEFAULT_STREAM_PREFERENCES, loadStreamPreferences, saveStreamPreferences } from '../services/streamSettings'
import { StreamSettingsDialog } from './StreamSettingsDialog'

vi.mock('../services/hdrCapabilities', () => ({ detectHDRCapabilities: async () => ({ canPublishHDR: true }) }))
vi.mock('../services/stream', () => ({ canRestrictOwnAudio: () => true, selectedStreamCodec: () => 'h264', supportedStreamCodecs: () => ['h264', 'vp8', 'vp9', 'av1'] }))
afterEach(() => { cleanup(); localStorage.clear() })

it('holds live edits until apply and keeps the draft after an update fails', async () => {
  const apply = vi.fn(async () => { throw new Error('Кодер отклонил настройки') }), change = vi.fn(), close = vi.fn()
  render(<StreamSettingsDialog open live liveHasAudio busy={false} preferences={DEFAULT_STREAM_PREFERENCES} onChange={change} onApply={apply} onClose={close} onStart={vi.fn()}/> )
  expect(screen.getByLabelText('Видеокодек')).toBeDisabled()
  expect(screen.getByLabelText('Передача')).toBeDisabled()
  const input = screen.getByRole('spinbutton', { name: 'Битрейт видео, Мбит/с' })
  fireEvent.change(input, { target: { value: '7.3' } })
  expect(change).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Применить' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Кодер отклонил настройки')
  expect(input).toHaveValue(7.3)
  expect(close).not.toHaveBeenCalled()
  expect(apply).toHaveBeenCalledWith(expect.objectContaining({ videoBitrateKbps: 7300 }))
})

it('prevents repeated live submissions and closes only after success', async () => {
  let done!: () => void
  const apply = vi.fn(() => new Promise<void>((resolve) => { done = resolve })), close = vi.fn()
  render(<StreamSettingsDialog open live busy={false} preferences={DEFAULT_STREAM_PREFERENCES} onChange={vi.fn()} onApply={apply} onClose={close} onStart={vi.fn()}/> )
  const button = screen.getByRole('button', { name: 'Применить' })
  fireEvent.click(button); fireEvent.click(button)
  fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }))
  expect(apply).toHaveBeenCalledTimes(1)
  expect(close).not.toHaveBeenCalled()
  await act(async () => done())
  await waitFor(() => expect(close).toHaveBeenCalledOnce())
})

it('edits custom Mbit/s, immediately caps 16 and preserves custom values in storage', () => {
  function Fixture() {
    const [preferences, setPreferences] = useState(DEFAULT_STREAM_PREFERENCES)
    return <StreamSettingsDialog open busy={false} preferences={preferences} onChange={(next) => { setPreferences(next); saveStreamPreferences(next) }} onClose={() => {}} onStart={() => {}}/>
  }
  render(<Fixture/> )
  const input = screen.getByRole('spinbutton', { name: 'Битрейт видео, Мбит/с' })
  input.focus()
  expect(input).toHaveAttribute('step', '0.1')
  expect(input).toHaveAttribute('max', '16')
  fireEvent.change(input, { target: { value: '7.3' } })
  expect(input).toHaveValue(7.3)
  expect(loadStreamPreferences().videoBitrateKbps).toBe(7300)
  fireEvent.change(input, { target: { value: '99.9' } })
  expect(input).toHaveValue(16)
  expect(loadStreamPreferences().videoBitrateKbps).toBe(16000)
  fireEvent.change(input, { target: { value: '7.36' } })
  expect(input).toHaveValue(7.4)
  fireEvent.change(input, { target: { value: '' } })
  fireEvent.blur(input)
  expect(input).toHaveValue(7.4)
  fireEvent.change(input, { target: { value: '0.1' } })
  fireEvent.blur(input)
  expect(input).toHaveValue(0.5)
  expect(loadStreamPreferences().videoBitrateKbps).toBe(500)
  // A real click blurs the input before applying the preset.
  input.blur()
  fireEvent.click(screen.getByRole('button', { name: /Игры/ }))
  expect(loadStreamPreferences().videoBitrateKbps).toBe(12000)
})
