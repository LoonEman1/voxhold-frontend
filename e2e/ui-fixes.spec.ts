import { expect, test } from '@playwright/test'

for (const theme of ['dark', 'light']) {
  test(`${theme} theme keeps fixed avatar and recording geometry and readable recordings`, async ({ page }) => {
    await page.goto('/e2e/fixtures/ui-fixes.html')
    await page.evaluate((value) => { document.documentElement.dataset.theme = value }, theme)
    await expect(page.locator('.member-row .avatar img')).toBeVisible()
    for (const selector of ['.member-row .avatar', '.user-dock .avatar', '.channel-row .record-dot']) {
      const box = await page.locator(selector).first().boundingBox()
      expect(box).toBeTruthy()
      expect(Math.abs(box!.width - box!.height)).toBeLessThan(1)
      expect(box!.width).toBeLessThan(50)
    }
    const palette = await page.locator('.voice-room').evaluate((node) => ({ actual: getComputedStyle(node).backgroundColor, expected: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() }))
    expect(palette.actual).toBe(theme === 'dark' ? 'rgb(16, 16, 15)' : 'rgb(243, 242, 237)')
    await page.getByRole('button', { name: 'Список записей' }).click()
    await expect(page.getByRole('dialog', { name: 'Записи сервера' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Записи сервера' })).toHaveCSS('color', theme === 'dark' ? 'rgb(245, 243, 236)' : 'rgb(32, 33, 29)')
    await expect(page.locator('.recordings-row')).toBeVisible()
    const fits = await page.locator('.modal-card').evaluate((node) => node.scrollWidth <= node.clientWidth + 1)
    expect(fits).toBe(true)
    await page.screenshot({ path: `node_modules/.cache/ui-fixes-${theme}.png`, animations: 'disabled' })
    await page.setViewportSize({ width: 375, height: 812 })
    await expect(page.locator('.recordings-row')).toBeVisible()
    expect(await page.locator('.modal-card').evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true)
  })
}

test('avatar camera menu supports moving, zooming, server crop upload and removal', async ({ page }) => {
  let uploaded = '', bodyBytes = 0, removed = false
  await page.route('**/api/v1/me/avatar*', async (route) => {
    if (route.request().method() === 'DELETE') { removed = true; await route.fulfill({ status: 204 }); return }
    uploaded = route.request().url(); bodyBytes = route.request().postDataBuffer()?.length ?? 0
    await route.fulfill({ json: { etag: 'saved' } })
  })
  await page.goto('/e2e/fixtures/ui-fixes.html')
  await page.getByRole('button', { name: 'Профиль', exact: true }).click()
  const trigger = page.getByRole('button', { name: 'Изменить аватар' })
  await trigger.hover()
  await expect(page.locator('.avatar-editor__camera')).toHaveCSS('opacity', '1')
  await trigger.click()
  await expect(page.getByRole('button', { name: 'Выбрать изображение' })).toBeVisible()
  const data = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 800; canvas.height = 400
    const context = canvas.getContext('2d')!; context.fillStyle = '#ff876f'; context.fillRect(0, 0, 400, 400); context.fillStyle = '#e7ff5b'; context.fillRect(400, 0, 400, 400)
    return canvas.toDataURL('image/png').split(',')[1]
  })
  const file = Buffer.from(data, 'base64')
  await page.getByLabel('Файл аватара').setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: file })
  await expect(page.getByAltText('Предпросмотр круглого аватара')).toBeVisible()
  expect(uploaded).toBe('')
  await page.getByRole('slider', { name: /Масштаб/ }).fill('2')
  await page.getByRole('slider', { name: 'По горизонтали' }).fill('1')
  await page.getByRole('slider', { name: 'По вертикали' }).fill('-1')
  const box = (await page.locator('.avatar-crop__viewport').boundingBox())!
  await page.mouse.move(box.x + 120, box.y + 120); await page.mouse.down(); await page.mouse.move(box.x + 180, box.y + 120); await page.mouse.up()
  await page.screenshot({ path: 'node_modules/.cache/ui-fixes-crop.png', animations: 'disabled' })
  await page.getByRole('button', { name: 'Сохранить аватар' }).click()
  await expect(page.getByAltText('Предпросмотр круглого аватара')).not.toBeVisible()
  const params = new URL(uploaded).searchParams
  expect(Number(params.get('crop_x'))).toBe(550)
  expect(Number(params.get('crop_y'))).toBe(0)
  expect(Number(params.get('crop_size'))).toBe(200)
  expect(bodyBytes).toBe(file.length)
  await trigger.click(); await page.getByRole('button', { name: 'Удалить аватар' }).click()
  await expect.poll(() => removed).toBe(true)
})
