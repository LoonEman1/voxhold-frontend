import { expect, test, type Page } from '@playwright/test'

async function openCallWorkspace(page: Page, options: { withPeers?: boolean; role?: 'owner' | 'admin' | 'member'; channelMemberIds?: number[] } = {}) {
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
  let emit = (_type: string, _data: unknown) => {}
  await page.routeWebSocket('**/api/v1/ws', (socket) => {
    emit = (type, data) => socket.send(JSON.stringify({ type, data }))
    socket.onMessage((raw) => {
      const event = JSON.parse(String(raw))
      if (event.type === 'auth') {
        socket.send(JSON.stringify({ type: 'ready', data: { user_id: 1, protocol_version: 6 } }))
        socket.send(JSON.stringify({ type: 'presence.snapshot', data: { servers: [{ server_id: 1, online_user_ids: participants.map((item) => item.user_id) }] } }))
        socket.send(JSON.stringify({ type: 'voice.snapshot', data: { participants } }))
      }
      if (event.type === 'voice.join') socket.send(JSON.stringify({ request_id: event.request_id, type: 'voice.joined', data: { participant, participants } }))
      if (event.type === 'voice.state_update') socket.send(JSON.stringify({ request_id: event.request_id, type: 'voice.state_updated', data: { ...participant, ...event.data } }))
      if (event.type === 'channel.subscribe') socket.send(JSON.stringify({ request_id: event.request_id, type: 'channel.subscribed', data: event.data }))
    })
  })
  const now = Math.floor(Date.now() / 1000)
  let nextInviteId = 105
  let inviteLinks = [
    { id: 101, server_id: 1, created_by: 1, creator_username: 'Александр', created_at: now - 600, expires_at: now + 3600, max_uses: 25 as number | null, use_count: 3, allow_registration: true },
    { id: 102, server_id: 1, created_by: 2, creator_username: 'Другой администратор', created_at: now - 300, expires_at: now + 3600, max_uses: null as number | null, use_count: 1, allow_registration: false },
    { id: 103, server_id: 1, created_by: 1, creator_username: 'Истёкшая', created_at: now - 600, expires_at: now - 1, max_uses: 25 as number | null, use_count: 0, allow_registration: true },
    { id: 104, server_id: 1, created_by: 1, creator_username: 'Исчерпанная', created_at: now - 600, expires_at: now + 3600, max_uses: 25 as number | null, use_count: 25, allow_registration: true },
  ]
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url())
    const path = url.pathname
    let json: unknown = {}
    if (path.endsWith('/me/servers')) json = [{ id: 1, name: 'FirstInstance', role: options.role ?? 'owner', created_by: 1, created_at: 1, joined_at: 1 }]
    else if (path.endsWith('/instance')) json = { instance_id: 'fixture', name: 'FirstInstance', initialized: true, registration: 'invite_only', protocol_version: 1, created_at: 1 }
    else if (path.endsWith('/me/profile')) json = { user_id: 1, username: 'Александр', about: '', country_code: null, created_at: 1 }
    else if (path.endsWith('/channels')) json = [{ id: 1, server_id: 1, name: 'первый-голосовой', kind: 'voice', position: 0, created_by: 1, created_at: 1 }]
    else if (/\/channels\/\d+\/members$/.test(path)) json = { user_ids: options.channelMemberIds ?? [1, 2, 3] }
    else if (path.endsWith('/members')) json = ['Александр', 'Мария', 'ОченьДлинноеИмяУчастника'].map((username, index) => ({ user_id: index + 1, username, role: index ? 'member' : options.role ?? 'owner', created_at: 1, joined_at: 1, about: '', country_code: null, last_seen_at: now - 5 * 60 }))
    else if (path.endsWith('/recordings')) json = { recordings: [], quota_bytes: 8 * 2 ** 30, max_file_bytes: 2 ** 31, retention_seconds: 86400 }
    else if (path.endsWith('/pins')) json = []
    else if (path.endsWith('/messages/sync')) json = { messages: [], deleted_ids: [], cursor: 0, reset: true, has_more: false, has_older: false }
    else if (path.endsWith('/messages')) json = { messages: [], pagination: { has_more: false, next_before_id: null } }
    else if (/\/invite-links(?:\/\d+)?$/.test(path)) {
      if (options.role === 'member') { await route.fulfill({ status: 403, json: { error: 'not allowed to manage invite links' } }); return }
      if (route.request().method() === 'DELETE') {
        const id = Number(path.split('/').at(-1))
        inviteLinks = inviteLinks.filter((link) => link.id !== id)
        await route.fulfill({ status: 204 }); return
      }
      if (route.request().method() === 'POST') {
        const input = route.request().postDataJSON() as { expires_in_seconds: number; max_uses: number | null; allow_registration: boolean }
        const link = { id: nextInviteId++, server_id: 1, created_by: 1, creator_username: 'Александр', created_at: now, expires_at: now + input.expires_in_seconds, max_uses: input.max_uses, use_count: 0, allow_registration: input.allow_registration }
        inviteLinks.push(link)
        json = { ...link, server_name: 'FirstInstance', token: `fixture-invite-${link.id}` }
      } else {
        const before = Number(url.searchParams.get('before_id') ?? Number.MAX_SAFE_INTEGER)
        json = { invite_links: inviteLinks.filter((link) => link.id < before && link.expires_at > now && (link.max_uses === null || link.use_count < link.max_uses)).sort((a, b) => b.id - a.id), pagination: { has_more: false, next_before_id: null } }
      }
    }
    else if (path.endsWith('/webrtc/config')) json = { ice_servers: [], ice_transport_policy: 'all' }
    await route.fulfill({ json })
  })
  await page.goto('/')
  await expect(page.locator('.voice-participant')).toHaveCount(participants.length)
  return { emit }
}

