import { expect, test } from '@playwright/test'

test('an encoder stall recovers video on the same connection without ending capture', async ({ page }) => {
  await page.goto('/e2e/fixtures/encoder-recovery.html')
  await page.getByRole('button', { name: 'Начать проверку' }).click()
  await expect(page.getByTestId('connection')).toHaveText('connected')
  await expect.poll(() => page.evaluate(() => (window as unknown as { recoveryProbe: { repairs: number } }).recoveryProbe.repairs), { timeout: 25_000 }).toBe(1)
  await expect.poll(() => page.evaluate(async () => {
    const probe = (window as unknown as { recoveryProbe: { decoded: () => Promise<number> } }).recoveryProbe
    return probe.decoded()
  }), { timeout: 10_000 }).toBeGreaterThan(12)
  expect(await page.evaluate(() => {
    const probe = (window as unknown as { recoveryProbe: { originalCaptureLive: () => boolean; samePeer: () => boolean } }).recoveryProbe
    return { capture: probe.originalCaptureLive(), connection: probe.samePeer() }
  })).toEqual({ capture: true, connection: true })
  await expect(page.getByTestId('errors')).toBeEmpty()
})
