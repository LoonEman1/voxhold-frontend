# Voxhold-frontend 2.5.0 — план исправлений по аудиту

Документ для исполнителя (человека или модели). Описывает **что** сломано, **где**
(ссылки на файлы и строки актуальны для коммита `0a4eb36`), **почему** и **как**
исправить, а также как проверить результат.

## Общие правила

- Стек: React 19 + TypeScript (strict, `noUncheckedIndexedAccess`), Vite, Vitest,
  Playwright. Проверки: `npm run typecheck`, `npm run lint` (`--max-warnings 0`),
  `npm test`. В Docker: `docker build --target test .`.
- Один пункт — один коммит. Не смешивать исправления с рефакторингом.
- Сохранять стиль окружающего кода: плотность комментариев, именование, идиомы
  (например, refs-зеркала состояния в `WorkspacePage`, `AbortController` в эффектах).
- К каждому исправлению — тест (unit или компонентный). Существующие тесты не
  ослаблять.
- Порядок: сначала 🔴 (1–3), затем 🟠 (4–9), затем остальное.

---

## 🔴 1. Ротация сессии разлогинивает пользователя и рвёт голос/трансляцию

### Контекст (поведение backend, проверено в `Voxhold-backend`)

- Сессия живёт 30 дней (`internal/account/service.go:16`), фронт обновляет её за
  5 минут до истечения (`REFRESH_MARGIN_SECONDS` в `src/auth/AuthContext.tsx`).
- `Service.Refresh` ротирует токен и **сразу** вызывает
  `sessionRevoker.RevokeSession(oldToken)` — до отправки HTTP-ответа.
- `Hub.RevokeSession` закрывает все WebSocket-клиенты старой сессии с кодом
  `1008` и причиной `"session expired or revoked"` и делает `Unregister` →
  `leaveVoice`. То есть **голосовая сессия и трансляция на сервере завершаются
  вместе со старым сокетом**.
- Запросы со старым токеном, которые ещё в полёте, получают `401`.

### Что происходит на фронте сейчас

1. Старый сокет получает close `1008 "session expired or revoked"` →
   `isAuthClose()` = true → `onStateChange('offline')` (запускает media-recovery)
   и `onUnauthorized()` ([realtime.ts:438-455](../src/services/realtime.ts)).
2. `onUnauthorized` в WorkspacePage ([WorkspacePage.tsx:814-819](../src/pages/WorkspacePage.tsx))
   **отменяет recovery** (`recoveryRef.current?.cancel('unauthorized')`) и вызывает
   `expire(oldToken)`.
3. `expire(oldToken)` в AuthContext: в `authRef` и в `localStorage` ещё старый
   токен (ответ `/auth/refresh` ещё не обработан) → `persist(null)` → **logout**.
   Затем приходит ответ refresh, но `generation` уже сменился → новый токен
   выбрасывается. Та же гонка срабатывает от `401` запросов в полёте и **между
   вкладками**: вкладка B без активной ротации видит старый токен в storage и
   удаляет ключ → storage event разлогинивает и вкладку A.
4. Если же ответ refresh успел раньше: токен меняется → эффект realtime
   ([WorkspacePage.tsx:802-1218](../src/pages/WorkspacePage.tsx)) закрывает
   старый клиент и создаёт новый. Событие `close` старого сокета приходит
   асинхронно, обработчик не проверяет, что сокет устарел, и вызывает
   `onStateChange('offline')` уже при живом новом клиенте. Если это случится после
   `ready` нового сокета — статус залипает в «Не в сети», `onlineByServer`
   сбрасывается, recovery ждёт `ready`, который не придёт, и через 60 с
   пользователя выкидывает из голосового канала.

### Исправление

#### 1a. AuthContext: не принимать решение об истечении, пока идёт ротация

Файл `src/auth/AuthContext.tsx`.

- Выделить текущую логику `expire` во внутренний `expireNow(expectedToken?)`
  (без изменений поведения).
- Публичный `expire(expectedToken?)`:
  - без `expectedToken` → `expireNow()` сразу (явный выход/удаление аккаунта);
  - если `authRef.current?.session.token !== expectedToken` → return;
  - если `refreshFlight.current?.token === expectedToken` → дождаться
    `refreshFlight.current.promise` и только потом вызвать `expireNow(expectedToken)`
    (после успешной ротации токен уже другой → no-op);
  - иначе, если есть `storage.withLock` → выполнить `expireNow(expectedToken)`
    **внутри** `storage.withLock(STORAGE_KEY, …)`: ротация в другой вкладке держит
    этот же lock до записи нового токена, поэтому внутри lock `expireNow` прочитает
    уже новый токен и примет его через `apply(saved, false)`;
  - иначе → `expireNow(expectedToken)`.
  - В отложенных ветках проверять `mounted.current` перед `expireNow`.