for (const role of ['owner', 'admin'] as const) {
  test(`${role} manages active invitation links from the top invitation menu`, async ({ page }) => {
    await openCallWorkspace(page, { role })
    await page.getByRole('button', { name: 'Пригласить', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Пригласить в FirstInstance' })
    await dialog.getByRole('button', { name: 'Активные ссылки', exact: true }).click()
    const ownerLink = dialog.getByRole('article', { name: 'Ссылка №101', exact: true })
    await expect(ownerLink).toContainText('Александр')
    await expect(ownerLink).toContainText('3 / 25')
    await expect(dialog.getByRole('article', { name: 'Ссылка №102', exact: true })).toContainText('Другой администратор')
    await expect(dialog.getByRole('article')).toHaveCount(2)
    await page.setViewportSize({ width: 375, height: 812 })
    expect(await page.locator('.modal-card').evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true)
    await ownerLink.getByRole('button', { name: 'Закрыть ссылку', exact: true }).click()
    const deletion = page.waitForRequest((request) => request.method() === 'DELETE' && request.url().endsWith('/invite-links/101'))
    await ownerLink.getByRole('button', { name: 'Да, закрыть', exact: true }).click()
    await deletion
    await expect(ownerLink).toHaveCount(0)
    await expect(dialog.getByRole('article')).toHaveCount(1)
    await dialog.getByRole('button', { name: 'Закрыть', exact: true }).click()
    await page.setViewportSize({ width: 1600, height: 1000 })
    await page.getByRole('button', { name: 'Пригласить', exact: true }).click()
    await dialog.getByRole('button', { name: 'Активные ссылки', exact: true }).click()
    await expect(dialog.getByRole('article')).toHaveCount(1)
    await expect(dialog.getByRole('article', { name: 'Ссылка №101', exact: true })).toHaveCount(0)
    await dialog.getByRole('button', { name: 'Новая ссылка', exact: true }).click()
    await dialog.getByRole('button', { name: 'Создать ссылку', exact: true }).click()
    await expect(dialog.getByRole('textbox', { name: 'Ссылка-приглашение', exact: true })).toHaveValue(/fixture-invite-105/)
    await dialog.getByRole('button', { name: 'Активные ссылки', exact: true }).click()
    await expect(dialog.getByRole('article', { name: 'Ссылка №105', exact: true })).toBeVisible()
  })
}

test('ordinary members have no invitation management entry point', async ({ page }) => {
  await openCallWorkspace(page, { role: 'member' })
  await expect(page.getByRole('button', { name: 'Пригласить', exact: true })).toHaveCount(0)
})

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
  await expect(menu.getByRole('menuitem', { name: 'Забанить на инстансе' })).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await slider.press('ArrowLeft')
  await expect(slider).toHaveValue('190')
  await expect(menu.locator('.context-menu__volume em')).toHaveText('190%')

  await page.locator('.voice-participant').filter({ hasText: 'ОченьДлинноеИмяУчастника' }).click({ button: 'right' })
  await expect(slider).toHaveValue('100')
  await expect(menu.locator('.context-menu__volume em')).toHaveText('100%')
  // Native focus can try to reveal overflowed content after the next menu opens.
  // The viewport shell must stay fixed; individual panes still own their scroll.
  await page.locator('.workspace').evaluate((element) => element.scrollTo(148, 0))
  await expect.poll(() => page.locator('.workspace').evaluate((element) => element.scrollLeft)).toBe(0)
  await expect(slider).toHaveValue('100')
  await mariaCard.click({ button: 'right' })
  await expect(slider).toHaveValue('190')
  await page.locator('.voice-participant').filter({ hasText: 'Александр' }).click({ button: 'right' })
  await expect(menu.getByRole('button', { name: 'Админ', exact: true })).toHaveCount(0)
  await expect(menu.getByRole('menuitem', { name: 'Забанить на инстансе' })).toHaveCount(0)
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
    await page.locator('.call-controls').screenshot({path:`node_modules/.cache/audit-ui/controls-${theme}.png`})
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

test('member tabs follow server access, retain all users and show live last-seen with clear presence', async ({ page }) => {
  const { emit } = await openCallWorkspace(page, { channelMemberIds: [1, 3] })
  const sidebar = page.locator('.members-sidebar')
  await expect(sidebar.locator('.member-row')).toHaveCount(2)
  await expect(sidebar.locator('.role-dot')).toHaveCount(0)
  await expect(sidebar.locator('.member-row').filter({ hasText: 'ОченьДлинноеИмяУчастника' })).toContainText('Был в сети 5 минут назад')
  await expect(sidebar.locator('time')).toHaveAttribute('title', /Последний раз в сети:/)
  await sidebar.getByRole('tab', { name: 'Все участники' }).click()
  await expect(sidebar.locator('.member-row')).toHaveCount(3)
  emit('presence.updated', { server_id: 1, user_id: 2, status: 'online', last_seen_at: Math.floor(Date.now() / 1000) })
  await expect(sidebar.locator('.member-row').filter({ hasText: 'Мария' })).toContainText('Сейчас в сети')
  emit('presence.updated', { server_id: 1, user_id: 2, status: 'offline', last_seen_at: Math.floor(Date.now() / 1000) })
  await expect(sidebar.locator('.member-row').filter({ hasText: 'Мария' })).toContainText('Был в сети только что')
  await sidebar.getByRole('tab', { name: 'Участники канала' }).click()
  await expect(sidebar.locator('.member-row')).toHaveCount(2)
  await sidebar.screenshot({ path: 'node_modules/.cache/members-sidebar-dark.png' })
  await page.evaluate(() => document.documentElement.dataset.theme = 'light')
  await sidebar.screenshot({ path: 'node_modules/.cache/members-sidebar-light.png' })
  await page.setViewportSize({ width: 375, height: 812 })
  await page.getByTitle('Показать участников', { exact: true }).click()
  await expect(sidebar).toBeVisible()
  await expect(sidebar.locator('.member-row')).toHaveCount(2)
  expect(await sidebar.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true)
  await sidebar.screenshot({ path: 'node_modules/.cache/members-sidebar-mobile.png' })
})

test('channel access settings stay usable in dark, light and mobile layouts', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto('/e2e/fixtures/channel-access.html')
  await page.getByRole('button', { name: 'Настроить доступ' }).click()
  await expect(page.getByText('Канал будет доступен 2 из 4')).toBeVisible()
  await page.screenshot({ path: 'node_modules/.cache/channel-access-dark.png', animations: 'disabled' })
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; document.documentElement.style.colorScheme = 'light' })
  await page.screenshot({ path: 'node_modules/.cache/channel-access-light.png', animations: 'disabled' })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: 'Сохранить доступ' }).scrollIntoViewIfNeeded()
  await expect(page.getByRole('button', { name: 'Сохранить доступ' })).toBeInViewport()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy()
  await page.screenshot({ path: 'node_modules/.cache/channel-access-mobile.png', animations: 'disabled' })
})

