import { expect, test } from '@playwright/test'

test('permanent navigation owns space in channels and personal pages at desktop widths', async ({ page }, info) => {
  await page.addInitScript(() => localStorage.setItem('voxhold.workspace-layout.v1', JSON.stringify({ channel_width: 480, members_width: 420, members_open: true })))
  await page.goto('/e2e/fixtures/personal-space.html')
  const navigation = page.getByRole('navigation', { name: 'Личное пространство', exact: true })
  for (const width of [1440, 1181, 1000, 761]) {
    await page.setViewportSize({ width, height: 900 })
    const rail = await navigation.boundingBox(), sidebar = await page.locator('.channel-sidebar').boundingBox(), content = await page.locator('.content-shell').boundingBox()
    expect(rail!.x).toBe(0)
    expect(sidebar!.x).toBe(rail!.width)
    expect(content!.x).toBeCloseTo(sidebar!.x + sidebar!.width, 0)
    expect(content!.width).toBeGreaterThanOrEqual(389)
    expect(content!.x + content!.width).toBeLessThanOrEqual(width)
    expect(await page.locator('.workspace').evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true)
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  await navigation.getByRole('button', { name: 'Диалог: Лера', exact: true }).click()
  await expect(page.getByLabel('Сообщение в беседу')).toBeVisible()
  const before = await page.locator('.personal-content').boundingBox()
  await page.mouse.move(0, 300); await page.mouse.move(800, 300)
  expect(await page.locator('.personal-content').boundingBox()).toEqual(before)
  await page.screenshot({ path: info.outputPath('permanent-navigation-desktop.png'), animations: 'disabled' })
})

test('resizing preserves chat space, supports keyboard reset and persists the result', async ({ page }) => {
  await page.goto('/e2e/fixtures/personal-space.html')
  const handle = page.getByRole('separator', { name: 'Ширина каналов' })
  const start = await handle.boundingBox()
  await page.mouse.move(start!.x + start!.width / 2, 300)
  await page.mouse.down(); await page.mouse.move(1100, 300, { steps: 12 }); await page.mouse.up()
  expect((await page.locator('.content-shell').boundingBox())!.width).toBeGreaterThanOrEqual(389)
  await handle.focus(); await page.keyboard.press('Home')
  await expect.poll(async () => (await page.locator('.channel-sidebar').boundingBox())!.width).toBe(252)
  await page.keyboard.press('ArrowRight')
  await expect.poll(async () => (await page.locator('.channel-sidebar').boundingBox())!.width).toBe(268)
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('voxhold.workspace-layout.v1') ?? '{}').channel_width)).toBe(268)
  await page.reload()
  await expect.poll(async () => (await page.locator('.channel-sidebar').boundingBox())!.width).toBe(268)
})

test('mobile navigation and open conversation drawers reserve space without covering the composer', async ({ page }, info) => {
  for (const width of [320, 390, 760]) {
    await page.setViewportSize({ width, height: 844 })
    await page.goto('/e2e/fixtures/personal-space.html')
    const navigation = page.getByRole('navigation', { name: 'Личное пространство', exact: true })
    await navigation.getByRole('button', { name: 'Сообщения', exact: true }).click()
    await page.getByRole('button', { name: 'Список разговоров' }).click()
    const rail = await navigation.boundingBox(), sidebar = await page.locator('.channel-sidebar').boundingBox()
    expect(sidebar!.y + sidebar!.height).toBeLessThanOrEqual(rail!.y + 1)
    await page.locator('.personal-conversation').filter({ hasText: 'Лера' }).click()
    const composer = page.getByLabel('Сообщение в беседу')
    await expect(composer).toBeVisible()
    const input = await composer.boundingBox()
    expect(input!.y + input!.height).toBeLessThan(rail!.y)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: info.outputPath('permanent-navigation-mobile.png'), animations: 'disabled' })
})