- В планировщике ротации: в `.catch(() => { if (current()) expire(token) })`
  и в ветке «сессия уже истекла при старте» вызывать **`expireNow`**, а не `expire`
  (иначе catch будет ждать собственный flight).

Эскиз:

```ts
const expireNow = useCallback((expectedToken?: string) => {
  if (expectedToken && authRef.current?.session.token !== expectedToken) return
  const saved = storage.read<PersistedAuth>(STORAGE_KEY)
  if (expectedToken && saved && saved.session.token !== expectedToken) apply(saved, false)
  else persist(null)
}, [storage, apply, persist])

const expire = useCallback((expectedToken?: string) => {
  if (!expectedToken) { expireNow(); return }
  if (authRef.current?.session.token !== expectedToken) return
  // Rotation revokes the old token (WS close 1008, 401 in flight) before its
  // response is stored. Decide only after that rotation releases the lock.
  const settle = () => { if (mounted.current) expireNow(expectedToken) }
  const flight = refreshFlight.current
  if (flight?.token === expectedToken) { void flight.promise.then(settle); return }
  if (storage.withLock) { void storage.withLock(STORAGE_KEY, async () => settle()).catch(settle); return }
  settle()
}, [storage, expireNow])
```

Тесты (`src/auth/AuthContext.test.tsx`, рядом с существующими):
- refresh в полёте → `notifyUnauthorized('old')` → токен всё ещё `old` → resolve
  `new` → `auth.token === 'new'`, в storage `new`.
- storage с `withLock` (простой мьютекс на цепочке промисов в тесте), ротации в
  этой вкладке нет: тест удерживает lock, вызывает `notifyUnauthorized('old')`,
  пишет в storage новый токен, отпускает lock → токен принят, а не `null`.
- без ротации `notifyUnauthorized('old')` по-прежнему разлогинивает.
- refresh завершился ошибкой → разлогин (существующие тесты должны проходить).

#### 1b. RealtimeClient: игнорировать события устаревшего сокета

Файл `src/services/realtime.ts`.

- В `close()` сначала отвязать сокет, потом закрыть:
  `const socket = this.socket; this.socket = null; socket?.close(1000, 'client closed')`
  (иначе синхронный close в тестовых фейках увидит `this.socket === socket`).
- В обработчиках `open`, `message`, `close` внутри `open()` первой строкой:
  `if (this.socket !== socket) return`. Для `close` диагностику можно записать до
  проверки с полем `stale: this.socket !== socket`. Никаких `onStateChange`,
  `onUnauthorized` и `scheduleReconnect` для устаревшего сокета.

Тесты (`src/services/realtime.test.ts`, есть `FakeWebSocket`):
- connect → open → ready → `client.close()` → у старого фейка эмулировать close
  → `onStateChange` не получил `'offline'` после закрытия, таймер реконнекта не
  ставился.
- `close()` → `connect()` → close-событие старого фейка → новый сокет остаётся
  рабочим (например, `subscribe()` отправляет `channel.subscribe` в новый фейк).

#### 1c. WorkspacePage: при замене realtime-соединения переподключать голос через recovery

Файл `src/pages/WorkspacePage.tsx`, cleanup эффекта realtime (строка 1217).

Сервер завершает голос/трансляцию вместе со старым сокетом, поэтому любая замена
клиента при живом голосовом канале должна идти через `beginSignallingRecovery`.
После 1b старый клиент больше не присылает `'offline'`, значит это нужно сделать
явно:

```ts
return () => {
  const replacing = workspaceActive.current
  client.close(); realtimeRef.current = null
  // The server ends voice/stream sessions together with their WebSocket
  // (a session rotation revokes it). Rejoin on the replacement connection.
  const phase = recoveryRef.current?.phase
  const recovering = phase === 'signalling_lost' || phase === 'rejoining_voice' || phase === 'restoring_stream'
  if (replacing && voiceSessionRef.current && !recovering) recoveryActionsRef.current.offline()
}
```