test('a stream starts in the call grid, focuses on click, and hides interface in fullscreen', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto('/e2e/fixtures/channel-access.html')
  const tile = page.locator('.call-stream-tile')
  await expect(tile.locator('video')).toBeVisible()
  await tile.getByRole('button', { name: 'Выключить звук трансляции' }).click()
  await expect(tile.getByRole('button', { name: 'Включить звук трансляции' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.voice-participant')).toHaveCount(3)
  const box = await tile.boundingBox(); expect(Math.abs(box!.width - box!.height)).toBeLessThan(3)
  await page.screenshot({ path: 'node_modules/.cache/call-stream-grid.png', animations: 'disabled' })
  await tile.getByRole('button', { name: 'Развернуть: Вы показываете экран' }).click()
  const player = page.getByRole('dialog')
  await expect(player.locator('video')).toBeVisible()
  await player.getByRole('button', { name: 'Включить звук трансляции' }).click()
  await expect(player.getByRole('button', { name: 'Выключить звук трансляции' })).toHaveAttribute('aria-pressed', 'false')
  await expect(page.locator('.stream-focused-participants')).toBeVisible()
  await page.screenshot({ path: 'node_modules/.cache/call-stream-focus.png', animations: 'disabled' })
  await player.getByRole('button', { name: 'Полный экран', exact: true }).click()
  await expect(player).toHaveClass(/is-ui-hidden/)
  await expect(player).toHaveClass(/is-idle/, { timeout: 6000 })
  await expect(page.locator('.stream-focused-participants')).toBeHidden()
  await page.mouse.move(400,300)
  await expect(player).not.toHaveClass(/is-idle/)
  await player.getByRole('button', { name: 'Выйти из полного экрана' }).click()
  await expect(player).not.toHaveClass(/is-ui-hidden/)
  await player.getByRole('button', { name: 'Полный экран', exact: true }).click()
  await page.mouse.move(400, 300)
  await expect(player).toHaveClass(/is-idle/, { timeout: 6000 })
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await expect(player).toHaveCount(0)
  await expect(tile.locator('video')).toBeVisible()
})

test('revoking an active channel stops local voice and removes the channel without an automatic rejoin', async ({ page }) => {
  const { emit } = await openCallWorkspace(page, { role: 'member' })
  await page.getByRole('button', { name: 'Подключиться к каналу', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Отключиться', exact: true })).toBeVisible()
  emit('voice.webrtc_closed', { reason: 'channel access was revoked' })
  await expect(page.getByRole('button', { name: 'Подключиться к каналу', exact: true })).toBeVisible()
  await page.route('**/api/v1/servers/1/channels', async (route) => route.fulfill({ json: [] }))
  emit('channels.changed', { server_id: 1 })
  await expect(page.locator('.channel-row')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Подключиться к каналу', exact: true })).toHaveCount(0)
})

async function openTextNotifications(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('voxhold.theme.v1', 'dark')
    localStorage.setItem('voxhold.session.v1', JSON.stringify({ user: { id: 2, username: 'Nikita', created_at: 1 }, session: { token: 'notifications-fixture', expires_at: Math.floor(Date.now() / 1000) + 86400 } }))
    const original = window.AudioContext
    Object.assign(window, { notificationTones: 0, desktopAlerts: [] })
    window.AudioContext = class extends original { createOscillator() { (window as unknown as { notificationTones: number }).notificationTones++; return super.createOscillator() } }
    class DesktopNotification { static permission = 'default'; static async requestPermission() { this.permission = 'granted'; return 'granted' }; onclick = null; constructor(title: string, options: unknown) { (window as unknown as { desktopAlerts: unknown[] }).desktopAlerts.push({ title, options }) }; close() {} }
    Object.defineProperty(window, 'Notification', { configurable: true, value: DesktopNotification })
  })
  let emit = (_type: string, _data: unknown) => {}
  const modes = new Map<number, string>()
  const saves: string[] = [], sent: string[] = []
  const now = Math.floor(Date.now() / 1000)
  const makeMessage = (id: number, content: string, author = 1) => ({ id, channel_id: 2, author: { user_id: author, username: author === 1 ? 'Александр' : 'Nikita' }, content, created_at: now - 60 + id, edited_at: null, revision: 1 })
  const remoteMessages: Record<number, ReturnType<typeof makeMessage>[]> = { 3: [] }
  const messages = [makeMessage(1, 'Nikita, проверь пожалуйста макет — @Nikita'), makeMessage(2, 'Коллеги <@&member>, встречаемся через пять минут'), makeMessage(3, 'Обычное сообщение для команды'), makeMessage(4, 'Обновление для <@&admin>')]
  await page.routeWebSocket('**/api/v1/ws', (socket) => {
    emit = (type, data) => socket.send(JSON.stringify({ type, data }))
    socket.onMessage((raw) => {
      const event = JSON.parse(String(raw))
      if (event.type === 'auth') socket.send(JSON.stringify({ type: 'ready', data: { user_id: 2, protocol_version: 6 } }))
      if (event.type === 'channel.subscribe') socket.send(JSON.stringify({ type: 'channel.subscribed', data: event.data, request_id: event.request_id }))
      if (event.type === 'channel.unsubscribe') socket.send(JSON.stringify({ type: 'channel.unsubscribed', data: event.data, request_id: event.request_id }))
    })
  })
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url()), path = url.pathname
    let json: unknown = {}
    if (path.endsWith('/instance')) json = { instance_id: 'notifications-fixture', name: 'Voxhold', initialized: true, registration: 'invite_only', protocol_version: 6, created_at: 1 }
    else if (path.endsWith('/me/profile')) json = { user_id: 2, username: 'Nikita', about: '', country_code: '', created_at: 1 }
    else if (path.endsWith('/servers')) json = [{ id: 1, name: 'Дизайн-команда', role: 'member', created_by: 1, created_at: 1, joined_at: 1 }]
    else if (path.endsWith('/channels')) json = [{ id: 2, server_id: 1, name: 'общий', kind: 'text', position: 0, created_by: 1, created_at: 1, last_message_id: 4 }, { id: 3, server_id: 1, name: 'проекты', kind: 'text', position: 1, created_by: 1, created_at: 1 }, { id: 1, server_id: 1, name: 'звонок', kind: 'voice', position: 2, created_by: 1, created_at: 1 }]
    else if (path.endsWith('/notifications')) {
      const channelId = Number(path.split('/')[6])
      if (route.request().method() === 'PUT') { const mode = route.request().postDataJSON().mode; modes.set(channelId, mode); saves.push(mode); emit('notification.settings_updated', { server_id: 1, channel_id: channelId, mode }) }
      json = { server_id: 1, channel_id: channelId, mode: modes.get(channelId) ?? 'mentions' }
    }
    else if (/\/channels\/\d+\/members$/.test(path)) json = { user_ids: [1, 2, 3] }
    else if (path.endsWith('/members')) json = [{ user_id: 1, username: 'Александр', role: 'owner' }, { user_id: 2, username: 'Nikita', role: 'member' }, { user_id: 3, username: 'Мария', role: 'admin' }]
    else if (path.endsWith('/context')) { const id = Number(path.split('/')[8]); json = { messages: [{ ...makeMessage(id, 'Привет <@2>'), channel_id: Number(path.split('/')[6]) }], target_message_id: id, target_index: 0 } }
    else if (path.endsWith('/messages/sync')) json = { messages: path.includes('/channels/2/') ? messages : remoteMessages[Number(path.split('/')[6])] ?? [], cursor: 4, deleted_ids: [], reset: true, has_more: false, has_older: false }
    else if (path.endsWith('/messages') && route.request().method() === 'POST') { const content = route.request().postDataJSON().content; sent.push(content); json = makeMessage(100 + sent.length, content, 2) }
    else if (path.endsWith('/pins')) json = []
    else if (path.endsWith('/recordings')) json = { recordings: [] }
    await route.fulfill({ json })
  })
  await page.goto('/')
  await expect(page.locator('[data-message-id="1"]')).toBeVisible()
  return { emit, saves, sent, notification: (id: number, channelId = 3) => { const message = { ...makeMessage(id, 'Привет <@2>, посмотри новый вариант'), channel_id: channelId }; if (channelId !== 2 && !(remoteMessages[channelId] ?? []).some((item) => item.id === id)) (remoteMessages[channelId] ??= []).push(message); return ({ server_id: 1, channel_id: channelId, server_name: 'Дизайн-команда', channel_name: channelId === 3 ? 'проекты' : 'общий', mentioned: true, message: { id, author: { user_id: 1, username: 'Александр' }, content: 'Привет <@2>, посмотри новый вариант', created_at: now } }) } }
}

