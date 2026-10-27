// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { MessageNotification } from '../domain/types'
import { MessageNotificationCenter } from './messageNotifications'
const event = (id = 5): MessageNotification => ({ server_id: 1, channel_id: 7, server_name: 'First', channel_name: 'general', mentioned: true, message: { id, author: { user_id: 2, username: 'Alice' }, content: 'Привет <@1>', created_at: 1 } })
const disposers: (() => void)[] = []
beforeEach(() => { localStorage.clear(); vi.useFakeTimers(); vi.spyOn(document, 'hasFocus').mockReturnValue(false) })
afterEach(() => { disposers.splice(0).forEach((dispose) => dispose()); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })
function setup(reading = { serverId: null as number | null, channelId: null as number | null, following: false }) {
  const sound = vi.fn(), open = vi.fn()
  const center = new MessageNotificationCenter('instance:1', 1, { reading: () => reading, sound, open })
  disposers.push(center.start()); return { center, sound, open }
}
it('deduplicates messages across tabs and ignores own messages', async () => {
  const a = setup(), b = setup()
  await Promise.all([a.center.receive(event()), b.center.receive(event())])
  expect(a.center.snapshot().length + b.center.snapshot().length).toBe(1)
  expect(a.sound.mock.calls.length + b.sound.mock.calls.length).toBe(1)
  await a.center.receive({ ...event(6), message: { ...event(6).message, author: { user_id: 1, username: 'Me' } } })
  expect(a.center.snapshot()).toHaveLength(1)
})
it('keeps a bounded toast stack, throttles sound and expires notifications', async () => {
  const { center, sound } = setup()
  for (let id = 1; id <= 30; id++) await center.receive(event(id))
  expect(center.snapshot()).toHaveLength(4); expect(sound).toHaveBeenCalledOnce()
  vi.advanceTimersByTime(3_001); await center.receive(event(31)); expect(sound).toHaveBeenCalledTimes(2)
  vi.advanceTimersByTime(10_000); expect(center.snapshot()).toHaveLength(0)
})
it('stays silent while the channel is being read, including in another focused tab', async () => {
  vi.mocked(document.hasFocus).mockReturnValue(true)
  const focused = setup({ serverId: 1, channelId: 7, following: true })
  vi.mocked(document.hasFocus).mockReturnValue(false)
  const background = setup()
  await background.center.receive(event())
  expect(background.sound).not.toHaveBeenCalled(); expect(background.center.snapshot()).toHaveLength(0)
  expect(focused.center.snapshot()).toHaveLength(0)
})
it('does not deliver an alert revoked while waiting for a cross-tab lock', async () => {
  let run!: () => void
  Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: (_name: string, callback: () => void) => new Promise<void>((resolve) => { run = () => { callback(); resolve() } }) } })
  const { center, sound } = setup(); const pending = center.receive(event())
  center.retainChannels(1, new Set()); run(); await pending
  expect(sound).not.toHaveBeenCalled(); expect(center.snapshot()).toHaveLength(0)
  Reflect.deleteProperty(navigator, 'locks')
})
it('mutes a channel immediately and opens the correct message from a toast', async () => {
  const { center, open, sound } = setup()
  center.setSettings({ server_id: 1, channel_id: 7, mode: 'none' }); await center.receive(event())
  expect(sound).not.toHaveBeenCalled()
  center.setSettings({ server_id: 1, channel_id: 7, mode: 'all' }); await center.receive(event(6))
  center.open(event(6)); expect(open).toHaveBeenCalledWith(event(6)); expect(center.snapshot()).toHaveLength(0)
})

it('ignores a stale desktop notification action after logout or access revocation', () => {
  const { center, open } = setup()
  center.retainChannels(1, new Set()); center.open(event())
  expect(open).not.toHaveBeenCalled()
  center.allowChannel(1, 7); disposers.splice(0).forEach((dispose) => dispose()); center.open(event())
  expect(open).not.toHaveBeenCalled()
})
