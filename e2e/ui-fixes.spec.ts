import { expect, test, type Page } from '@playwright/test'

async function openCallWorkspace(page: Page, options: { withPeers?: boolean } = {}) {
  await page.addInitScript(() => {
    localStorage.setItem('voxhold.theme.v1', 'dark')
    localStorage.setItem('voxhold.session.v1', JSON.stringify({ user: { id: 1, username: 'Александр', created_at: 1 }, session: { token: 'fixture', expires_at: Math.floor(Date.now() / 1000) + 86400 } }))
    localStorage.setItem('voxhold.workspace-layout.v1', JSON.stringify({ channel_width: 252, members_width: 270, members_open: true }))
    navigator.mediaDevices.getUserMedia = async () => {
      const audio = new AudioContext()
      const output = audio.createMediaStreamDestination()
      const oscillator = audio.createOscillator()
      oscillator.connect(output); oscillator.start()
      return output.stream
    }
  })
  const participant = { connection_id: 'fixture-voice', user_id: 1, server_id: 1, channel_id: 1, self_mute: false, self_deaf: false }
  const participants = options.withPeers ? [participant, { ...participant, connection_id: 'fixture-maria', user_id: 2 }, { ...participant, connection_id: 'fixture-other', user_id: 3 }] : [participant]
  await page.routeWebSocket('**/api/v1/ws', (socket) => {
    socket.onMessage((raw) => {
      const event = JSON.parse(String(raw))
      if (event.type === 'auth') {
        socket.send(JSON.stringify({ type: 'ready', data: { user_id: 1, protocol_version: 6 } }))
        socket.send(JSON.stringify({ type: 'presence.snapshot', data: { servers: [{ server_id: 1, online_user_ids: participants.map((item) => item.user_id) }] } }))
        socket.send(JSON.stringify({ type: 'voice.snapshot', data: { participants } }))
      }
      if (event.type === 'voice.join') socket.send(JSON.stringify({ request_id: event.request_id, type: 'voice.joined', data: { participant, participants } }))
      if (event.type === 'channel.subscribe') socket.send(JSON.stringify({ request_id: event.request_id, type: 'channel.subscribed', data: event.data }))
    })
  })
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    let json: unknown = {}
    if (path.endsWith('/me/servers')) json = [{ id: 1, name: 'FirstInstance', role: 'owner', created_by: 1, created_at: 1, joined_at: 1 }]
    else if (path.endsWith('/instance')) json = { instance_id: 'fixture', name: 'FirstInstance', initialized: true, registration: 'invite_only', protocol_version: 1, created_at: 1 }
    else if (path.endsWith('/me/profile')) json = { user_id: 1, username: 'Александр', about: '', country_code: null, created_at: 1 }
    else if (path.endsWith('/channels')) json = [{ id: 1, server_id: 1, name: 'первый-голосовой', kind: 'voice', position: 0, created_by: 1, created_at: 1 }]
    else if (path.endsWith('/members')) json = ['Александр', 'Мария', 'ОченьДлинноеИмяУчастника'].map((username, index) => ({ user_id: index + 1, username, role: index ? 'member' : 'owner', created_at: 1, joined_at: 1, about: '', country_code: null, last_seen_at: null }))
    else if (path.endsWith('/recordings')) json = { recordings: [] }
    else if (path.endsWith('/pins')) json = []
    else if (path.endsWith('/messages/sync')) json = { messages: [], deleted_ids: [], cursor: 0, reset: true, has_more: false, has_older: false }
    else if (path.endsWith('/messages')) json = { messages: [], pagination: { has_more: false, next_before_id: null } }
    else if (path.endsWith('/invite-links')) json = { token: 'fixture-invite', expires_at: 9999999999, max_uses: 25, allow_registration: true }
    else if (path.endsWith('/webrtc/config')) json = { ice_servers: [], ice_transport_policy: 'all' }
    await route.fulfill({ json })
  })
  await page.goto('/')
  await expect(page.locator('.voice-participant')).toHaveCount(participants.length)
}

