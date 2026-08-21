// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { StreamQualitySummary } from './StreamQualitySummary'

afterEach(cleanup)

describe('StreamQualitySummary', () => {
  it('shows measured media quality and the active limitation', () => {
    render(<StreamQualitySummary stats={{
      codec: 'VP9',
      bitrateKbps: 5840,
      framesPerSecond: 30,
      width: 1920,
      height: 1080,
      packetsLost: 3,
      qualityLimitationReason: 'bandwidth',
    }}/>)

    expect(screen.getByText('1920×1080 · 30 FPS · 5.8 Мбит/с · VP9')).toBeTruthy()
    expect(screen.getByText('сеть ограничивает качество')).toBeTruthy()
    expect(screen.getByText('потеряно пакетов: 3')).toBeTruthy()
  })
})
