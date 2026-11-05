import { expect, test, type Page } from '@playwright/test'

async function fixtures(page: Page) {
  const posts: { path: string; body: { destination?: { kind: string; id: number }; payload?: { content: string }; content?: string; attachment_ids?: string[] } }[] = []
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname
    let data: unknown = []
    if (path.endsWith('/message-privacy')) data = { mode: 'shared', blocked_user_ids: [] }
    else if (path.endsWith('/inbox')) data = { items: [], has_more: false }
    else if (path.endsWith('/notifications')) data = { muted: false }
    else if (path.includes('/attachments/') && request.method() === 'PUT') data = { id: path.split('/').at(-1), filename: url.searchParams.get('filename'), mime_type: 'text/plain', size_bytes: 4, deleted: false }
    else if (request.method() === 'POST') {
      const body = request.postDataJSON(); posts.push({ path, body })
      data = { ...body, id: 50 + posts.length, channel_id: 1, conversation_id: 7, author: { user_id: 1, username: 'Вы' }, created_at: 1700000180, edited_at: null }
    } else if (path.endsWith('/messages')) data = { messages: [], has_more: false }
    await route.fulfill({ json: data })
  })
  return posts
}

for (const direct of [false, true]) for (const theme of ['dark', 'light']) for (const width of [1280, 390, 320]) {
  test(`compact composer actions in ${direct ? 'direct' : 'channel'} at ${width}px in ${theme}`, async ({ page }, info) => {
    const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message))
    const posts = await fixtures(page)
    await page.setViewportSize({ width, height: 900 })
    await page.goto(`/e2e/fixtures/composer.html${direct ? '?direct' : ''}`)
    await page.evaluate((value) => { document.documentElement.dataset.theme = value; document.documentElement.style.colorScheme = value }, theme)
    const input = page.getByRole('textbox', { name: direct ? 'Сообщение в беседу' : 'Сообщение в общий-чат', exact: true })
    const trigger = page.getByRole('button', { name: 'Добавить к сообщению', exact: true })
    await expect(trigger).toBeVisible()
    await expect(page.locator('.attachment-upload')).toHaveCount(0)
    await expect(page.locator('.composer-tools')).toHaveCount(0)
    const box = await page.locator('form.composer').boundingBox()
    expect(box!.height).toBeLessThan(65)
    await input.fill('Черновик для отправки позже')
    await page.screenshot({ path: info.outputPath('composer-compact.png'), animations: 'disabled' })
    await trigger.click()
    const menu = page.getByRole('menu', { name: 'Действия с сообщением', exact: true })
    await expect(menu.getByRole('menuitem')).toHaveText([
      /Прикрепить файл/, /Опрос/, /Отложить сообщение/, /Отложенные/,
    ])
    const bounds = await menu.boundingBox()
    expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width)
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual((await page.locator('form.composer').boundingBox())!.y)
    await page.screenshot({ path: info.outputPath('composer-menu.png'), animations: 'disabled' })
    await page.keyboard.press('Escape'); await expect(trigger).toBeFocused()
    await trigger.click(); await menu.getByRole('menuitem', { name: 'Опрос', exact: true }).click()
    const poll = page.getByRole('dialog', { name: 'Новый опрос', exact: true })
    await expect(poll.getByRole('textbox', { name: 'Вопрос', exact: true })).toHaveValue('Черновик для отправки позже')
    await poll.getByRole('button', { name: 'Закрыть', exact: true }).click()
    await trigger.click(); await menu.getByRole('menuitem', { name: 'Отложенные', exact: true }).click()
    const scheduled = page.getByRole('region', { name: 'Отложенные сообщения', exact: true })
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(input).toBeHidden()
    await expect(scheduled.getByText('В этом чате нет отложенных сообщений', { exact: true })).toBeVisible()
    await scheduled.getByRole('button', { name: 'Вернуться к сообщениям', exact: true }).click()
    await expect(input).toHaveValue('Черновик для отправки позже')
    await page.getByRole('button', { name: 'Отправить', exact: true }).click({ delay: 600 })
    await expect(menu).toBeVisible(); expect(posts).toHaveLength(0)
    await expect(input).toHaveValue('Черновик для отправки позже')
    await menu.getByRole('menuitem', { name: 'Отложить сообщение', exact: true }).click()
    const schedule = page.getByRole('dialog', { name: 'Отложенное сообщение', exact: true })
    await expect(schedule.getByRole('textbox', { name: 'Сообщение', exact: true })).toHaveValue('Черновик для отправки позже')
    await schedule.getByRole('button', { name: 'Запланировать', exact: true }).click()
    await expect(schedule).toHaveCount(0); await expect(input).toHaveValue('')
    expect(posts[0]!.body.destination).toMatchObject({ kind: direct ? 'conversation' : 'channel', id: direct ? 7 : 1 })
    expect(posts[0]!.body.payload?.content).toBe('Черновик для отправки позже')
    await trigger.click()
    const chooser = page.waitForEvent('filechooser')
    await menu.getByRole('menuitem', { name: 'Прикрепить файл', exact: true }).click()
    await (await chooser).setFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('test') })
    await expect(page.getByRole('list', { name: 'Вложения к сообщению' })).toBeVisible()
    await expect(page.getByText(/Готово к отправке/)).toBeVisible()
    await input.fill('Отправляем с файлом')
    await page.getByRole('button', { name: 'Отправить', exact: true }).click()
    await expect(input).toHaveValue(''); await expect(page.locator('.attachment-upload')).toHaveCount(0)
    expect(posts[1]!.body.attachment_ids).toHaveLength(1)
    expect(posts).toHaveLength(2)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect(errors).toEqual([])
  })
}
