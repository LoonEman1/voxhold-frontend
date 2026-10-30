// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { useDraft } from './useDraft'
afterEach(() => { cleanup(); localStorage.clear() })
it('restores drafts and keeps accounts, instances, channels and threads separate', () => {
  const first = renderHook(({ scope }) => useDraft(scope), { initialProps: { scope: 'instance-a:1:channel:2:thread:0' } })
  act(() => first.result.current[1]('unsent text'))
  first.rerender({ scope: 'instance-a:1:channel:2:thread:9' }); expect(first.result.current[0]).toBe('')
  act(() => first.result.current[1]('thread draft'))
  first.rerender({ scope: 'instance-a:2:channel:2:thread:0' }); expect(first.result.current[0]).toBe('')
  first.rerender({ scope: 'instance-b:1:channel:2:thread:0' }); expect(first.result.current[0]).toBe('')
  first.rerender({ scope: 'instance-a:1:channel:2:thread:0' }); expect(first.result.current[0]).toBe('unsent text')
  first.unmount()
  const restored = renderHook(() => useDraft('instance-a:1:channel:2:thread:0'))
  expect(restored.result.current[0]).toBe('unsent text')
  act(() => restored.result.current[1]('')); restored.unmount()
  expect(renderHook(() => useDraft('instance-a:1:channel:2:thread:0')).result.current[0]).toBe('')
})

it('does not erase a newer draft when an old send completes after navigation', () => {
  const old = renderHook(() => useDraft('one:1:channel:2'))
  act(() => old.result.current[1]('sent text'))
  const complete = old.result.current[1]; old.unmount()
  const fresh = renderHook(() => useDraft('one:1:channel:2'))
  act(() => fresh.result.current[1]('new unsent text'))
  act(() => complete((current) => current === 'sent text' ? '' : current))
  fresh.unmount()
  expect(renderHook(() => useDraft('one:1:channel:2')).result.current[0]).toBe('new unsent text')
})
