// @vitest-environment jsdom
import { Component } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { WorkspaceContentBoundary } from './WorkspaceContentBoundary'

afterEach(() => { cleanup(); vi.restoreAllMocks() })
it('contains a display crash, preserves its media owner and retries only the failed subtree', () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  let fail = true
  const closed = vi.fn()
  function Player() { if (fail) throw new TypeError('Cannot read properties of undefined (reading "map")'); return <div>Просмотр восстановлен</div> }
  class Owner extends Component {
    componentWillUnmount() { closed() }
    render() { return <><button>Микрофон</button><WorkspaceContentBoundary resetKey="voice"><Player/></WorkspaceContentBoundary></> }
  }
  render(<Owner/>)
  expect(screen.getByRole('button', { name: 'Микрофон' })).toBeTruthy()
  expect(screen.getByRole('alert')).toBeTruthy(); expect(closed).not.toHaveBeenCalled()
  fail = false; fireEvent.click(screen.getByRole('button', { name: 'Восстановить интерфейс' }))
  expect(screen.getByText('Просмотр восстановлен')).toBeTruthy(); expect(closed).not.toHaveBeenCalled()
})