test('text channel notification preferences are available to members and absent from voice channels', async ({ page }) => {
  const fixture = await openTextNotifications(page)
  await page.getByRole('button', { name: /^общий(?:,|$)/ }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Уведомления' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('radio', { name: /Только упоминания/ })).toBeChecked()
  await page.screenshot({ path: 'node_modules/.cache/channel-notifications-dark.png', animations: 'disabled' })
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; document.documentElement.style.colorScheme = 'light' })
  await page.screenshot({ path: 'node_modules/.cache/channel-notifications-light.png', animations: 'disabled' })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: 'node_modules/.cache/channel-notifications-mobile.png', animations: 'disabled' })
  await dialog.getByRole('button', { name: 'Разрешить', exact: true }).click()
  await expect(dialog.getByText('Разрешены в этом браузере.', { exact: false })).toBeVisible()
  await dialog.getByRole('radio', { name: /Все сообщения/ }).check()
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await expect(dialog).toHaveCount(0); expect(fixture.saves).toEqual(['all'])
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.getByRole('button', { name: 'звонок', exact: true }).click({ button: 'right' })
  await expect(page.getByRole('menuitem', { name: 'Уведомления' })).toHaveCount(0)
})

test('personal and role mentions are highlighted and the composer sends stable IDs with readable text', async ({ page }) => {
  const fixture = await openTextNotifications(page)
  await expect(page.locator('[data-message-id="1"]')).toHaveClass(/message--mentioned/)
  await expect(page.locator('[data-message-id="2"]')).toHaveClass(/message--mentioned/)
  await expect(page.locator('[data-message-id="3"]')).not.toHaveClass(/message--mentioned/)
  await expect(page.locator('[data-message-id="4"]')).not.toHaveClass(/message--mentioned/)
  const input = page.getByRole('textbox', { name: 'Сообщение в общий' })
  await input.fill('@Nik')
  await expect(page.getByRole('option', { name: /Nikita/ })).toBeVisible()
  await page.screenshot({ path: 'node_modules/.cache/message-mentions.png', animations: 'disabled' })
  await input.press('Enter'); await expect(input).toHaveValue('@Nikita ')
  await input.press('End'); await input.press('Enter')
  await expect.poll(() => fixture.sent).toEqual(['<@2>'])
})

test('inactive-channel notifications deduplicate and jump to the selected message', async ({ page }) => {
  const fixture = await openTextNotifications(page)
  fixture.emit('notification.message', fixture.notification(500))
  await expect(page.locator('.message-notification')).toHaveCount(1)
  fixture.emit('notification.message', fixture.notification(500))
  await expect(page.locator('.message-notification')).toHaveCount(1)
  expect(await page.evaluate(() => (window as unknown as { notificationTones: number }).notificationTones)).toBe(2)
  await page.screenshot({ path: 'node_modules/.cache/message-notification.png', animations: 'disabled' })
  await page.locator('.message-notification__open').click()
  await expect(page.locator('.content-header h1')).toHaveText('проекты')
  await expect(page.locator('[data-message-id="500"]')).toBeVisible()
  await expect(page.locator('.message-notification')).toHaveCount(0)
})

test('two tabs deliver one alert and suppress alerts while a channel is actively read', async ({ page, context }) => {
  const first = await openTextNotifications(page)
  const secondPage = await context.newPage(), second = await openTextNotifications(secondPage)
  first.emit('notification.message', first.notification(500))
  second.emit('notification.message', second.notification(500))
  await expect.poll(async () => await page.locator('.message-notification').count() + await secondPage.locator('.message-notification').count()).toBe(1)
  const tones = await page.evaluate(() => (window as unknown as { notificationTones: number }).notificationTones) + await secondPage.evaluate(() => (window as unknown as { notificationTones: number }).notificationTones)
  expect(tones).toBe(2)
  first.emit('notification.message', first.notification(501, 2))
  second.emit('notification.message', second.notification(501, 2))
  await expect.poll(async () => await page.locator('.message-notification').count() + await secondPage.locator('.message-notification').count()).toBe(1)
  await expect.poll(() => secondPage.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith('voxhold.notifications.seen:')).some((key) => JSON.parse(localStorage.getItem(key) ?? '[]').includes(501)))).toBe(true)
  expect(await page.locator('.message-notification').count() + await secondPage.locator('.message-notification').count()).toBe(1)
  await secondPage.close()
})

test('background desktop notifications require explicit permission and use readable, silent system text', async ({ page, context }) => {
  const fixture = await openTextNotifications(page)
  expect(await page.evaluate(() => (window as unknown as { desktopAlerts: unknown[] }).desktopAlerts)).toEqual([])
  await page.getByRole('button', { name: /^общий(?:,|$)/ }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Уведомления' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Разрешить', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Закрыть', exact: true }).click()
  await expect.poll(() => page.evaluate(() => Notification.permission)).toBe('granted')
  const foreground = await context.newPage(); await foreground.goto('about:blank'); await foreground.bringToFront()
  // Headless Chromium does not consistently background tabs on every host.
  await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')) })
  fixture.emit('notification.message', fixture.notification(700))
  await expect.poll(() => page.evaluate(() => (window as unknown as { desktopAlerts: unknown[] }).desktopAlerts.length)).toBe(1)
  const alerts = await page.evaluate(() => (window as unknown as { desktopAlerts: { title: string; options: { body: string; silent: boolean } }[] }).desktopAlerts)
  expect(alerts[0].title).toContain('проекты'); expect(alerts[0].options.body).toContain('@вы'); expect(alerts[0].options.silent).toBe(true)
  await foreground.close()
})

test('personal space keeps channel mentions unread and a notification returns to that channel', async ({ page }) => {
  const fixture = await openTextNotifications(page)
  await page.getByRole('button', { name: 'Личная панель' }).click()
  await page.getByRole('button', { name: 'Личные сообщения', exact: true }).click()
  await expect(page.locator('.personal-content')).toBeVisible()
  fixture.emit('notification.message', fixture.notification(810, 2))
  await expect(page.locator('.message-notification')).toHaveCount(1)
  await page.locator('.message-notification__open').click()
  await expect(page.locator('.personal-content')).toHaveCount(0)
  await expect(page.locator('.content-header h1')).toHaveText('общий')
  await expect(page.locator('[data-message-id="810"]')).toBeVisible()
})

test('a covering dialog does not suppress mentions in the selected text channel', async ({ page }) => {
  const fixture = await openTextNotifications(page)
  await page.bringToFront()
  await page.getByRole('textbox', { name: 'Сообщение в общий' }).click()
  fixture.emit('notification.message', fixture.notification(800, 2))
  await expect.poll(() => page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith('voxhold.notifications.seen:')).some((key) => JSON.parse(localStorage.getItem(key) ?? '[]').includes(800)))).toBe(true)
  await expect(page.locator('.message-notification')).toHaveCount(0)
  await page.getByRole('button', { name: /^общий(?:,|$)/ }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Уведомления' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  fixture.emit('notification.message', fixture.notification(801, 2))
  await expect(page.locator('.message-notification')).toHaveCount(1)
  await page.getByRole('dialog').getByRole('button', { name: 'Закрыть', exact: true }).click()
  fixture.emit('notification.message', fixture.notification(802, 2))
  await expect.poll(() => page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith('voxhold.notifications.seen:')).some((key) => JSON.parse(localStorage.getItem(key) ?? '[]').includes(802)))).toBe(true)
  await expect(page.locator('.message-notification')).toHaveCount(1)
})