- `workspaceActive` уже есть (строка 161–162); его эффект объявлен раньше, поэтому
  при размонтировании он сбросится первым и recovery не стартует. Это нужно
  подтвердить тестом.
- Повторно стартовать recovery нельзя: `detachMediaPeers()` обнуляет
  `streamRoleRef`, и второй `begin` потеряет намерение восстановить трансляцию.

#### 1d. Не отменять recovery в `onUnauthorized`

Строки 814–819: убрать `recoveryRef.current?.cancel('unauthorized')` и
`setMediaRecovering(false)`, оставить `expire(token)`. Обоснование:
- при ротации close `1008` приходит **до** нового токена, и отмена убивает rejoin;
- при настоящей потере сессии `AuthProvider` обнулит токен → `AppRouter`
  размонтирует `WorkspacePage` → `closeVoiceLocally()` отменит recovery и
  освободит микрофон и захват экрана;
- инвариант «истёкшая сессия не переподключается сама» сохраняется: после
  auth-close клиент не делает реконнект и не присылает `ready`.

Обновить комментарий над `onUnauthorized`.

#### Приёмка пункта 1

Ручной сценарий:
1. Вкладка A: войти, подключиться к голосовому каналу, включить трансляцию.
2. В консоли A: `const s = JSON.parse(localStorage['voxhold.session.v1']); s.session.expires_at = Math.floor(Date.now()/1000) + 120; localStorage['voxhold.session.v1'] = JSON.stringify(s)`.
3. Открыть вкладку B с тем же origin: она сразу ротирует токен, сервер закроет
   сокет A.
4. Ожидается: A **не разлогинена**, за несколько секунд голос переподключается
   (индикатор восстановления), трансляция восстанавливается без повторного выбора
   экрана, статус возвращается в «В сети».

Желательно добавить e2e-сценарий в `e2e/` по образцу `client-reliability.spec.ts`.

---

## 🔴 2. Вложения открываются как blob-URL с MIME-типом, который задал загрузивший

**Где:** [MessageAttachments.tsx:13-27](../src/components/MessageAttachments.tsx).
Blob создаётся с `Content-Type` из ответа сервера, а тип задаёт тот, кто загрузил
файл (`community.upload` передаёт `file.type`). Ссылка «Скачать» ведёт на
`blob:` URL. Если открыть её в новой вкладке, `text/html`, `image/svg+xml` или
`application/xhtml+xml` отрисуются в origin приложения, а сессия лежит в
`localStorage`. CSP из nginx частично спасает (blob-документ наследует политику),
но в dev-режиме, в desktop-клиенте и за другими прокси защиты нет.

**Исправление:**
1. Новый модуль `src/lib/safeBlob.ts`:
   ```ts
   const INLINE_MEDIA = new Set([
     'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif',
     'video/mp4', 'video/webm', 'video/ogg',
     'audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/webm', 'audio/mp4',
   ])
   export function inlineMediaType(type: string): string | null {
     const value = type.split(';')[0]?.trim().toLowerCase() ?? ''
     return INLINE_MEDIA.has(value) ? value : null
   }
   /** Blob URLs inherit the app origin: only allow-listed media may keep a renderable type. */
   export function safeObjectBlob(blob: Blob, declaredType: string): Blob {
     const type = inlineMediaType(declaredType) ?? 'application/octet-stream'
     return blob.type === type ? blob : new Blob([blob], { type })
   }
   ```
2. В `AttachmentView`:
   - `const media = inlineMediaType(attachment.mime_type)`;
     `image = media?.startsWith('image/')`, `video = media?.startsWith('video/')`.
     SVG и всё остальное становится обычным файлом без превью;
   - `URL.createObjectURL(safeObjectBlob(blob, attachment.mime_type))`.
3. Для защиты в глубину применить тот же хелпер с картиночным allowlist в
   `RecordingPreview.tsx` и `AvatarProvider.tsx` (там blob попадает только в
   `<img>`, приоритет низкий).
4. Рекомендации для backend (отдельная задача): отдавать `/attachments/*/content`
   с `Content-Disposition: attachment` для всего, что не медиа из allowlist,
   добавить `X-Content-Type-Options: nosniff` и `Content-Security-Policy: sandbox`,
   определять MIME по содержимому при загрузке.

