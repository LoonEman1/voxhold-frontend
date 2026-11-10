import { expect, test, type Page } from '@playwright/test'

declare global {
  interface Window { reliabilityFixture: { mutateOffline(): void; resync(): void; sentCount(): number; requests: string[]; setOffline(value: boolean): void; holdSends(): void; releaseSends(): void } }
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

test('scrolling just above the latest messages keeps the reading position on resize', async ({ page }) => {
  await page.goto('/e2e/fixtures/reliability.html')
  await expect(page.locator('[data-message-id="500"]')).toBeInViewport()
  const history = page.locator('.messages')
  const bottomGap = () => history.evaluate((root) => root.scrollHeight - root.scrollTop - root.clientHeight)
  await expect.poll(() => history.evaluate((root) => root.scrollTop)).toBeGreaterThan(90)
  await expect.poll(bottomGap).toBeLessThanOrEqual(2)
  await history.hover()
  await page.mouse.wheel(0, -90)
  await expect.poll(bottomGap).toBeGreaterThan(60)
  const before = await anchor(page)
  const viewport = page.viewportSize()!

  await page.setViewportSize({ ...viewport, height: viewport.height - 50 })

  await expect.poll(bottomGap).toBeGreaterThan(110)
  const after = await anchor(page)
  expect(after.id).toBe(before.id)
  expect(Math.abs(after.offset - before.offset)).toBeLessThan(2)
})

test('workspace retries a lost send response with one saved message', async ({ page }) => {
  await page.goto('/e2e/fixtures/reliability.html')
  await expect(page.locator('[data-message-id="500"]')).toBeVisible()
  await page.evaluate(() => window.reliabilityFixture.holdSends())
  await page.getByLabel('Сообщение в канал-1').fill('Повтор без дубля')
  await page.getByLabel('Сообщение в канал-1').press('Enter')
  await expect(page.locator('.message-pending')).toContainText('Повтор без дубля')
  await expect(page.getByRole('button', { name: 'Ожидает отправки', exact: true })).toBeVisible()
  await page.evaluate(() => window.reliabilityFixture.releaseSends())
  await expect(page.locator('.message-pending')).toHaveCount(0)
  await expect(page.locator('[data-message-id="501"]')).toContainText('Повтор без дубля')
  expect(await page.evaluate(() => window.reliabilityFixture.sentCount())).toBe(1)
})

test('workspace persists an outbox, follows rapid sends and retries after reconnect', async ({ page }) => {
  await page.goto('/e2e/fixtures/reliability.html')
  await expect(page.locator('[data-message-id="500"]')).toBeVisible()
  const composer = page.getByLabel('Сообщение в канал-1')
  await page.evaluate(() => window.reliabilityFixture.holdSends())
  for (const content of ['Первое', 'Второе', 'Третье']) {
    await composer.fill(content)
    await composer.press('Enter')
    await expect(composer).toHaveValue('')
  }
  await expect(page.locator('.message-pending p')).toHaveText(['Первое', 'Второе', 'Третье'])
  await expect.poll(async () => page.locator('.messages').evaluate((root) => root.scrollHeight - root.scrollTop - root.clientHeight)).toBeLessThan(2)
  expect(await page.evaluate(() => window.reliabilityFixture.requests.filter((path) => path.startsWith('POST ') && path.endsWith('/messages')).length)).toBe(1)
  await page.evaluate(() => { window.reliabilityFixture.setOffline(true); window.reliabilityFixture.releaseSends() })
  await expect(page.getByRole('button', { name: 'Ожидает отправки', exact: true })).toHaveCount(3)
  await page.reload()
  await expect(page.locator('[data-message-id="500"]')).toBeVisible()
  await expect(page.locator('.message-pending p')).toHaveText(['Первое', 'Второе', 'Третье'])
  await expect.poll(async () => page.locator('.messages').evaluate((root) => root.scrollHeight - root.scrollTop - root.clientHeight)).toBeLessThan(2)
  await page.locator('.message-pending').last().click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Удалить', exact: true }).click()
  await expect(page.locator('.message-pending')).toHaveCount(2)
  await page.reload()
  await expect(page.locator('.message-pending p')).toHaveText(['Первое', 'Второе'])
  await page.evaluate(() => { window.reliabilityFixture.setOffline(false); window.reliabilityFixture.holdSends(); window.dispatchEvent(new Event('online')) })
  await expect(page.getByRole('button', { name: 'Ожидает отправки', exact: true })).toHaveCount(2)
  await page.evaluate(() => window.reliabilityFixture.releaseSends())
  await expect(page.locator('.message-pending')).toHaveCount(0)
  await expect(page.locator('[data-message-id="501"]')).toContainText('Первое')
  await expect(page.locator('[data-message-id="502"]')).toContainText('Второе')
  await expect(page.locator('[data-message-id="503"]')).toHaveCount(0)
  await expect.poll(async () => page.locator('.messages').evaluate((root) => root.scrollHeight - root.scrollTop - root.clientHeight)).toBeLessThan(2)
  await expect.poll(async () => page.evaluate(() => Object.keys(localStorage).some((key) => key.startsWith('voxhold.outbox.v1:')))).toBe(false)
})

test('rapid acknowledgements keep the newest message in view in a mixed-height history', async ({ page }) => {
  await page.goto('/e2e/fixtures/reliability.html?link-history')
  await expect(page.locator('[data-message-id="500"]')).toBeInViewport()
  await page.evaluate(() => window.reliabilityFixture.setOffline(false))
  const history = page.locator('.messages')
  const bottomGap = () => history.evaluate((root) => root.scrollHeight - root.scrollTop - root.clientHeight)
  const composer = page.getByLabel('Сообщение в канал-1')

  for (let index = 1; index <= 8; index++) {
    await composer.fill(`Быстрая отправка ${index}`)
    await composer.press('Enter')
  }

  await expect(page.locator('.message-pending')).toHaveCount(0)
  await expect(page.locator('[data-message-id="508"]')).toBeInViewport({ ratio: 1 })
  await expect.poll(bottomGap).toBeLessThanOrEqual(2)
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

test('sending from an old quoted message returns to the latest history', async ({ page }) => {
  await page.goto('/e2e/fixtures/reliability.html?deep-reply')
  await page.getByRole('button', { name: 'Перейти к сообщению Alice', exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.reliabilityFixture.requests.some((path) => path.includes('/100/context')))).toBe(true)
  await expect(page.locator('[data-message-id="500"]')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'К новым сообщениям' })).toBeVisible()
  await page.evaluate(() => window.reliabilityFixture.setOffline(false))
  const composer = page.getByLabel('Сообщение в канал-1')
  await composer.fill('После перехода к старому сообщению')
  await composer.press('Enter')
  const sent = page.locator('[data-message-id="501"]')
  await expect(sent).toBeInViewport()
  const history = page.locator('.messages')
  const bottomGap = () => history.evaluate((root) => root.scrollHeight - root.scrollTop - root.clientHeight)
  // DOM scroll metrics and virtualized row sizes can round differently.
  await expect.poll(bottomGap).toBeLessThanOrEqual(2)
  const historyHeight = await history.evaluate((root) => root.clientHeight)
  await sent.hover()
  await sent.getByRole('button', { name: 'Ответить на сообщение' }).click()
  await expect(page.getByRole('button', { name: 'Отменить ответ' })).toBeVisible()
  await expect.poll(() => history.evaluate((root) => root.clientHeight)).toBeLessThan(historyHeight)
  await expect.poll(bottomGap).toBeLessThanOrEqual(2)
})
