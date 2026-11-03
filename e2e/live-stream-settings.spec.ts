import { expect, test } from '@playwright/test'
import type { LiveStreamFixture } from './fixtures/live-stream-settings'

declare global { interface Window { liveStreamFixture: LiveStreamFixture } }

for (const mode of ['server', 'p2p'] as const) test(`live quality changes preserve tracks and decoded frames in ${mode} mode`, async ({ page }) => {
  await page.goto('/e2e/fixtures/live-stream-settings.html')
  try {
    await page.evaluate((mode) => window.liveStreamFixture.start(mode), mode)
    await expect.poll(() => page.evaluate(() => window.liveStreamFixture.snapshot().videos[0]!.frames)).toBeGreaterThan(5)
    const before = await page.evaluate(() => window.liveStreamFixture.snapshot())
    await page.evaluate(() => window.liveStreamFixture.apply({ videoBitrateKbps: 1700, resolution: '720p', frameRate: 15, audioBitrateKbps: 96 }))
    await expect.poll(() => page.evaluate(() => window.liveStreamFixture.snapshot().videos[0]!.width)).toBe(1280)
    await expect.poll(() => page.evaluate(() => window.liveStreamFixture.snapshot().videos[0]!.frames)).toBeGreaterThan(before.videos[0]!.frames + 5)
    const after = await page.evaluate(() => window.liveStreamFixture.snapshot())
    expect(after.captureId).toBe(before.captureId)
    expect(after.captureTrackId).toBe(before.captureTrackId)
    expect(after.outputTrackId).toBe(before.outputTrackId)
    expect(after.peers.map((peer) => peer.id)).toEqual(before.peers.map((peer) => peer.id))
    expect(after.peers[0]!.state).toBe('connected')
    expect(after.peers[0]!.senders.find((sender) => sender.kind === 'video')!.encodings[0]).toMatchObject({ maxBitrate: 1700000, maxFramerate: 15 })
    expect(after.peers[0]!.senders.find((sender) => sender.kind === 'audio')!.encodings[0]).toMatchObject({ maxBitrate: 96000 })
    expect(after.source).toMatchObject({ width: 1280, height: 720, frameRate: 15 })
    await page.evaluate(() => window.liveStreamFixture.apply({ videoBitrateKbps: 7300, resolution: '1080p', frameRate: 45 }))
    await expect.poll(() => page.evaluate(() => window.liveStreamFixture.snapshot().videos[0]!.width)).toBe(1920)
    if (mode === 'p2p') {
      await page.evaluate(() => window.liveStreamFixture.addViewer())
      await expect.poll(() => page.evaluate(() => window.liveStreamFixture.snapshot().videos[1]!.frames)).toBeGreaterThan(5)
    }
    const final = await page.evaluate(() => window.liveStreamFixture.snapshot())
    expect(final.ended).toBe(0)
    expect(final.errors).toEqual([])
    expect(final.captureTrackId).toBe(before.captureTrackId)
    for (const peer of final.peers) expect(peer.senders.find((sender) => sender.kind === 'video')!.encodings[0]).toMatchObject({ maxBitrate: 7300000, maxFramerate: 45 })
  } finally { await page.evaluate(() => window.liveStreamFixture?.close()) }
})