test('first opening recordings keeps the workspace visible while the dialog chunk loads', async ({ page }) => {
  let release!: () => void
  const held = new Promise<void>((resolve) => { release = resolve })
  await page.route('**/src/components/RecordingsDialog.tsx*', async (route) => { await held; await route.continue() })
  try {
    await openCallWorkspace(page)
    const before = await page.locator('.content-shell').boundingBox()
    await page.getByRole('button', { name: 'Список записей' }).click()
    await expect(page.getByRole('dialog', { name: 'Записи сервера' })).toBeVisible()
    await expect(page.getByRole('status')).toContainText('Загружаем')
    await expect(page.locator('.content-header h1')).toHaveText('первый-голосовой')
    expect(await page.locator('.content-shell').boundingBox()).toEqual(before)
    await page.screenshot({ path: 'node_modules/.cache/recordings-first-load.png', animations: 'disabled' })
    release()
    await expect(page.getByRole('dialog').getByText('Записей пока нет')).toBeVisible()
  } finally { release() }
})

test('channel-access events refresh the member roster without waiting for the catalog or manual refresh', async ({ page }) => {
  const fixture = await openCallWorkspace(page, { channelMemberIds: [1, 2] })
  const panel = page.locator('.members-sidebar__panel')
  await expect(panel.getByText('Мария', { exact: true })).toBeVisible()
  await expect(panel.getByText('ОченьДлинноеИмяУчастника', { exact: true })).toHaveCount(0)
  let release!: () => void
  const held = new Promise<void>((resolve) => { release = resolve })
  await page.route('**/api/v1/servers/1/channels', async (route) => { await held; await route.fulfill({ json: [{ id: 1, server_id: 1, name: 'первый-голосовой', kind: 'voice', position: 0, created_by: 1, created_at: 1 }] }) })
  await page.route('**/api/v1/servers/1/channels/1/members', async (route) => { await route.fulfill({ json: { user_ids: [1, 3] } }) })
  try {
    fixture.emit('channels.changed', { server_id: 1 })
    await expect(panel.getByText('ОченьДлинноеИмяУчастника', { exact: true })).toBeVisible()
    await expect(panel.getByText('Мария', { exact: true })).toHaveCount(0)
  } finally { release() }
})


test('message context menu expands reactions, persists selection and shows who reacted', async ({ page }) => {
  const fixture = await openTextNotifications(page)
  let revision = 1, selected = false, writes = 0, reads = 0
  await page.route('**/messages/3/reactions/**', async (route) => {
    if (route.request().method() === 'GET') { reads++; await route.fulfill({ json: { users: [{ user_id: 2, username: 'Nikita' }, { user_id: 3, username: 'Мария' }], has_more: false, next_user_id: null } }); return }
    writes++; selected = route.request().method() === 'PUT'
    const data = { channel_id: 2, message_id: 3, revision: ++revision, reactions: selected ? [{ emoji: '🔥', count: 2, me: true }] : [] }
    fixture.emit('message.reactions_changed', data)
    await route.fulfill({ json: data })
  })
  const row = page.locator('[data-message-id="3"]')
  await row.click({ button: 'right' })
  const menu = page.getByRole('menu', { name: 'Действия с сообщением' })
  await expect(menu.getByRole('menuitem', { name: 'Ответить', exact: true })).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: 'Изменить', exact: true })).toHaveCount(0)
  await menu.getByRole('button', { name: 'Все реакции', exact: true }).click()
  await expect(menu.getByRole('group', { name: 'Эмодзи', exact: true }).getByRole('menuitemcheckbox')).toHaveCount(102)
  await page.screenshot({ path: 'node_modules/.cache/message-menu-dark.png', animations: 'disabled' })
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; document.documentElement.style.colorScheme = 'light' })
  await page.screenshot({ path: 'node_modules/.cache/message-menu-light.png', animations: 'disabled' })
  await menu.getByRole('textbox', { name: 'Найти эмодзи' }).fill('Огонь')
  await menu.getByRole('textbox', { name: 'Найти эмодзи' }).press('ArrowDown')
  await expect(menu.getByRole('group', { name: 'Эмодзи', exact: true }).getByRole('menuitemcheckbox', { name: 'Огонь', exact: true })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(menu).toHaveCount(0)
  const reaction = row.getByRole('button', { name: 'Огонь: 2, ваша реакция', exact: true })
  await expect(reaction).toHaveAttribute('aria-pressed', 'true')
  expect(reads).toBe(0)
  await reaction.hover()
  const people = page.getByRole('dialog', { name: 'Кто поставил реакцию «Огонь»' })
  await expect(people.getByText('Мария', { exact: true })).toBeVisible()
  await expect(people.getByText('вы', { exact: true })).toBeVisible()
  await page.screenshot({ path: 'node_modules/.cache/message-reaction-people.png', animations: 'disabled' })
  await reaction.click()
  await expect(row.locator('.message-reaction')).toHaveCount(0)
  await expect(people).toHaveCount(0)
  expect(writes).toBe(2)
})

test('reply composer tracks deletions and sends a quoted message', async ({ page }) => {
  const fixture = await openTextNotifications(page)
  let sent: Record<string, unknown> | undefined
  await page.route('**/channels/2/messages', async (route) => {
    sent = route.request().postDataJSON()
    await route.fulfill({ status: 201, json: { id: 120, channel_id: 2, content: sent!.content, author: { user_id: 2, username: 'Nikita' }, created_at: 1800000000, edited_at: null, revision: 1, reply: { message_id: 2, author: { user_id: 1, username: 'Александр' }, content: 'Коллеги <@&member>, встречаемся через пять минут', revision: 1, deleted: false }, reactions: [], reactions_revision: 1 } })
  })
  await page.locator('[data-message-id="3"]').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Ответить', exact: true }).click()
  const input = page.getByRole('textbox', { name: 'Сообщение в общий' })
  await expect(input).toBeFocused()
  await expect(page.locator('.composer-reply')).toContainText('Обычное сообщение')
  fixture.emit('message.deleted', { channel_id: 2, message_id: 3 })
  await expect(page.locator('.composer-reply')).toContainText('Исходное сообщение удалено')
  await input.fill('Ответ сохраняется')
  await expect(page.locator('.composer button[type="submit"]')).toBeDisabled()
  await page.getByRole('button', { name: 'Отменить ответ' }).click()
  await page.locator('[data-message-id="2"]').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Ответить', exact: true }).click()
  await input.press('End'); await input.press('Enter')
  await expect.poll(() => sent?.reply_to_message_id).toBe(2)
  expect(sent?.content).toBe('Ответ сохраняется')
  expect(sent?.client_message_id).toBeTruthy()
  await expect(page.locator('[data-message-id="120"] .message-quote')).toContainText('Александр')
  await expect(page.locator('.composer-reply')).toHaveCount(0)
})