test('profile tabs preserve edits and support keyboard navigation', async ({ page }) => {
  await page.goto('/e2e/fixtures/ui-fixes.html?security=true')
  await page.getByRole('button', { name: 'Профиль', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Ваш профиль' })
  await dialog.getByRole('textbox').first().fill('Несохранённое описание')
  await dialog.getByRole('tab', { name: 'Профиль', exact: true }).focus()
  await page.keyboard.press('ArrowRight')
  await expect(dialog.getByRole('tab', { name: 'Оформление', exact: true })).toBeFocused()
  await expect(dialog.getByRole('button', { name: /Включить .* тему/ })).toBeVisible()
  await page.keyboard.press('End')
  await expect(dialog.getByRole('tab', { name: 'Безопасность', exact: true })).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('Home')
  await expect(dialog.getByRole('textbox').first()).toHaveValue('Несохранённое описание')
  await dialog.getByRole('combobox').click()
  await dialog.getByLabel('Поиск страны').fill('Россия')
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown')
  await expect(dialog.getByRole('option', { name: /Россия/ })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(dialog.getByRole('listbox')).toBeHidden()
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('combobox')).toBeFocused()
})

test('personal call icons expose their state and collapse without ending the call', async ({ page }, info) => {
  await page.route('**/src/services/conversationCall.ts*', (route) => route.fulfill({ contentType: 'application/javascript', body: `
    window.callUI = { created: 0, closed: 0, muted: false };
    export class ConversationCall {
      constructor(api, token, id, userId, callbacks) { this.callbacks = callbacks; window.callUI.created++; }
      async start() { this.callbacks.state({ conversation_id: 7, revision: 1, members: [{ user_id: 1, username: 'Александр' }, { user_id: 2, username: 'Лера' }] }, false); }
      mute(value) { window.callUI.muted = value; }
      async shareScreen() { this.callbacks.screen(true); }
      close() { window.callUI.closed++; }
    }
  ` }))
  await page.goto('/e2e/fixtures/personal-space.html')
  await page.getByRole('button', { name: 'Диалог: Лера', exact: true }).click()
  const toolbar = page.getByRole('toolbar', { name: 'Действия в разговоре' })
  await expect(toolbar.getByRole('button', { name: 'Позвонить / присоединиться', exact: true }).locator('svg')).toBeVisible()
  await toolbar.getByRole('button', { name: 'Позвонить / присоединиться', exact: true }).click()
  const dock = page.getByLabel('Звонок в беседе', { exact: true })
  await expect(dock.getByText('Лера', { exact: true })).toBeVisible()
  await expect(dock.getByRole('group', { name: 'Управление личным звонком' }).locator('button > svg')).toHaveCount(4)
  await dock.getByRole('button', { name: 'Выключить микрофон' }).click()
  await expect(dock.getByRole('button', { name: 'Включить микрофон' })).toHaveAttribute('aria-pressed', 'true')
  await page.screenshot({ path: info.outputPath('personal-call-desktop.png'), animations: 'disabled' })
  await dock.getByRole('button', { name: 'Свернуть звонок' }).click()
  expect(await page.evaluate(() => (window as unknown as { callUI: { closed: number } }).callUI.closed)).toBe(0)
  await expect(dock.getByRole('button', { name: 'Завершить', exact: true })).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  const rail = await page.locator('.personal-rail').boundingBox(), box = await dock.boundingBox()
  expect(box!.y + box!.height).toBeLessThan(rail!.y)
  const composer = await page.getByLabel('Сообщение в беседу').boundingBox()
  expect(composer!.y).toBeGreaterThanOrEqual(box!.y + box!.height)
  await dock.getByRole('button', { name: 'Развернуть звонок' }).click()
  const expanded = await dock.boundingBox(), expandedComposer = await page.getByLabel('Сообщение в беседу').boundingBox()
  expect(expandedComposer!.y).toBeGreaterThanOrEqual(expanded!.y + expanded!.height)
  await page.getByRole('button', { name: 'Список разговоров' }).click()
  expect((await page.locator('.channel-sidebar').boundingBox())!.y).toBeGreaterThanOrEqual(expanded!.y + expanded!.height)
  await page.locator('.personal-conversation').filter({ hasText: 'Лера' }).click()
  await page.screenshot({ path: info.outputPath('personal-call-mobile.png'), animations: 'disabled' })
  await dock.getByRole('button', { name: 'Завершить', exact: true }).click()
  await expect(dock).toBeHidden()
  expect(await page.evaluate(() => (window as unknown as { callUI: { closed: number } }).callUI.closed)).toBe(1)
})

test('security cards, long device names and deletion confirmation fit both themes and small screens', async ({ page }, info) => {
  await page.goto('/e2e/fixtures/ui-fixes.html?security=true')
  await page.getByRole('button', { name: 'Профиль', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Ваш профиль' })
  await dialog.getByRole('tab', { name: 'Безопасность', exact: true }).click()
  await expect(dialog.locator('.session-list > li')).toHaveCount(3)
  for (const theme of ['dark', 'light']) {
    await page.evaluate((theme) => { document.documentElement.dataset.theme = theme }, theme)
    for (const width of [1280, 600, 390, 320]) {
      await page.setViewportSize({ width, height: 900 })
      expect(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true)
      const overflowing = await dialog.locator('.session-list > li, .profile-danger').evaluateAll((nodes) => nodes.filter((node) => node.scrollWidth > node.clientWidth).length)
      expect(overflowing).toBe(0)
      const tab = await dialog.getByRole('tab', { name: 'Безопасность', exact: true }).boundingBox()
      await dialog.getByRole('button', { name: 'Удалить аккаунт', exact: true }).click()
      await dialog.getByLabel('Имя пользователя для удаления аккаунта').fill('Александр')
      expect(await dialog.locator('.danger-confirm').evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true)
      expect((await dialog.getByRole('tab', { name: 'Безопасность', exact: true }).boundingBox())!.y).toBe(tab!.y)
      await dialog.getByRole('button', { name: 'Отменить удаление' }).click()
      if (width === 390 || width === 1280) await dialog.screenshot({ path: info.outputPath(`security-${theme}-${width}.png`), animations: 'disabled' })
    }
  }
})