**Тесты:** `src/lib/safeBlob.test.ts` (html, svg, xhtml → octet-stream;
png/mp4 сохраняются; параметры вида `; charset=` отбрасываются) и компонентный
тест `AttachmentView` со стабом `URL.createObjectURL`, который проверяет тип
переданного blob и что для SVG не рендерится `<img>`.

---

## 🔴 3. CSP разрешает WebSocket на любой хост, HSTS нет

**Где:** [docker/security_headers.conf](../docker/security_headers.conf), строка 5:
`connect-src 'self' ws: wss:`. При XSS это открытый канал утечки данных на
произвольный хост.

**Исправление:**
1. Заменить заголовок на:
   ```
   default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'${CSP_CONNECT_EXTRA}; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'
   ```
   По CSP Level 3 `'self'` покрывает `ws:`/`wss:` того же хоста во всех
   поддерживаемых браузерах (Chromium, Firefox, Safari ≥ 15.4).
2. Если фронт собран с `VITE_API_BASE_URL` на другой origin, его нужно разрешить
   явно. Для этого сделать файл шаблоном:
   - переименовать в `docker/security_headers.inc.template` и копировать в
     `/etc/nginx/templates/` (envsubst образа nginx положит результат в
     `/etc/nginx/conf.d/security_headers.inc`; расширение `.inc`, чтобы
     `conf.d/*.conf` не подхватил его на уровне `http`);
   - поменять `include` в `nginx.conf.template` на новый путь;
   - в `Dockerfile` (runtime stage) задать `ENV CSP_CONNECT_EXTRA=""`: envsubst
     подставляет только определённые переменные, иначе в заголовке останется
     литерал `${CSP_CONNECT_EXTRA}`;
   - пример значения: `CSP_CONNECT_EXTRA=" https://api.example.com wss://api.example.com"`.
3. HSTS (`Strict-Transport-Security: max-age=31536000; includeSubDomains`)
   добавить на TLS-терминаторе (репозиторий `Voxhold-deploy`): этот nginx слушает
   HTTP 8080.

**Приёмка:** `docker compose up`, в DevTools нет CSP-ошибок; WebSocket, загрузка
вложений, аватары, записи и трансляции работают; `curl -I` показывает новый
заголовок на `/`, `/assets/*`, `/api/*`.

---

## 🟠 4. Телеметрия на каждое WebSocket-сообщение

**Где:** [realtime.ts:292](../src/services/realtime.ts) (`event_received` на каждое
входящее событие, включая ICE-кандидаты) и
[realtime.ts:476](../src/services/realtime.ts) (`event_sent`);
[clientDiagnostics.ts:207](../src/platform/clientDiagnostics.ts) `record()` не
фильтрует уровни. Итог: POST `/diagnostics/client-events` каждые 32 события и
запись до 256 событий в `sessionStorage` каждые 250 мс.

**Исправление:**
- Ввести минимальный уровень: в продакшене `info`
  (`import.meta.env.PROD`), переопределение через
  `localStorage['voxhold.diagnostics.level'] = 'debug'` (чтение в try/catch).
  `record()` с уровнем ниже минимального — ранний return до sanitize.
- `event_received` и `event_sent` не писать поштучно, а копить счётчики по
  `event_type` и раз в `FLUSH_INTERVAL_MS` отправлять одно событие
  `websocket_traffic` с агрегатами (по образцу `main_thread_load`).
- `flush(true)` с `keepalive`: ограничить тело ~60 КБ (лимит keepalive — 64 КБ),
  иначе fetch падает с `TypeError` и события теряются при закрытии вкладки.

**Тест:** в `clientDiagnostics.test.ts` — `debug` не попадает в pending в
prod-режиме; агрегат отправляется одним событием.

---

## 🟠 5. Каждое событие присутствия перерисовывает весь чат

**Где:** [WorkspacePage.tsx:881-893](../src/pages/WorkspacePage.tsx): `onPresenceUpdated`
меняет `last_seen_at` прямо в `members` → новый массив → в
[ChatPanel.tsx:451](../src/components/ChatPanel.tsx) пересоздаётся `rowContext` →
перерисовываются все видимые `ChatMessageRow` и заново выполняют
`parseMentions`. Плюс `ChannelButton` делает `members.find` для каждого участника
голосового канала ([WorkspacePage.tsx:2467](../src/pages/WorkspacePage.tsx)).