test('forward dialog retries the same request and retains original attribution', async ({ page }) => {
  await openTextNotifications(page)
  const attempts: Record<string, unknown>[] = []
  await page.route('**/me/forward-destinations', async (route) => route.fulfill({ json: [{kind:'channel', id:3, server_id:1, name:'проекты'}] }))
  await page.route('**/me/forward', async (route) => {
    const body = route.request().postDataJSON(); attempts.push(body)
    if (attempts.length === 1) { await route.fulfill({ status: 503, json: { error: 'temporary failure' } }); return }
    await route.fulfill({ status: 201, json: { id: 121, channel_id: 3, content: 'Nikita, проверь пожалуйста макет — @Nikita', author: { user_id: 2, username: 'Nikita' }, forward: { author: { user_id: 1, username: 'Александр' }, created_at: 1800000000 }, created_at: 1800000001, revision: 1, edited_at: null, reactions: [], reactions_revision: 1 } })
  })
  await page.locator('[data-message-id="1"]').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Переслать', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Переслать сообщение', exact: true })
  await dialog.getByRole('button', { name: /проекты/ }).click()
  await page.screenshot({ path: 'node_modules/.cache/message-forward.png', animations: 'disabled' })
  await dialog.getByRole('button', { name: 'Переслать', exact: true }).click()
  await expect(dialog.getByRole('alert')).toBeVisible()
  await dialog.getByRole('button', { name: 'Переслать', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  expect(attempts).toHaveLength(2)
  expect(attempts[0]).toEqual(attempts[1])
  expect(attempts[0]?.source).toEqual({kind:'channel',id:1})
  await page.route('**/channels/3/messages/sync**', async (route) => route.fulfill({ json: { messages: [{ id: 121, channel_id: 3, content: 'Nikita, проверь пожалуйста макет — @Nikita', author: { user_id: 2, username: 'Nikita' }, forward: { author: { user_id: 1, username: 'Александр' }, created_at: 1800000000 }, created_at: 1800000001, revision: 1, edited_at: null, reactions: [], reactions_revision: 1 }], deleted_ids: [], cursor: 5, reset: true, has_more: false, has_older: false } }))
  await page.getByRole('button', { name: /^проекты(?:,|$)/ }).click()
  const row = page.locator('[data-message-id="121"]')
  await expect(row.locator('.message-forward')).toContainText('Переслано от Александр')
  await expect(row).not.toHaveClass(/message--mentioned/)
  await row.click({ button: 'right' })
  await expect(page.getByRole('menuitem', { name: 'Изменить', exact: true })).toHaveCount(0)
  await page.setViewportSize({ width: 390, height: 844 })
  await row.click({ button: 'right' })
  await page.getByRole('button', { name: 'Все реакции', exact: true }).click()
  const box = await page.getByRole('menu', { name: 'Действия с сообщением' }).boundingBox()
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(390)
  expect(box!.y + box!.height).toBeLessThanOrEqual(844)
  await page.screenshot({ path: 'node_modules/.cache/message-menu-mobile.png', animations: 'disabled' })
})

for (const theme of ['dark','light']) {
  for (const size of [{width:360,height:800},{width:1280,height:720},{width:1920,height:1080}]) {
    test(`audit empty voice room ${theme} ${size.width}`,async({page})=>{
      await page.emulateMedia({reducedMotion:'reduce'})
      await page.setViewportSize(size)
      const {emit}=await openCallWorkspace(page)
      if (size.width < 760) await page.locator('.members-sidebar').getByRole('button',{name:'Скрыть участников'}).click()
      await page.evaluate((theme)=>{document.documentElement.dataset.theme=theme},theme)
      emit('voice.snapshot',{participants:[]})
      const card=page.locator('.voice-empty')
      await expect(card).toBeVisible()
      await expect.poll(async()=>{
        const box=await card.boundingBox(),area=await page.locator('.voice-stage-content').boundingBox()
        return box && area ? Math.abs(box.y+box.height/2-area.y-area.height/2) : Infinity
      }).toBeLessThan(3)
      const box=await card.boundingBox(),area=await page.locator('.voice-stage-content').boundingBox()
      expect(box).toBeTruthy();expect(area).toBeTruthy()
      expect(box!.width).toBeLessThanOrEqual(312)
      expect(Math.abs(box!.x+box!.width/2-area!.x-area!.width/2)).toBeLessThan(3)
      expect(Math.abs(box!.y+box!.height/2-area!.y-area!.height/2)).toBeLessThan(3)
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true)
      await expect(page.getByRole('button',{name:'Подключиться к каналу',exact:true})).toBeVisible()
      await expect(page.getByRole('button',{name:'Обновить участников канала'})).toHaveCount(0)
      await page.screenshot({path:`node_modules/.cache/audit-ui/empty-${theme}-${size.width}.png`,fullPage:true,animations:'disabled'})
      emit('voice.snapshot',{participants:[{connection_id:'joined',user_id:2,server_id:1,channel_id:1,self_mute:false,self_deaf:false}]})
      await expect(card).toHaveCount(0)
      await expect(page.locator('.voice-participant')).toHaveCount(1)
    })
  }
}

test('two tabs serialize rotation and share explicit logout',async({page,context})=>{
  let requests=0
  let release!:()=>void
  const gate=new Promise<void>((resolve)=>{release=resolve})
  await context.route('**/api/v1/auth/refresh',async(route)=>{
    requests+=1
    await gate
    await route.fulfill({json:{token:'rotated',expires_at:Math.floor(Date.now()/1000)+3600}})
  })
  await context.route('**/api/v1/auth/logout',async(route)=>{await route.fulfill({status:204})})
  await page.goto('/e2e/fixtures/auth-race.html')
  await page.evaluate(()=>localStorage.setItem('voxhold.session.v1',JSON.stringify({user:{id:1,username:'Alice',created_at:1},session:{token:'old',expires_at:Math.floor(Date.now()/1000)+60}})))
  await page.reload()
  await expect.poll(()=>requests).toBe(1)
  const second=await context.newPage()
  await second.goto('/e2e/fixtures/auth-race.html')
  await expect(second.getByText('loading',{exact:true})).toBeVisible()
  expect(requests).toBe(1)
  release()
  await expect(page.getByText('rotated',{exact:true})).toBeVisible()
  await expect(second.getByText('rotated',{exact:true})).toBeVisible()
  expect(requests).toBe(1)
  await page.getByRole('button',{name:'Logout'}).click()
  await expect(second.getByText('logged-out',{exact:true})).toBeVisible()
  await second.close()
})

for (const role of ['owner', 'member'] as const) {
  test(`${role} sees the configured recording storage quota`, async ({ page }) => {
    await openCallWorkspace(page, { role })
    await page.getByRole('button', { name: 'Список записей' }).click()
    await expect(page.locator('.recordings-hint')).toContainText('Лимит хранилища на сервере — 8 ГБ')
    await expect(page.locator('.recordings-hint')).not.toContainText('до 2 ГБ')
  })
}