test('participant volume updates in an open menu and the same menu opens on room cards', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setViewportSize({ width: 1600, height: 1000 })
  await openCallWorkspace(page, { withPeers: true })
  const menu = page.getByRole('menu')
  const slider = menu.getByRole('slider', { name: 'Громкость пользователя' })
  const sidebarMaria = page.locator('.channel-voice-users button').filter({ hasText: 'Мария' })
  const mariaCard = page.locator('.voice-participant').filter({ hasText: 'Мария' })

  await sidebarMaria.click({ button: 'right' })
  await expect(slider).toHaveValue('100')
  await slider.press('Home')
  await expect(slider).toHaveValue('0')
  await expect(menu.locator('.context-menu__volume em')).toHaveText('0%')
  await slider.press('End')
  await expect(slider).toHaveValue('200')
  await expect(menu.locator('.context-menu__volume em')).toHaveText('200%')
  await slider.press('ArrowLeft')
  await expect(slider).toHaveValue('195')
  await expect(menu.locator('.context-menu__volume em')).toHaveText('195%')
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('voxhold.voice.userVolumes.v1') ?? '{}')['2'])).toBe(195)

  await page.keyboard.press('Escape')
  await mariaCard.click({ button: 'right' })
  await expect(menu.locator('.context-menu__title')).toHaveText('Мария')
  await expect(slider).toHaveValue('195')
  await expect(menu.getByRole('menuitem', { name: 'Просмотреть профиль' })).toBeVisible()
  await expect(menu.getByRole('button', { name: 'Админ', exact: true })).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: 'Удалить с сервера' })).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await slider.press('ArrowLeft')
  await expect(slider).toHaveValue('190')
  await expect(menu.locator('.context-menu__volume em')).toHaveText('190%')

  await page.locator('.voice-participant').filter({ hasText: 'ОченьДлинноеИмяУчастника' }).click({ button: 'right' })
  await expect(slider).toHaveValue('100')
  await expect(menu.locator('.context-menu__volume em')).toHaveText('100%')
  await mariaCard.click({ button: 'right' })
  await expect(slider).toHaveValue('190')
  await page.locator('.voice-participant').filter({ hasText: 'Александр' }).click({ button: 'right' })
  await expect(menu.getByRole('button', { name: 'Админ', exact: true })).toHaveCount(0)
  await expect(menu.getByRole('menuitem', { name: 'Удалить с сервера' })).toHaveCount(0)
  expect(errors).toEqual([])
})

test('call tiles, registration links and docked pins work in the real workspace', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 })
  await openCallWorkspace(page)
  const tile = (await page.locator('.voice-participant').boundingBox())!
  expect(Math.abs(tile.width - tile.height)).toBeLessThan(2)
  expect(tile.width).toBeLessThanOrEqual(300)
  expect((await page.locator('.voice-participant .avatar').boundingBox())!.width).toBeGreaterThanOrEqual(80)
  await expect(page.locator('.content-header').getByRole('button', { name: 'Чат канала' })).toHaveCount(0)
  await expect(page.locator('.content-header').getByRole('button', { name: 'Приглашения', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Пригласить', exact: true }).click()
  await expect(page.getByRole('button', { name: 'По имени' })).toHaveCount(0)
  const linkRequest = page.waitForRequest((request) => request.url().endsWith('/invite-links') && request.method() === 'POST')
  await page.getByRole('button', { name: 'Создать ссылку' }).click()
  expect((await linkRequest).postDataJSON().allow_registration).toBe(true)
  await page.getByRole('button', { name: 'Закрыть', exact: true }).click()
  await page.getByRole('button', { name: 'Подключиться к каналу', exact: true }).click()
  await page.locator('.call-controls').getByRole('button', { name: 'Чат канала' }).click()
  await page.locator('.voice-channel-chat').getByRole('button', { name: 'Закрепы', exact: true }).click()
  await expect(page.locator('.voice-channel-chat .message-panel--docked')).toBeVisible()
  await expect(page.locator('.message-panel-scrim')).toHaveCount(0)
  const inside = await page.locator('.message-panel--docked').evaluate((node) => {
    const bounds = node.getBoundingClientRect(), parent = node.closest('.voice-channel-chat')!.getBoundingClientRect()
    return bounds.left >= parent.left && bounds.right <= parent.right + 1 && bounds.bottom <= parent.bottom + 1
  })
  expect(inside).toBe(true)
  await page.screenshot({ path: 'node_modules/.cache/call-layout-desktop.png', animations: 'disabled' })
  await page.locator('.voice-channel-chat').getByRole('button', { name: 'Чат', exact: true }).click()
  await expect(page.locator('.voice-channel-chat .composer')).toBeVisible()
  await page.setViewportSize({ width: 375, height: 812 })
  await page.locator('.voice-channel-chat').getByRole('button', { name: 'Закрепы', exact: true }).click()
  await expect(page.locator('.message-panel--docked')).toBeVisible()
  expect(await page.locator('body').evaluate((node) => node.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: 'node_modules/.cache/call-layout-mobile.png', animations: 'disabled' })
})

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