**Исправление:**
- Хранить `lastSeenByUser: Record<number, number>` отдельно от `members`
  (state или внешний store с `useSyncExternalStore`, как сделано в `MediaActivity`).
  `onPresenceUpdated` обновляет только его. Читают его `MembersSidebar`,
  `MemberCard`, профиль.
- В `ChatPanel` строить `directory` и `membersById` от «ключа идентичности»
  (`user_id:username:role`), чтобы изменения, не влияющие на рендер сообщений, не
  меняли ссылки. В `rowContext` не передавать сырой `members`; `MessageQuote` и
  `MentionComposer` перевести на `membersById`.
- В `ChannelButton` передавать `Map` вместо массива `members`.

**Приёмка:** React Profiler: событие `presence.updated` не перерисовывает
`ChatMessageRow`. Добавить сценарий в `e2e/client-performance.spec.ts`.

---

## 🟠 6. Любое `attachments.changed` перекачивает все видимые вложения

**Где:** [MessageAttachments.tsx:17](../src/components/MessageAttachments.tsx) —
глобальный `voxhold:attachments` сбрасывает URL и заново скачивает **каждое**
смонтированное вложение. [realtime.ts:323-324](../src/services/realtime.ts)
отправляет `Event` без данных, хотя backend шлёт `{channel_id}` или
`{conversation_id}` (`cmd/api/main.go:373-377`). Картинки грузятся в оригинале,
до 64 МБ.

**Исправление (фронт):**
- В realtime отправлять `CustomEvent('voxhold:attachments', { detail: payload.data })`.
- В `AttachmentView` реагировать только на свой канал или беседу (их нужно
  пробросить в `MessageAttachments` из `ChatPanel` и `Community`). При событии
  не сбрасывать текущий URL, а проверить статус лёгким запросом и показывать
  «удалено», только если сервер ответил `410`.
- Не скачивать картинки вне экрана: начинать загрузку через `IntersectionObserver`
  (как в `RecordingPreview.tsx`).

**Backend (отдельно):** класть в событие `attachment_ids` удалённых вложений и
отдавать уменьшенные превью (`/attachments/{id}/thumbnail`).

---

## 🟠 7. Community опрашивает сервер параллельно с WebSocket

**Где:** [Community.tsx:58](../src/components/Community.tsx) — `setInterval` на
15 с плюс полный перезапрос inbox и бесед на каждое `voxhold:community`
(приходит на каждый `notification.message` и `community.*`) и на `focus`.
Строки 72–78: privacy и роли перезапрашиваются при каждой смене `view`.

**Исправление:**
- Убрать 15-секундный интервал. Перезапрашивать при `ready` realtime
  (переподключение), при `visibilitychange → visible`, если с прошлой загрузки
  прошло больше 60 с, и по событиям.
- Для `notification.message` обновлять inbox инкрементально из payload, без
  полного перезапроса.
- Privacy и роли: зависимости эффекта `[api, token, serverId, roleRevision]`, без
  `view`.

---

## 🟠 8. Обновление токена сбрасывает кэш аватаров

**Где:** [AvatarProvider.tsx:67](../src/components/AvatarProvider.tsx) —
`useMemo(() => new AvatarCache(api, token), [api, token])`. После ротации все
аватары на миг заменяются инициалами и скачиваются заново. Кроме того,
`setVersions` (строки 22–34) считает «пользователя нет в текущем списке
участников» равным «аватара нет» и очищает аватары людей с других серверов
(например, в личных сообщениях).

**Исправление:**
- Кэш создавать от `api` и от `userId` (смена аккаунта), токен брать через
  getter из ref (`() => tokenRef.current`).
- Различать «версия неизвестна» и «аватара нет»: сливать версии, а не заменять
  карту целиком; очищать только при явном `null` (событие `avatar.updated` или
  участник в списке без `avatar_version`). Лишнее вытесняет LRU `trim()`.

---

## 🟠 9. Тяжёлый основной чанк

**Где:** `dist/assets/WorkspacePage-*.js` весит 488 КБ (без сжатия). Туда входят
`services/stream`, `hdrPipeline`, `hdrCapabilities`, `recording` и
`PersistentStreamPlayer`, хотя они нужны только при трансляции или записи.

**Исправление:**
- Загружать эти модули через `import()` в момент использования (`startStream`,
  `watchStream`, старт записи). Типы импортировать через `import type`.