test('publisher mixer reveals on hover and restores the selected volume after mute', async ({ page }) => {
  await page.goto('/e2e/fixtures/channel-access.html')
  const tile = page.locator('.call-stream-tile')
  const control = tile.locator('.stream-volume-control')
  const slider = control.getByRole('slider', { name: 'Исходящая громкость трансляции' })
  await expect(slider).toBeHidden()
  await control.hover()
  await expect(slider).toBeVisible()
  await slider.fill('37')
  await expect(control.locator('output')).toHaveText('37%')
  await control.getByRole('button', { name: 'Выключить звук трансляции' }).click()
  await expect(slider).toHaveValue('0')
  await control.getByRole('button', { name: 'Включить звук трансляции' }).click()
  await expect(slider).toHaveValue('37')
  await page.screenshot({ path: 'node_modules/.cache/stream-volume-hover.png', animations: 'disabled' })
  await tile.getByRole('button', { name: 'Развернуть: Вы показываете экран' }).click()
  const player = page.getByRole('dialog')
  await player.locator('.stream-volume-control').hover()
  await expect(player.getByRole('slider')).toHaveValue('37')
  await page.setViewportSize({ width: 375, height: 812 })
  await player.getByRole('button', { name: 'Выключить звук трансляции' }).click()
  await expect(player.getByRole('slider')).toHaveValue('0')
  await player.getByRole('button', { name: 'Включить звук трансляции' }).click()
  await expect(player.getByRole('slider')).toHaveValue('37')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('news channels appear first, keep reader permissions and hide the empty group', async ({ page }, testInfo) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const { emit } = await openCallWorkspace(page, { role: 'member' })
  await expect(page.locator('.channel-group > header')).toHaveText(['Текстовые каналы', 'Голосовые каналы'])
  const voice = { id: 1, server_id: 1, name: 'первый-голосовой', kind: 'voice', position: 0, created_by: 1, created_at: 1 }
  const text = { ...voice, id: 2, name: 'обсуждения', kind: 'text', position: 1 }
  const news = { ...voice, id: 3, name: 'новости-команды', kind: 'news', position: 2, access_restricted: true, can_publish: false, comments_enabled: true, unread_count: 123, last_message_id: 10 }
  let channels = [voice, text, news], unread = 123
  const post = { id: 10, channel_id: 3, content: 'Обновление Voxhold: новости теперь в отдельном канале', author: { user_id: 2, username: 'Мария' }, created_at: 1700000000, edited_at: null, revision: 2, comment_count: 1, reactions: [{ emoji: '👍', count: 2, me: false }] }
  const comment = { ...post, id: 11, content: 'Отлично, теперь всё важное легко найти', thread_root_id: 10, comment_count: 0, reply: { message_id: 10, author: post.author, content: post.content, revision: 2, deleted: false } }
  await page.route('**/api/v1/servers/1/channels', (route) => route.fulfill({ json: channels }))
  await page.route('**/api/v1/servers/1/notification-counts', (route) => route.fulfill({ json: [{ channel_id: 3, unread_count: unread }] }))
  await page.route('**/api/v1/servers/1/channels/3/messages/sync**', (route) => route.fulfill({ json: { messages: [post], deleted_ids: [], cursor: 2, reset: true, has_more: false, has_older: false } }))
  await page.route('**/api/v1/servers/1/channels/3/messages/10/comments**', (route) => route.fulfill({ json: { messages: [comment], pagination: { has_more: false, next_before_id: null } } }))
  await page.route('**/api/v1/servers/1/channels/3/messages/10/context**', (route) => route.fulfill({ json: { messages: [post], target_message_id: 10, target_index: 0 } }))
  await page.route('**/api/v1/servers/1/channels/3/read', async (route) => {
    unread = 0
    await route.fulfill({ json: { server_id: 1, channel_id: 3, user_id: 1, last_read_message_id: route.request().postDataJSON().last_read_message_id, updated_at: 1700000001 } })
  })
  emit('channels.changed', { server_id: 1 })
  await expect(page.locator('.channel-group > header')).toHaveText(['Новостные каналы', 'Текстовые каналы', 'Голосовые каналы'])
  const row = page.locator('.channel-row').filter({ hasText: 'новости-команды' })
  await expect(row.locator('.channel-row__badge')).toHaveText('99+')
  const lock = await row.locator('.channel-row__lock').boundingBox(), label = await row.locator('.channel-row__name').boundingBox()
  expect(lock && label && lock.width >= 20 && label.x - lock.x - lock.width < 12).toBeTruthy()
  await row.locator('.channel-row__main').click()
  await expect(page.getByText(post.content, { exact: true })).toBeVisible()
  await expect(page.getByLabel('Сообщение в новости-команды')).toHaveCount(0)
  await expect(page.getByText('Публикуют назначенные авторы.', { exact: false })).toBeVisible()
  await page.bringToFront()
  await page.locator('[data-message-id="10"]').click()
  await expect(row.locator('.channel-row__badge')).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('news-channel-desktop.png') })
  await page.getByRole('button', { name: 'Комментарии · 1', exact: true }).click()
  const panel = page.getByRole('complementary', { name: 'Комментарии к публикации' })
  await expect(panel.getByText(comment.content, { exact: true })).toBeVisible()
  await expect(panel.getByLabel('Сообщение в новости-команды')).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('news-comments-desktop.png') })
  channels = [voice, text, { ...news, comments_enabled: false, unread_count: 0 }]
  emit('channels.changed', { server_id: 1 })
  await expect(panel.getByText('Только чтение', { exact: true })).toBeVisible()
  await expect(panel.getByLabel('Сообщение в новости-команды')).toHaveCount(0)
  await page.setViewportSize({ width: 375, height: 812 })
  expect(await panel.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true)
  await expect(page.locator('.channel-sidebar')).not.toBeInViewport()
  await page.screenshot({ path: testInfo.outputPath('news-comments-mobile.png'), animations: 'disabled' })
  await panel.getByRole('button', { name: 'Закрыть комментарии' }).click()
  channels = [voice, text]
  emit('channels.changed', { server_id: 1 })
  await expect(page.locator('.channel-group > header')).toHaveText(['Текстовые каналы', 'Голосовые каналы'])
  expect(errors).toEqual([])
})


test('call controls show microphone, sound, screen and leave labels', async ({ page }, testInfo) => {
  await page.goto('/e2e/fixtures/ui-fixes.html')
  const controls = page.getByLabel('Управление звонком')
  await expect(controls.locator('button small')).toHaveText(['Микрофон', 'Звук', 'Экран', 'Стоп', 'Записи', 'Чат', 'Выйти'])
  await page.screenshot({ path: testInfo.outputPath('call-controls-labels.png'), animations: 'disabled' })
  await page.setViewportSize({ width: 375, height: 812 })
  expect(await controls.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true)
})

