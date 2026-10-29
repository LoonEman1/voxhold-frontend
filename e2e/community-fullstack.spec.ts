import { expect, test, type Page } from '@playwright/test'
// Run against an isolated migrated instance seeded with qaowner/qamember/qafriend.
const password = 'Community2.3-Test!'
async function session(page: Page, username: string) {
  const response = await page.request.post('/api/v1/auth/login', { data: { username, password } }); expect(response.ok()).toBeTruthy(); const auth = await response.json() as { user: { id: number }; session: { token: string } }
  if (username === 'qaowner') { const allowed = await page.request.put('/api/v1/instance/cors-origins', { headers: { Authorization: `Bearer ${auth.session.token}` }, data: { origins: ['http://127.0.0.1:4193'] } }); expect(allowed.ok()).toBeTruthy() }
  await page.addInitScript((auth) => localStorage.setItem('voxhold.session.v1', JSON.stringify(auth)), auth)
  await page.goto('/'); await expect(page.getByRole('button', { name: 'Настройки сервера' })).toBeVisible(); return auth
}
test('new community features work against the real backend', async ({ page, browser }, testInfo) => {
  const owner = await session(page, 'qaowner')
  const threadText = `Ответ внутри обычного текстового обсуждения ${Date.now()}`
  const roleName = `Редакция QA ${Date.now()}`, cardRoleName = `Друзья карточка ${Date.now()}`
  const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message))
  await page.getByRole('button', { name: /^qa-chat/ }).click()
  await page.locator('.message').first().click({ button: 'right' }); await page.getByRole('menuitem', { name: /^(Начать|Открыть) обсуждение$/ }).click()
  const discussion = page.getByRole('complementary', { name: 'Комментарии к публикации' })
  await expect(discussion).toBeVisible(); await discussion.locator('textarea').fill(threadText); await discussion.locator('textarea').press('Enter')
  await expect(discussion.getByText(threadText, { exact: true })).toBeVisible()
  await expect(page.locator('.chat-panel').first().locator('.messages').first().getByText(threadText, { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Закрыть комментарии' }).click()
  const png = Buffer.from(await page.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 64; const context = canvas.getContext('2d')!; context.fillStyle = '#8096f2'; context.fillRect(0, 0, 64, 64); return canvas.toDataURL('image/png').split(',')[1]! }), 'base64')
  await page.locator('.attachment-picker input').first().setInputFiles({ name: 'screenshot.png', mimeType: 'image/png', buffer: png })
  await expect(page.getByText('Готово к отправке', { exact: false }).first()).toBeVisible(); await page.getByRole('textbox', { name: 'Сообщение в qa-chat', exact: true }).fill('Картинка с подписью'); await page.getByRole('button', { name: 'Отправить', exact: true }).click(); await expect(page.locator('.attachment-image img')).toBeVisible(); await page.locator('.attachment-image').click(); await expect(page.getByRole('dialog', { name: 'screenshot.png' })).toBeVisible(); await page.getByRole('dialog', { name: 'screenshot.png' }).getByRole('button', { name: 'Закрыть', exact: true }).click()
  await page.getByRole('button', { name: 'Настройки сервера', exact: true }).click(); await page.getByRole('button', { name: 'Хранилище', exact: true }).click()
  const storage = page.getByRole('dialog', { name: 'Настройки сервера' }); await expect(storage.getByRole('img')).toBeVisible(); await storage.getByLabel('Период').selectOption('0'); await page.waitForTimeout(1100); await storage.getByRole('button', { name: 'Рассчитать очистку' }).click(); await expect(storage.getByText(/Будет удалено: 1/)).toBeVisible(); await storage.getByRole('button', { name: /Подтвердить удаление/ }).click(); await expect(storage.getByRole('status')).toContainText('Удалено 1'); await storage.getByRole('button', { name: 'Закрыть', exact: true }).click()
  await expect(page.getByText('Вложение удалено сервером · screenshot.png').last()).toBeVisible()
  await page.getByRole('button', { name: 'Настройки сервера', exact: true }).click(); await page.getByRole('button', { name: 'Роли и права', exact: true }).click()
  const roles = page.getByRole('dialog', { name: 'Настройки сервера' }); await roles.getByRole('button', { name: 'Создать роль', exact: true }).click(); await roles.getByLabel('Название роли').fill(roleName); await roles.getByLabel('Управлять сообщениями').check(); await roles.getByRole('button', { name: 'Сохранить роль' }).click(); await expect(roles.locator('.role-list').getByText(roleName, { exact: true })).toBeVisible(); await roles.getByRole('button', { name: 'Посмотреть как участник этой роли' }).last().click(); await expect(roles.getByLabel('Предпросмотр роли')).toContainText('qa-chat'); await page.screenshot({ path: testInfo.outputPath('roles-and-preview.png'), fullPage: true }); await roles.getByRole('button', { name: 'Закрыть', exact: true }).click()
  await page.locator('.members-sidebar .member-row').filter({ hasText: 'qamember' }).click()
  const card = page.getByRole('dialog', { name: 'Карточка участника' })
  await card.getByRole('button', { name: 'Добавить роль' }).click()
  await card.getByRole('checkbox', { name: `Назначить роль ${roleName}`, exact: true }).click()
  await expect(card.getByRole('checkbox', { name: `Назначить роль ${roleName}`, exact: true })).toBeChecked()
  await expect(card.getByRole('button', { name: `Снять роль ${roleName}`, exact: true })).toBeVisible()
  await card.getByRole('button', { name: 'Создать новую роль' }).click()
  await card.getByLabel('Название роли').fill(cardRoleName)
  await card.getByRole('button', { name: 'Создать и назначить' }).click()
  await expect(card.getByRole('button', { name: `Снять роль ${cardRoleName}`, exact: true })).toBeVisible()
  await card.getByRole('button', { name: 'Открыть профиль qamember' }).click()
  const profile = page.getByRole('dialog', { name: 'Профиль участника' }); await expect(profile).toBeVisible(); await profile.getByRole('button', { name: 'Закрыть', exact: true }).click()
  await page.getByRole('button', { name: 'Личная панель' }).click(); await page.getByRole('button', { name: 'Личные сообщения', exact: true }).click(); const direct = page.locator('.personal-content'); await page.getByRole('button', { name: 'Новый диалог' }).click(); await direct.getByRole('radio', { name: 'qamember', exact: true }).check(); await direct.getByRole('button', { name: 'Открыть диалог' }).click(); await direct.getByLabel('Сообщение в беседу').fill('Привет из личной беседы'); await direct.getByRole('button', { name: 'Отправить', exact: true }).click(); await expect(direct.getByText('Привет из личной беседы', { exact: true }).last()).toBeVisible()
  const mixedCaption = `Картинка и документ одним сообщением ${Date.now()}`
  await expect(direct.locator('input[type=file]')).toBeEnabled()
  await direct.locator('input[type=file]').setInputFiles([{ name: 'document.txt', mimeType: 'text/plain', buffer: Buffer.from('private file') }, { name: 'picture.png', mimeType: 'image/png', buffer: png }]); await expect(direct.locator('.attachment-draft')).toHaveCount(2); await direct.getByLabel('Сообщение в беседу').fill(mixedCaption); await direct.getByRole('button', { name: 'Отправить', exact: true }).click(); await expect(direct.locator('article').filter({ hasText: mixedCaption }).locator('.attachment-card')).toHaveCount(2); await expect(direct.getByRole('button', { name: 'Загрузить файл · document.txt' }).last()).toBeVisible(); await direct.getByRole('button', { name: 'Загрузить файл · document.txt' }).last().click(); await expect(direct.locator('article').filter({ hasText: mixedCaption }).locator('.attachment-card').filter({ hasText: 'document.txt' }).getByRole('link', { name: 'Скачать' })).toBeVisible(); await page.screenshot({ path: testInfo.outputPath('direct-messages-and-file.png'), fullPage: true })
  const otherContext = await browser.newContext(); const other = await otherContext.newPage(); const member = await session(other, 'qamember'); await other.getByRole('button', { name: 'Личная панель' }).click(); await other.getByRole('button', { name: 'Входящие', exact: true }).click(); await expect(other.locator('.personal-content').getByText(threadText)).toBeVisible(); await other.locator('.personal-content').getByText(threadText).click(); await expect(other.getByRole('complementary', { name: 'Комментарии к публикации' })).toBeVisible()
  const block = await other.request.put('/api/v1/me/blocks/1', { headers: { Authorization: `Bearer ${member.session.token}` } }); expect(block.ok()).toBeTruthy()
  await direct.getByLabel('Сообщение в беседу').fill('blocked send'); await direct.getByRole('button', { name: 'Отправить', exact: true }).click(); await expect(direct.getByRole('alert')).toBeVisible(); expect(await direct.getByLabel('Сообщение в беседу').inputValue()).toBe('blocked send')
  await other.request.delete('/api/v1/me/blocks/1', { headers: { Authorization: `Bearer ${member.session.token}` } }); await otherContext.close()
  expect(owner.session.token).toBeTruthy(); expect(errors).toEqual([])
})
