import { expect, test } from '@playwright/test'

for (const width of [1280, 390, 320]) {
  test(`image cards follow portrait and landscape widths at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 })
    const images = await page.evaluate(() => [ [200, 400], [400, 200], [200, 400] ].map(([w, h]) => {
      const canvas = document.createElement('canvas'); canvas.width = w!; canvas.height = h!
      const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#718376'; ctx.fillRect(0, 0, w!, h!)
      return canvas.toDataURL('image/png').split(',')[1]!
    }))
    const attachments = [{ width: 400, height: 800 }, { width: 1200, height: 600 }, {}].map((size, index) => ({ id: `image-${index}`, filename: `very-long-original-image-filename-${index}.png`, mime_type: 'image/png', size_bytes: 2048, deleted: false, ...size }))
    await page.route('**/api/v1/**', async (route) => {
      const path = new URL(route.request().url()).pathname
      if (path.endsWith('/thumbnail')) {
        const index = Number(path.split('/').at(-2)!.split('-')[1])
        await route.fulfill({ contentType: 'image/png', body: Buffer.from(images[index]!, 'base64') }); return
      }
      const data = path.endsWith('/messages') ? { messages: [{ id: 1, conversation_id: 7, author: { user_id: 1, username: 'Вы' }, content: 'Изображения', created_at: 1700000000, client_message_id: 'images', attachments }], has_more: false } : path.endsWith('/notifications') ? { muted: false } : path.endsWith('/inbox') ? { items: [], has_more: false } : path.endsWith('/message-privacy') ? { mode: 'shared', blocked_user_ids: [] } : []
      await route.fulfill({ json: data })
    })
    await page.goto('/e2e/fixtures/composer.html?direct')
    for (let index = 0; index < attachments.length; index++) {
      const image = page.locator('.attachment-card img').nth(index)
      await image.scrollIntoViewIfNeeded()
      await expect.poll(() => image.evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
      const card = await page.locator('.attachment-card').nth(index).boundingBox(), box = await image.boundingBox()
      expect(Math.abs(card!.width - box!.width - 2)).toBeLessThan(1)
      expect(card!.x + card!.width).toBeLessThanOrEqual(width)
      if (index === 0 || index === 2) expect(card!.width).toBeLessThanOrEqual(160)
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: info.outputPath('image-cards.png') })
  })
}

for (const direct of [false, true]) {
  test(`scheduled messages replace ${direct ? 'direct' : 'channel'} history and disappear after sending`, async ({ page }, info) => {
    let sent = false
    await page.route('**/api/v1/**', async (route) => {
      const path = new URL(route.request().url()).pathname
      const data = path.endsWith('/scheduled-messages') ? sent ? [] : [{ id: 3, destination: { kind: direct ? 'conversation' : 'channel', id: direct ? 7 : 1 }, payload: { content: 'Увидимся завтра!' }, send_at: Math.floor(Date.now() / 1000) + 86400, status: 'pending', error: '' }] : path.endsWith('/messages') ? { messages: [], has_more: false } : path.endsWith('/notifications') ? { muted: false } : path.endsWith('/inbox') ? { items: [], has_more: false } : path.endsWith('/message-privacy') ? { mode: 'shared', blocked_user_ids: [] } : []
      await route.fulfill({ json: data })
    })
    await page.goto(`/e2e/fixtures/composer.html${direct ? '?direct' : ''}`)
    const input = page.getByRole('textbox', { name: direct ? 'Сообщение в беседу' : 'Сообщение в общий-чат', exact: true })
    await input.fill('Сохранённый черновик')
    await page.getByRole('button', { name: 'Добавить к сообщению', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Отложенные', exact: true }).click()
    const history = page.getByRole('region', { name: 'Отложенные сообщения', exact: true })
    await expect(history.getByText('Увидимся завтра!')).toBeVisible()
    await expect(input).toBeHidden()
    await expect(page.locator('.messages')).toBeHidden()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    const message = await history.locator('article > p').boundingBox(), date = await history.locator('article > time').boundingBox()
    expect(date!.y).toBeGreaterThanOrEqual(message!.y + message!.height)
    await page.screenshot({ path: info.outputPath('scheduled-history.png') })
    sent = true
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('voxhold:community', { detail: { type: 'conversation.scheduled', data: { id: 3, status: 'sent' } } })))
    await expect(history.getByText('Увидимся завтра!')).toHaveCount(0)
    await expect(history.getByText('В этом чате нет отложенных сообщений')).toBeVisible()
    await history.getByRole('button', { name: 'Вернуться к сообщениям' }).click()
    await expect(input).toHaveValue('Сохранённый черновик')
    await expect(input).toBeVisible()
  })
}