test('news channel creation configures publishers and comments', async ({ page }, testInfo) => {
  const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message))
  await openCallWorkspace(page)
  const voice = { id: 1, server_id: 1, name: 'первый-голосовой', kind: 'voice', position: 0, created_by: 1, created_at: 1 }
  const channels = [voice]
  let settings = { publisher_ids: [] as number[], comments_enabled: false }
  await page.route('**/api/v1/servers/1/channels', async (route) => {
    if (route.request().method() === 'POST') {
      const input = route.request().postDataJSON()
      expect(input.kind).toBe('news')
      const created = { ...voice, id: 3, position: 1, ...input, comments_enabled: settings.comments_enabled, can_publish: true }
      channels.push(created)
      await route.fulfill({ status: 201, json: created })
    } else await route.fulfill({ json: channels.map((channel) => channel.id === 3 ? { ...channel, comments_enabled: settings.comments_enabled, can_publish: true } : channel) })
  })
  await page.route('**/api/v1/servers/1/channels/3/news', async (route) => {
    if (route.request().method() === 'PUT') settings = route.request().postDataJSON()
    await route.fulfill({ json: settings })
  })
  await page.route('**/api/v1/servers/1/channels/3/access', (route) => route.fulfill({ json: { restricted: false, user_ids: [], roles: [] } }))
  await page.getByRole('button', { name: 'Добавить: Текстовые каналы', exact: true }).click()
  const creation = page.getByRole('dialog', { name: 'Создать канал', exact: true })
  await creation.getByText('Новостной', { exact: true }).click()
  await creation.getByPlaceholder('новый-канал').fill('новости')
  await creation.getByRole('button', { name: 'Создать канал', exact: true }).click()
  await expect(page.locator('.channel-group > header')).toHaveText(['Новостные каналы', 'Текстовые каналы', 'Голосовые каналы'])
  await expect(page.getByLabel('Сообщение в новости', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Изменить новости', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Изменить канал', exact: true })
  await dialog.getByRole('checkbox', { name: /Мария/ }).check()
  await dialog.getByText('Разрешить комментарии', { exact: true }).click()
  const request = page.waitForRequest((request) => request.method() === 'PUT' && request.url().endsWith('/channels/3/news'))
  await dialog.getByRole('button', { name: 'Сохранить публикации', exact: true }).click()
  expect((await request).postDataJSON()).toEqual({ publisher_ids: [2], comments_enabled: true })
  await expect(dialog.getByText('Настройки публикаций сохранены.', { exact: true })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('news-channel-settings.png'), animations: 'disabled' })
  expect(errors).toEqual([])
})

test('ban action describes instance-wide scope before confirmation', async ({ page }) => {
  await openCallWorkspace(page, { withPeers: true })
  await page.locator('.voice-participant').filter({ hasText: 'Мария' }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Забанить на инстансе', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Забанить Мария на инстансе?' })
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('будет забанен на этом инстансе')
  await expect(dialog.getByRole('button', { name: 'Забанить', exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: 'Отмена', exact: true }).click()
})

test('native context menus remain available in inputs and with Shift', async ({ page }) => {
  await openCallWorkspace(page, { withPeers: true })
  await page.locator('.user-dock__profile').click()
  const input = page.getByRole('dialog', { name: 'Ваш профиль' }).locator('textarea')
  await expect(input).toBeVisible()
  expect(await input.evaluate((element) => element.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })))).toBe(true)
  await page.getByRole('dialog', { name: 'Ваш профиль' }).getByRole('button', { name: 'Отмена', exact: true }).click()
  const member = page.locator('.voice-participant').filter({ hasText: 'Мария' })
  expect(await member.evaluate((element) => element.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, shiftKey: true })))).toBe(true)
  await expect(page.getByRole('menu')).toHaveCount(0)
})

test('mobile controls use readable type and muted text meets contrast in both themes', async ({ page }) => {
  await openCallWorkspace(page)
  for (const theme of ['dark', 'light']) {
    const ratios = await page.evaluate((theme) => {
      document.documentElement.dataset.theme = theme
      const style = getComputedStyle(document.documentElement)
      const luminance = (value: string) => {
        let hex = value.trim().replace('#', '')
        if (hex.length === 3) hex = [...hex].map((v) => v + v).join('')
        const values = [0, 2, 4].map((at) => parseInt(hex.slice(at, at + 2), 16) / 255).map((v) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
        return values[0]! * 0.2126 + values[1]! * 0.7152 + values[2]! * 0.0722
      }
      const muted = luminance(style.getPropertyValue('--muted'))
      return ['--bg', '--surface', '--surface-2', '--surface-3'].map((key) => {
        const background = luminance(style.getPropertyValue(key))
        return (Math.max(muted, background) + 0.05) / (Math.min(muted, background) + 0.05)
      })
    }, theme)
    ratios.forEach((ratio) => expect(ratio).toBeGreaterThanOrEqual(4.5))
  }
  await page.locator('.user-dock__profile').click()
  await page.setViewportSize({ width: 375, height: 812 })
  const dialog = page.getByRole('dialog', { name: 'Ваш профиль' })
  await expect(dialog.locator('textarea')).toBeVisible()
  expect(await dialog.locator('textarea').evaluate((element) => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(16)
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
  await page.screenshot({ path: 'node_modules/.cache/audit-typography-mobile.png', fullPage: true, animations: 'disabled' })
})

test('account deletion belongs to the profile and requires a typed username', async ({ page }) => {
  await openCallWorkspace(page, { role: 'member' })
  let deletes = 0
  await page.route('**/api/v1/me', async (route) => {
    if (route.request().method() === 'DELETE') { deletes++; await route.fulfill({ status: 409, json: { error: 'try later' } }) }
    else await route.fallback()
  })
  await page.locator('.user-dock__profile').click()
  const dialog = page.getByRole('dialog', { name: 'Ваш профиль' })
  await dialog.getByRole('button', { name: 'Удалить аккаунт', exact: true }).click()
  const confirmation = dialog.getByRole('button', { name: 'Удалить аккаунт навсегда' })
  await expect(confirmation).toBeDisabled()
  await dialog.getByLabel('Имя пользователя для удаления аккаунта').fill('Александр')
  await expect(confirmation).toBeEnabled()
  expect(deletes).toBe(0)
  await dialog.getByRole('button', { name: 'Отменить удаление' }).click()
  await expect(dialog.getByLabel('Имя пользователя для удаления аккаунта')).toHaveCount(0)
})

test('voice dock exposes the microphone and sound toggle state', async ({ page }) => {
  await openCallWorkspace(page)
  await page.getByRole('button', { name: 'Подключиться к каналу', exact: true }).click()
  const dock = page.locator('.voice-dock')
  await expect(dock).toBeVisible()
  const microphone = dock.getByRole('button', { name: 'Выключить микрофон' })
  await expect(microphone).toHaveAttribute('aria-pressed', 'false')
  await microphone.click()
  await expect(dock.getByRole('button', { name: 'Включить микрофон' })).toHaveAttribute('aria-pressed', 'true')
  await dock.getByRole('button', { name: 'Выключить звук' }).click()
  await expect(dock.getByRole('button', { name: 'Включить звук' })).toHaveAttribute('aria-pressed', 'true')
})

test('channel list updates preserve an open search query', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
  await page.route('**/api/v1/diagnostics/client-events', (route) => route.fulfill({ status: 204 }))
  const { emit } = await openCallWorkspace(page)
  await page.getByRole('button', { name: 'Поиск', exact: true }).click()
  const input = page.getByPlaceholder('Введите слово или фразу')
  await input.fill('keep this query')
  await page.route('**/api/v1/servers/1/channels', (route) => route.fulfill({ json: [
    { id: 1, server_id: 1, name: 'первый-голосовой', kind: 'voice', position: 0, created_by: 1, created_at: 1 },
    { id: 2, server_id: 1, name: 'новый-текстовый', kind: 'text', position: 1, created_by: 1, created_at: 1 },
  ] }))
  emit('channels.changed', { server_id: 1 })
  await expect(page.getByRole('button', { name: 'новый-текстовый', exact: true })).toBeVisible()
  await expect(input).toHaveValue('keep this query')
  await expect(page.locator('.panel-loading')).toHaveCount(0)
  expect(errors).toEqual([])
})
