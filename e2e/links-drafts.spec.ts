import { expect, test, type Page } from '@playwright/test'

const portraitThumbnail = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAABaCAIAAAA+UkE8AAAAK0lEQVR4nO3LMQ0AAAgDsHnjRg7+0cBNk75N9ZxEEARBEARBEARBEAThS1g8o7xsXyo/+gAAAABJRU5ErkJggg==', 'base64')

for (const mode of ['latest', 'history', 'direct']) for (const width of [1280, 390]) {
  test(`delayed previews preserve ${mode} viewport at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 })
    let releaseModule!: () => void, releaseMetadata!: () => void, releaseImages!: () => void
    const module = new Promise<void>((resolve) => { releaseModule = resolve })
    const metadata = new Promise<void>((resolve) => { releaseMetadata = resolve })
    const images = new Promise<void>((resolve) => { releaseImages = resolve })
    let moduleRequests = 0, requests = 0
    await page.route('**/src/components/MessageLinks.tsx*', async (route) => {
      moduleRequests++; await module; await route.continue()
    })
    await page.route('**/api/v1/**', async (route) => {
      const url = new URL(route.request().url())
      if (url.pathname === '/api/v1/link-preview') {
        requests++; await metadata
        const href = url.searchParams.get('url')!
        if (href.includes('other.example') && Number(href.split('/').at(-1)) % 2) {
          await route.fulfill({ status: 500, json: { error: 'unavailable' } }); return
        }
        await route.fulfill({ json: href.includes('other.example') ? null : { url: href, title: 'Длинный заголовок статьи '.repeat(8), description: 'Описание '.repeat(40), site_name: 'Publisher', image_path: '/api/v1/link-preview/images/' + 'a'.repeat(64) } })
      } else if (url.pathname.includes('/link-preview/images/')) {
        await images
        await route.fulfill({ contentType: 'image/png', body: portraitThumbnail })
      } else await route.fulfill({ json: url.pathname.endsWith('/inbox') ? { items: [], has_more: false } : url.pathname.endsWith('/message-privacy') ? { mode: 'shared', blocked_user_ids: [] } : [] })
    })
    await page.goto(`/e2e/fixtures/preview-layout.html?${mode}`)
    const root = page.locator('.messages')
    try {
      await expect.poll(() => moduleRequests).toBeGreaterThan(0)
      await expect(root.locator('.link-preview').first()).toBeAttached()
      // Let initial positioning and virtual measurements settle while metadata is held.
      await root.evaluate(async () => { for (let i = 0; i < 20; i++) await new Promise(requestAnimationFrame) })
      const before = await root.evaluate((node) => {
        const top = node.getBoundingClientRect().top
        const row = [...node.querySelectorAll<HTMLElement>('article.message')].find((row) => row.getBoundingClientRect().bottom > top + 2)!
        return { id: row.dataset.messageId, text: row.querySelector('p')?.textContent, offset: row.getBoundingClientRect().top - top, height: node.scrollHeight, scroll: node.scrollTop }
      })
      releaseModule()
      await expect.poll(() => requests).toBeGreaterThan(0)
      releaseMetadata()
      await expect(root.locator('.link-preview').filter({ hasText: 'Длинный заголовок' }).first()).toBeVisible()
      releaseImages()
      await expect(root.locator('.link-preview img').first()).toHaveJSProperty('naturalHeight', 90)
      await root.evaluate(async () => { for (let i = 0; i < 20; i++) await new Promise(requestAnimationFrame) })
      const after = await root.evaluate((node, before) => {
        const row = [...node.querySelectorAll<HTMLElement>('article.message')].find((row) => before.id ? row.dataset.messageId === before.id : row.querySelector('p')?.textContent === before.text)!
        return { found: !!row, offset: row?.getBoundingClientRect().top - node.getBoundingClientRect().top, height: node.scrollHeight, scroll: node.scrollTop }
      }, before)
      expect(after.found, 'the original visible message must remain mounted').toBe(true)
      expect(Math.abs(after.offset - before.offset)).toBeLessThanOrEqual(1)
      expect(Math.abs(after.height - before.height)).toBeLessThanOrEqual(1)
      expect(Math.abs(after.scroll - before.scroll)).toBeLessThanOrEqual(1)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      if (mode === 'latest') await page.screenshot({ path: info.outputPath(`stable-previews-${width}.png`), animations: 'disabled' })
    } finally { releaseModule(); releaseMetadata(); releaseImages() }
  })
}

async function fixtures(page: Page) {
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname === '/api/v1/link-preview') {
      const href = url.searchParams.get('url')!
      const site = new URL(href).hostname
      const title = site.includes('youtube') ? 'Видео YouTube: восстановление связи' : site === 'dtf.ru' ? 'DTF: обзор новой игры' : 'Универсальная карточка статьи'
      await route.fulfill({ json: { url: href, title, description: 'Заголовок и изображение из метаданных страницы', site_name: site, image_path: '/api/v1/link-preview/images/' + 'a'.repeat(64) } }); return
    }
    if (url.pathname.includes('/link-preview/images/')) {
      await route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="384"><rect width="640" height="384" fill="#434d75"/><circle cx="320" cy="180" r="80" fill="#a993ff"/><path d="M300 140L360 180L300 220Z" fill="white"/></svg>' }); return
    }
    await route.fulfill({ json: url.pathname.endsWith('/inbox') ? { items: [], has_more: false } : url.pathname.endsWith('/message-privacy') ? { mode: 'shared', blocked_user_ids: [] } : [] })
  })
}
test('universal article and video previews render with safe clickable links', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message))
  await fixtures(page); await page.goto('/e2e/fixtures/links-drafts.html')
  await expect(page.getByRole('link', { name: /Универсальная карточка статьи/ })).toBeVisible()
  await expect(page.getByRole('link', { name: /Видео YouTube:/ })).toBeVisible()
  await expect(page.getByRole('link', { name: /DTF: обзор/ })).toBeVisible()
  await expect(page.locator('.link-preview img')).toHaveCount(3)
  await expect(page.locator('.message-link').first()).toHaveAttribute('rel', /noopener/)
  await expect(page.locator('.message-link').first()).toHaveAttribute('target', '_blank')
  await page.screenshot({ path: info.outputPath('link-cards-desktop.png'), animations: 'disabled' })
  expect(errors).toEqual([])
})
test('drafts survive channel navigation and reload and clear after sending', async ({ page }) => {
  await fixtures(page); await page.goto('/e2e/fixtures/links-drafts.html')
  await page.getByLabel('Сообщение в general').fill('Черновик канала A')
  await page.getByRole('button', { name: 'Канал B', exact: true }).click()
  await expect(page.getByLabel('Сообщение в other')).toHaveValue('')
  await page.getByLabel('Сообщение в other').fill('Черновик канала B')
  await page.getByRole('button', { name: 'Канал A', exact: true }).click()
  await expect(page.getByLabel('Сообщение в general')).toHaveValue('Черновик канала A')
  await page.reload(); await expect(page.getByLabel('Сообщение в general')).toHaveValue('Черновик канала A')
  await page.getByRole('button', { name: 'Отправить', exact: true }).click()
  await expect(page.getByLabel('Сообщение в general')).toHaveValue('')
  await page.reload(); await expect(page.getByLabel('Сообщение в general')).toHaveValue('')
})
test('custom-role moderation and cards fit a narrow viewport', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 }); await fixtures(page)
  await page.goto('/e2e/fixtures/links-drafts.html')
  await page.locator('[data-message-id="2"]').click({ button: 'right', position: { x: 2, y: 2 } })
  await expect(page.getByRole('menuitem', { name: 'Закрепить', exact: true })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Удалить', exact: true })).toBeVisible()
  await page.getByRole('menuitem', { name: 'Закрепить', exact: true }).click()
  await expect(page.locator('[data-message-id="2"] .message__pin-label')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: info.outputPath('link-cards-mobile.png'), animations: 'disabled' })
})
