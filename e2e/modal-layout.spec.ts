import { expect, test } from '@playwright/test'

for (const theme of ['dark', 'light']) for (const width of [1280, 390, 320]) {
  test(`dialogs keep aligned content and usable fields at ${width}px in ${theme}`, async ({ page }, info) => {
    const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message))
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/e2e/fixtures/modal-layout.html')
    await page.evaluate((value) => { document.documentElement.dataset.theme = value; document.documentElement.style.colorScheme = value }, theme)
    for (const name of ['Приглашения', 'Отложенное сообщение', 'Опрос', 'Камера', 'Трансляция', 'Подтверждение', 'Голос', 'Записи']) {
      await page.getByRole('button', { name, exact: true }).click()
      const dialog = page.getByRole('dialog')
      await expect(dialog).toBeVisible()
      const layout = await dialog.evaluate((node) => {
        const outer = node.getBoundingClientRect(), body = node.querySelector('.modal-body')!.getBoundingClientRect()
        const heading = node.querySelector('.modal-head')!.getBoundingClientRect()
        return { overflow: node.scrollWidth > node.clientWidth, left: body.left - outer.left, right: outer.right - body.right, titleAligned: Math.abs(body.left - heading.left), fields: [...node.querySelectorAll<HTMLElement>('input:not([type="range"]):not([type="checkbox"]):not([type="radio"]), textarea, select')].filter((field) => field.getBoundingClientRect().width > 0).map((field) => { const rect = field.getBoundingClientRect(); return { left: rect.left - body.left, right: body.right - rect.right, width: rect.width, height: rect.height } }) }
      })
      expect(layout.overflow, name).toBe(false)
      expect(Math.abs(layout.left - layout.right), name).toBeLessThanOrEqual(1)
      for (const field of layout.fields) {
        expect(field.left, name).toBeGreaterThanOrEqual(16)
        expect(field.right, name).toBeGreaterThanOrEqual(16)
        expect(field.width, name).toBeGreaterThan(60)
      }
      if (name === 'Приглашения') {
        if (width === 1280) expect(layout.fields[0]!.height).toBeCloseTo(layout.fields[1]!.height, 0)
        await dialog.screenshot({ path: info.outputPath(`invite-create-${theme}-${width}.png`), animations: 'disabled' })
        await dialog.getByRole('button', { name: 'Активные ссылки', exact: true }).click()
        await expect(dialog.getByRole('article', { name: 'Ссылка №15' })).toBeVisible()
        const note = await dialog.locator('.invite-links__note').boundingBox(), card = await dialog.boundingBox()
        expect(note!.x - card!.x).toBeGreaterThanOrEqual(18)
        expect(card!.x + card!.width - note!.x - note!.width).toBeGreaterThanOrEqual(18)
      }
      if (width === 1280 || width === 390) await dialog.screenshot({ path: info.outputPath(`${name}-${theme}-${width}.png`), animations: 'disabled' })
      await dialog.getByRole('button', { name: 'Закрыть', exact: true }).first().click()
      await expect(dialog).toHaveCount(0)
    }
    expect(errors).toEqual([])
  })
}
