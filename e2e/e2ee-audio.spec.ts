import { expect, test } from '@playwright/test'
import type { AudioProbe } from './fixtures/e2ee-audio'

test.beforeEach(async ({ page }) => {
  await page.goto('/e2e/fixtures/e2ee-audio.html', { waitUntil: 'networkidle' })
})

for (const mode of ['none', 'script', 'streams'] as const) {
  test(`preserves decoded audio after SFU renegotiation using ${mode}`, async ({ page }) => {
    const result = await page.evaluate(async (selected) => {
      return (window as unknown as { e2eeAudioProbe: AudioProbe }).e2eeAudioProbe.runSession(selected)
    }, mode)
    expect(result.connected).toBe(true)
    expect(result.errors).toEqual([])
    expect(result.rms).toBeGreaterThan(0.05)
    expect(result.toneRatio).toBeGreaterThan(0.95)
    if (mode !== 'none') {
      expect(result.encrypted).toBeGreaterThan(100)
      expect(result.decrypted).toBeGreaterThan(100)
      expect(result.authDrops).toBe(0)
      expect(result.unknownKeyDrops).toBe(0)
    }
  })
}

for (const mode of ['script', 'streams'] as const) {
  for (const keyState of ['wrong', 'missing'] as const) {
    test(`keeps ciphertext out of the decoder with a ${keyState} key using ${mode}`, async ({ page }) => {
      const result = await page.evaluate(async ({ selected, keys }) => {
        return (window as unknown as { e2eeAudioProbe: AudioProbe }).e2eeAudioProbe.runSession(selected, keys)
      }, { selected: mode, keys: keyState })
      expect(result.connected).toBe(true)
      expect(result.errors).toEqual([])
      expect(result.encrypted).toBeGreaterThan(100)
      // Empty encoded frames carry no audio and may pass without a key.
      // Check actual decoded samples and authenticated drops, not that count.
      expect(result.rms).toBeLessThan(0.0001)
      expect(keyState === 'wrong' ? result.authDrops : result.unknownKeyDrops).toBeGreaterThan(100)
    })
  }
}
