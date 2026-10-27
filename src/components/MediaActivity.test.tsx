// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { createMediaActivity, MediaActivityProvider, useSpeakingUsers, useStreamQuality } from './MediaActivity'
import type { StreamQualityStats } from '../services/stream'

afterEach(cleanup)
it('updates media consumers without rerendering the workspace or chat', () => {
  const activity = createMediaActivity()
  let workspaceRenders = 0, chatRenders = 0
  function Chat() { chatRenders++; return <p>chat</p> }
  function Quality() { return <p data-testid="quality">{useStreamQuality()?.bitrateKbps ?? 0}</p> }
  function Speakers() { return <p data-testid="speakers">{useSpeakingUsers().join(',')}</p> }
  function Workspace() { workspaceRenders++; return <MediaActivityProvider value={activity}><Chat/><Quality/><Speakers/></MediaActivityProvider> }
  render(<Workspace/>)
  act(() => { activity.quality.set({ bitrateKbps: 1200 } as StreamQualityStats); activity.speakers.set([1, 3]) })
  expect(screen.getByTestId('quality').textContent).toBe('1200')
  expect(screen.getByTestId('speakers').textContent).toBe('1,3')
  expect(workspaceRenders).toBe(1)
  expect(chatRenders).toBe(1)
})
