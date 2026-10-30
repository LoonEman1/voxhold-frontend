import { expect, test } from '@playwright/test'
import { writeFileSync } from 'node:fs'

test('measure composer rendering and history bursts on the same fixture', async ({ page }, info) => {
  test.setTimeout(180_000)
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
  await cdp.send('Performance.enable')
  await page.goto('/e2e/fixtures/optimization.html')
  const input = page.getByLabel('Сообщение в optimization')
  await expect(input).toBeVisible()
  await expect(page.locator('[data-message-id="1000"]')).toBeVisible()
  await input.pressSequentially('warm up')
  await input.fill('')
  const rows: unknown[] = []
  for (let round = 1; round <= 5; round++) {
    await page.evaluate(() => { (window as unknown as { optimizationTimings: number[] }).optimizationTimings.length = 0 })
    const before = await cdp.send('Performance.getMetrics')
    await input.pressSequentially('Typing should stay responsive while a large chat is visible. '.repeat(2))
    await expect(input).toHaveValue('Typing should stay responsive while a large chat is visible. '.repeat(2))
    const after = await cdp.send('Performance.getMetrics')
    const renders = await page.evaluate(() => [...(window as unknown as { optimizationTimings: number[] }).optimizationTimings])
    renders.sort((a, b) => a - b)
    const script = (metrics: typeof before) => metrics.metrics.find((m) => m.name === 'ScriptDuration')!.value
    const history = await page.evaluate(async () => (window as unknown as { historyBenchmark: () => Promise<{ elapsed_ms: number; messages: number; last_id: number; notifications: number }> }).historyBenchmark())
    expect(history.messages).toBe(1000); expect(history.last_id).toBe(2000)
    rows.push({ round, script_ms: (script(after) - script(before)) * 1000, commits: renders.length, render_total_ms: renders.reduce((sum, v) => sum + v, 0), render_p95_ms: renders[Math.floor((renders.length - 1) * .95)], history, visible_rows: await page.locator('[data-message-id]').count() })
    await input.fill('')
  }
  const text = JSON.stringify({ label: process.env.VOXHOLD_PERF_LABEL ?? 'unspecified', cpu_throttle: 4, browser: await page.context().browser()!.version(), rows }, null, 2)
  if (process.env.VOXHOLD_PERF_OUTPUT) writeFileSync(process.env.VOXHOLD_PERF_OUTPUT, text + '\n')
  await info.attach('optimization-metrics', { body: text, contentType: 'application/json' })
})