- Подключить `rollup-plugin-visualizer` (dev-зависимость) для анализа бандла.
- В `vite.config.ts` выделить vendor-чанк React (`build.rollupOptions.output.manualChunks`),
  чтобы обновления приложения не сбрасывали его кэш.
- Цель: чанк `WorkspacePage` меньше 300 КБ без сжатия.

---

## 🟡 10. «Удалить с сервера» на самом деле банит на всём инстансе

**Где:** [WorkspacePage.tsx:2117-2121](../src/pages/WorkspacePage.tsx) и
[2200-2212](../src/pages/WorkspacePage.tsx). Пункт меню «Удалить с сервера»
вызывает `api.servers.banMember`, то есть `POST /servers/{id}/bans/{userId}`.
Отдельного kick в backend нет (есть только `/bans/` и `/members/{id}/role`).
Тост «удалён с сервера» вводит в заблуждение.

**Исправление:**
- Сейчас: переименовать пункт в «Забанить на инстансе», тост сделать как в
  `banViewedMember` («забанен на инстансе»), иконку заменить на предупреждающую.
- Потом, вместе с backend: добавить `DELETE /api/v1/servers/{id}/members/{userId}`
  (kick без бана) и вернуть пункт «Исключить с сервера».

---

## 🟡 11. После удаления текущего канала можно попасть в голосовой

**Где:** [WorkspacePage.tsx:2057](../src/pages/WorkspacePage.tsx) берёт `remaining[0]`.
В строках 706, 762 и 999 предпочтение отдаётся первому не голосовому каналу.

**Исправление:** вынести `pickDefaultChannel(channels)` (первый `kind !== 'voice'`,
иначе первый) и использовать во всех четырёх местах. В `removeChannel` также
сбрасывать `focusedMessageId` и `messageTarget`.

---

## 🟡 12. Повторный монтаж WorkspacePage после принятия приглашения

**Где:** [App.tsx:64](../src/App.tsx) и [App.tsx:72-77](../src/App.tsx). После
`accept` hash очищается, а `WorkspacePage` рендерится внутри `InviteRoute`. При
следующем изменении auth (например, при ротации) `AppRouter` вызывает
`inviteTokenFromLocation()` → `null` и рендерит `WorkspacePage` в другой позиции
дерева: полный перемонтаж со сбросом состояния и WebSocket. Нового `#/invite/...`
при открытом приложении никто не замечает: слушателя `hashchange` нет.

**Исправление:** хранить `inviteToken` в state `AppRouter`
(`useState(inviteTokenFromLocation)` и слушатель `hashchange`). `InviteRoute` не
рендерит `WorkspacePage`, а по успеху вызывает `onAccepted()`: `AppRouter`
сбрасывает `inviteToken` и рендерит `WorkspacePage` из своей обычной ветки.
Тест — по образцу `e2e/fixtures/auth-race.tsx`.

---

## 🟡 13. Выгрузка диагностики может не скачаться

**Где:** [WorkspacePage.tsx:2038](../src/pages/WorkspacePage.tsx) —
`URL.revokeObjectURL` сразу после `anchor.click()`, и часть браузеров отменяет
загрузку. В `src/services/recordingStore.ts:85-88` для этого уже стоит задержка
60 с.

**Исправление:** вынести `downloadBlob(blob, filename)` в `src/lib/` (с
отложенным `revokeObjectURL`) и использовать в обоих местах.

---

## 🔵 14. Нативное контекстное меню отключено везде, включая поле ввода

**Где:** [WorkspacePage.tsx:2361](../src/pages/WorkspacePage.tsx) —
`<main onContextMenu={(event) => event.preventDefault()}>`. В поле сообщения
нельзя вставить текст правым кликом, нет подсказок проверки орфографии, нельзя
скопировать выделенный текст или ссылку.

**Исправление:**
```ts
onContextMenu={(event) => {
  const target = event.target as HTMLElement
  if (isEditableKeyboardTarget(target) || target.closest('a[href]') || window.getSelection()?.toString()) return
  event.preventDefault()
}}
```
В меню сообщения (`ChatPanel` строка 526, `Community.tsx` строка 283): если внутри
сообщения есть выделение, не перехватывать меню. Shift+правый клик всегда
открывает нативное меню.

---

## 🔵 15. Мелкий текст и автоувеличение масштаба на iOS

**Где:** в CSS 33 вхождения `font-size: 8px` и 36 вхождений `9px`
(`src/styles/*.css`). `.composer textarea` — 12px
([workspace.css:30](../src/styles/workspace.css)), из-за этого iOS Safari
увеличивает масштаб при фокусе.

