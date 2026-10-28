import { expect, test, type Page } from '@playwright/test'

declare global {
  interface Window { reliabilityFixture: { mutateOffline(): void; resync(): void; sentCount(): number; requests: string[] } }
}
test.beforeEach(async ({ page }) => { await page.route('**/api/v1/diagnostics/client-events', (route) => route.fulfill({ status: 204 })) })
async function anchor(page: Page) {
  return page.locator('.messages').evaluate((root) => {
    const top = root.getBoundingClientRect().top
    const first = [...root.querySelectorAll<HTMLElement>('[data-message-id]')].find((row) => row.getBoundingClientRect().bottom > top + 2)
    return { id: first?.dataset.messageId, offset: (first?.getBoundingClientRect().top ?? 0) - top }
  })
}

test('workspace restores cached history position while refreshing it and bounds a large member list', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/e2e/fixtures/reliability.html')
  await expect(page.locator('[data-message-id="500"]')).toBeVisible()
  await page.locator('.messages').evaluate((root) => { root.scrollTop -= 500 })
  await page.waitForTimeout(150)
  const before = await anchor(page)
  await page.locator('.channel-sidebar').getByRole('button', { name: /канал-2/ }).click()
  await expect(page.locator('[data-message-id="1500"]')).toBeVisible()
  await page.locator('.channel-sidebar').getByRole('button', { name: /канал-1/ }).click()
  await expect.poll(async () => (await anchor(page)).id).toBe(before.id)
  expect(Math.abs((await anchor(page)).offset - before.offset)).toBeLessThan(6)
  const toggle = page.getByTitle('Показать участников', { exact: true })
  if (await toggle.isVisible()) await toggle.click()
  await expect(page.locator('.members-sidebar__scroll')).toHaveAttribute('data-virtualized', 'true')
  expect(await page.locator('.member-row').count()).toBeLessThan(60)
  await page.locator('.members-sidebar__scroll').evaluate((root) => { root.scrollTop = root.scrollHeight })
  await expect(page.locator('.member-row').filter({ hasText: 'Участник 2500' })).toBeVisible()
  expect(errors).toEqual([])
})

test('workspace resync applies offline edits and deletes without a full reload', async ({ page }) => {
  await page.goto('/e2e/fixtures/reliability.html')
  await expect(page.locator('[data-message-id="500"]')).toBeVisible()
  await expect(page.locator('[data-message-id="491"]')).toHaveCount(1)
  await page.evaluate(() => { window.reliabilityFixture.mutateOffline(); window.reliabilityFixture.resync() })
  await expect(page.locator('[data-message-id="490"]')).toContainText('Правка во время обрыва')
  await expect(page.locator('[data-message-id="491"]')).toHaveCount(0)
})

test('workspace retries a lost send response with one saved message', async ({ page }) => {
  await page.goto('/e2e/fixtures/reliability.html')
  await expect(page.locator('[data-message-id="500"]')).toBeVisible()
  await page.getByLabel('Сообщение в канал-1').fill('Повтор без дубля')
  await page.getByLabel('Сообщение в канал-1').press('Enter')
  await expect(page.locator('.message-pending--failed')).toContainText('Повтор без дубля')
  await page.getByRole('button', { name: 'Повторить', exact: true }).click()
  await expect(page.locator('.message-pending')).toHaveCount(0)
  await expect(page.locator('[data-message-id="501"]')).toContainText('Повтор без дубля')
  expect(await page.evaluate(() => window.reliabilityFixture.sentCount())).toBe(1)
})

test('rapid reply clicks keep mounted history and reuse a cached target', async ({ page }) => {
  await page.goto('/e2e/fixtures/reliability.html')
  await expect(page.locator('[data-message-id="500"]')).toBeVisible()
  await page.locator('.messages').evaluate((root) => {
    Object.assign(window, { replySkeletons: 0 })
    new MutationObserver(() => {
      if (root.querySelector('.message-skeletons')) (window as unknown as { replySkeletons: number }).replySkeletons++
    }).observe(root, { childList: true, subtree: true })
  })
  const quote = page.getByRole('button', { name: 'Перейти к сообщению Alice', exact: true })
  for (let index = 0; index < 30; index++) await quote.click({ force: true })
  await expect(page.locator('[data-message-id="490"]')).toBeVisible()
  expect(await page.evaluate(() => (window as unknown as { replySkeletons: number }).replySkeletons)).toBe(0)
  expect(await page.evaluate(() => window.reliabilityFixture.requests.filter((path) => path.includes('/context')).length)).toBe(0)
})
