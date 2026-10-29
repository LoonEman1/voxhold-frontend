// @vitest-environment jsdom
import { Component, lazy, Suspense } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { WorkspaceDialogBoundary } from './WorkspaceDialogBoundary'

afterEach(() => { cleanup(); vi.restoreAllMocks() })
it('keeps the media owner mounted when a settings chunk fails to load', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  const closed = vi.fn(), dismiss = vi.fn()
  const Broken = lazy(async () => { throw new TypeError('Failed to fetch dynamically imported module') })
  class CallOwner extends Component {
    componentWillUnmount() { closed() }
    render() { return <><video data-testid="stream"/><WorkspaceDialogBoundary resetKey="settings" onClose={dismiss}><Suspense fallback="Загрузка"><Broken/></Suspense></WorkspaceDialogBoundary></> }
  }
  render(<CallOwner/>)
  await screen.findByRole('alert')
  expect(screen.getByTestId('stream')).toBeTruthy(); expect(closed).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Вернуться к разговору' }))
  expect(dismiss).toHaveBeenCalledOnce(); expect(closed).not.toHaveBeenCalled()
})