**Исправление:**
- Ввести шкалу токенов в `:root` (`--font-2xs: 11px; --font-xs: 12px; --font-sm: 13px; --font-md: 14px`),
  заменить 8–9px на `--font-2xs` и выше.
- `@media (max-width: 760px) { input, textarea, select { font-size: 16px; } }`
  (в том числе для композера).
- Проверить контраст `--muted` на обоих фонах (WCAG AA, 4.5:1).

---

## 🔵 16. Светлая тема: мерцание, системные элементы и падение без storage

**Где:** [index.html:7](../index.html) — `<meta name="color-scheme" content="dark">`;
`src/theme/ThemeContext.tsx` — `localStorage.getItem` и `setItem` без
try/catch. При заблокированном storage (некоторые приватные режимы) это
исключение при рендере, и приложение не запускается.

**Исправление:**
- `<meta name="color-scheme" content="dark light">`.
- Ставить `data-theme` до React: маленький **внешний** скрипт `public/theme-init.js`
  (inline запрещён CSP `script-src 'self'`), подключённый синхронно в `<head>`.
  Он читает `voxhold.theme.v1` или `prefers-color-scheme` и ставит `data-theme`
  и `color-scheme` на `<html>`.
- Обновлять `<meta name="theme-color">` при переключении темы.
- Все обращения к `localStorage` в `ThemeContext` обернуть в try/catch.

---

## 🔵 17. Ссылки в сообщениях не кликабельны

**Где:** `src/components/MessageMentions.tsx` — URL выводится обычным текстом.

**Исправление:** при рендере выделять `https?://…` в
`<a href target="_blank" rel="noopener noreferrer nofollow">`. Разрешать только
схемы `http` и `https` (через `new URL()` и проверку `protocol`). Не трогать
код в бэктиках (диапазоны уже вычисляет `parseMentions`). Отрезать хвостовую
пунктуацию (`.,)!?»`). Длинные URL сокращать в отображении.
**Тесты:** `javascript:` и `data:` не становятся ссылками, `https://a.b/c).` →
ссылка без `).`, URL внутри кода не превращается в ссылку.

---

## 🔵 18. Удаление аккаунта не на своём месте, доступность кнопок голоса

- [WorkspaceDialogs.tsx:308](../src/components/WorkspaceDialogs.tsx): «Удалить
  аккаунт» живёт в настройках **сервера**. Перенести в `ProfileDialog` (раздел
  «Опасная зона») с подтверждением вводом имени пользователя.
- `VoiceDock` ([WorkspacePage.tsx:2474-2476](../src/pages/WorkspacePage.tsx)):
  добавить `aria-pressed` и `aria-label` кнопкам микрофона и звука, менять иконку
  на `micOff` / `headphonesOff` в выключенном состоянии (как в `ChannelButton`).

---

## Мелочи (по желанию)

- `uploadAvatar` и `uploadPreview` передают `contentType: file.type`, а при пустом
  типе уходит `Content-Type: ` (пустой). Нужен fallback `|| 'application/octet-stream'`
  (`src/services/api.ts:129`).
- `MessageSearchPanel` получает `key` с id всех каналов
  ([WorkspacePage.tsx:2399](../src/pages/WorkspacePage.tsx)): любое изменение
  списка каналов сбрасывает поисковый запрос. Ключ — только `serverId`.
- Сессия в `localStorage` остаётся мишенью для XSS. Полное решение (HttpOnly
  cookie + CSRF-защита) требует изменений в backend; пока главная защита — пункты
  2 и 3.

## Поддерживаемость (отдельная серия PR, после исправлений)

- `src/pages/WorkspacePage.tsx` (2531 строка, около 60 `useState`): вынести хуки
  `useRealtimeConnection`, `useVoiceSession`, `useStreamSession`,
  `useChannelList`, `usePinnedMessages`. Стабилизировать колбэки для `ChatPanel`
  (ref-события) и обернуть его в `memo`.
- `src/components/Community.tsx` и `CommunityFeatures.tsx` написаны в
  «минифицированном» стиле, их трудно ревьюить. Отформатировать (например,
  Prettier только для этих файлов) отдельным коммитом без изменения логики.
- `react-hooks/exhaustive-deps` поднять до `error`, когда baseline будет чистым
  (`eslint.config.js`).
