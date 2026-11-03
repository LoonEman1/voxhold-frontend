// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { DEFAULT_STREAM_PREFERENCES, loadStreamPreferences, saveStreamPreferences } from '../services/streamSettings'
import { StreamSettingsDialog } from './StreamSettingsDialog'

vi.mock('../services/hdrCapabilities', () => ({ detectHDRCapabilities: async () => ({ canPublishHDR: true }) }))
vi.mock('../services/stream', () => ({ canRestrictOwnAudio: () => true, selectedStreamCodec: () => 'h264', supportedStreamCodecs: () => ['h264', 'vp8', 'vp9', 'av1'] }))
afterEach(() => { cleanup(); localStorage.clear() })

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
