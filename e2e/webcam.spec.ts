import { expect, test } from '@playwright/test'
declare global { interface Window { webcamHarness: { settings: () => MediaTrackSettings | undefined; errors: string[]; diagnostics: () => Promise<unknown> } } }

test.afterEach(async ({ page }, info) => {
  if (info.status !== info.expectedStatus) {
    const diagnostics = await page.evaluate(async () => ({ errors: window.webcamHarness?.errors, camera: window.webcamHarness?.settings(), peers: await window.webcamHarness?.diagnostics() }))
    await info.attach('camera-diagnostics', { body: JSON.stringify(diagnostics, null, 2), contentType: 'application/json' })
  }
})

for (const publisherId of [1, 2]) test(`camera replaces the card, expands and changes quality from peer ${publisherId} while screen and voice stay independent`, async ({ page }) => {
  const name = publisherId === 1 ? 'Alice' : 'Bob'
  await page.goto(`/e2e/fixtures/webcam.html?publisher=${publisherId}`)
  await page.getByRole('button', { name: 'Камера', exact: true }).click()
  await expect(page.getByRole('group', { name: 'Качество камеры' }).getByRole('button')).toHaveCount(3)
  await page.getByRole('button', { name: 'Низкое' }).click()
  await page.getByRole('button', { name: 'Включить камеру', exact: true }).click()
  const tile = page.locator('.camera-tile')
  await expect(tile).toHaveCount(1, { timeout: 15_000 })
  await expect(tile.locator('footer')).toContainText(name)
  await expect(page.locator('.voice-participant')).toHaveCount(1)
  await expect.poll(() => tile.locator('video').evaluate((video) => video.getVideoPlaybackQuality().totalVideoFrames)).toBeGreaterThan(3)
  await tile.getByRole('button', { name: `Развернуть камеру: ${name}` }).click()
  await expect(page.getByRole('dialog', { name: `Камера · ${name}` })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByRole('button', { name: 'Экран', exact: true }).click()
  await expect(page.locator('.call-stream-tile video')).toBeVisible()
  await expect.poll(() => page.locator('.call-stream-tile video').evaluate((video) => (video as HTMLVideoElement).getVideoPlaybackQuality().totalVideoFrames)).toBeGreaterThan(3)
  await page.getByRole('button', { name: 'Камера', exact: true }).click()
  await page.getByRole('button', { name: 'Высокое' }).click()
  await page.getByRole('button', { name: 'Применить' }).click()
  await expect.poll(() => page.evaluate(() => window.webcamHarness.settings()?.height)).toBe(1080)
  await page.locator('main > header').getByRole('button', { name: 'Выключить микрофон' }).click()
  await expect(tile).toHaveCount(1)
  await page.getByRole('button', { name: 'Выключить камеру', exact: true }).click()
  await expect(tile).toHaveCount(0)
  await expect(page.locator('.voice-participant')).toHaveCount(2)
  await expect(page.locator('.call-stream-tile video')).toBeVisible()
  await page.getByRole('button', { name: 'Камера', exact: true }).click()
  await page.getByRole('button', { name: 'Включить камеру', exact: true }).click()
  await expect(tile).toHaveCount(1)
  await expect.poll(() => tile.locator('video').evaluate((video) => video.getVideoPlaybackQuality().totalVideoFrames)).toBeGreaterThan(3)
  await expect(page.locator('.call-stream-tile video')).toBeVisible()
  await page.screenshot({ path: 'node_modules/.cache/webcam-preview.png' })
  expect(await page.evaluate(() => window.webcamHarness.errors)).toEqual([])
})
