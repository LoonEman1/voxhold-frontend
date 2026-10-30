# План исправлений и ускорений после аудита 2.5.2

Целевой выпуск по уточнению владельца: **патч 2.5.3**. Имя исходного файла
сохранено; итоговый отчёт — `docs/audit-2.5.3-status.md`.

Составлено 31 октября 2026 года по коду `Voxhold-frontend` (ветка
`codex/url-credentials-2-5-2`) и `Voxhold-backend` (`1f0275b`). Пункты из
`docs/audit-2.5-fixes-status.md` здесь не повторяются.

Документ написан как инструкция для исполнителя: у каждого пункта есть
проблема с доказательством, файлы, шаги, тесты и критерии приёмки. Номера
строк со временем сдвигаются, поэтому места указаны через имя функции или
уникальную строку кода, которую нужно найти поиском.

Пути без префикса относятся к frontend. Пути с префиксом `backend:` относятся
к соседнему репозиторию `../Voxhold-backend`.

---

## 0. Правила работы (прочитать до начала)

1. **Один пункт — один коммит** (или небольшая серия коммитов). Не смешивать
   пункты. Не делать попутный рефакторинг, переименования и переформатирование.
2. **Стиль как в окружающем коде.** Во frontend много компактных однострочных
   конструкций — так и писать рядом с ними. Тексты для пользователя на русском.
   Новые npm- и Go-зависимости не добавлять.
3. **Совместимость версий.** Новый frontend обязан работать со старым backend
   2.5.2, и наоборот: новые поля JSON необязательные, новые события
   WebSocket безопасно игнорируются.
4. **Миграции.** В плане одна новая миграция — `000033` (пункты 6 и 18).
   Порядок развёртывания прежний: бэкап БД → миграция → backend → frontend.
5. **Проверки перед коммитом.**
   - Frontend (из `Voxhold-frontend`):
     ```bash
     npm run lint
     ```
     ```bash
     npm run typecheck
     ```
     ```bash
     npm test
     ```
     ```bash
     npm run build
     ```
     Для UI-пунктов дополнительно:
     ```bash
     npm run test:e2e:ui
     ```
   - Backend (из `Voxhold-backend`):
     ```bash
     go vet ./...
     ```
     ```bash
     go test ./...
     ```
     Локально установлен Go 1.26, а `go.mod` требует 1.27.3: Go сам скачает
     нужный toolchain (`GOTOOLCHAIN=auto`). Race-тесты запускать в Linux-контейнере:
     ```bash
     docker run --rm -v "$(pwd)":/src -w /src golang:1.27.3 go test -race ./internal/... ./cmd/...
     ```
6. **Не пушить и не публиковать** без явного согласия владельца репозитория.
7. Если факт из этого документа не подтверждается кодом (код уже изменился),
   остановиться и описать расхождение, а не «подгонять» реализацию.

---

## Общая инфраструктура (сделать первой, нужна пунктам 1, 12, 13)

### 0.1. Retry-After в ответах и ApiError

**Зачем.** Backend отвечает `429` с заголовком `Retry-After` (превью, загрузки),
но frontend этот заголовок не читает: `TransportResponse` содержит только
`status` и `data`.

**Файлы:** [src/platform/transport.ts](../src/platform/transport.ts),
[src/services/api.ts](../src/services/api.ts).

**Шаги.**
1. В интерфейс ответа транспорта добавить необязательное поле
   `retryAfterMs?: number`.
2. В `createFetchTransport().request` после получения `response` разобрать
   заголовок:
   ```ts
   function parseRetryAfter(value: string | null): number | undefined {
     if (!value) return undefined
     const seconds = Number(value)
     if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 30_000)
     const date = Date.parse(value)
     return Number.isFinite(date) ? Math.min(Math.max(0, date - Date.now()), 30_000) : undefined
   }
   ```
   и вернуть `{ status, data, retryAfterMs }`. То же сделать в `uploadRequest`
   через `xhr.getResponseHeader('Retry-After')`.
3. В `ApiError` добавить третий необязательный параметр конструктора
   `readonly retryAfterMs?: number`. В `unwrap` передавать
   `response.retryAfterMs`.
4. Создать `src/lib/retryBusy.ts`:
   ```ts
   import { ApiError } from '../services/api'

   const BUSY = new Set([429, 503])
   /** Retries server "busy" answers with Retry-After/backoff; aborts immediately. */
   export async function retryBusy<T>(signal: AbortSignal, load: () => Promise<T>, attempts = 4): Promise<T> {
     for (let attempt = 0; ; attempt++) {
       try { return await load() } catch (error) {
         if (signal.aborted || !(error instanceof ApiError) || !BUSY.has(error.status) || attempt >= attempts - 1) throw error
         const delay = (error.retryAfterMs ?? 500 * 2 ** attempt) + Math.random() * 250
         await new Promise<void>((resolve, reject) => {
           const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve() }, delay)
           const abort = () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')) }
           signal.addEventListener('abort', abort, { once: true })
         })
       }
     }
   }
   ```
   Важно: `src/lib` не должен создавать циклический импорт. Если импорт
   `ApiError` из `services/api` даёт цикл, перенести проверку на
   `error && typeof error === 'object' && 'status' in error`.

**Тесты.** `src/lib/retryBusy.test.ts` с fake timers (`vi.useFakeTimers()`):
повтор после 429 с `retryAfterMs`; отсутствие повтора для 404; немедленный
выход по abort во время ожидания; не больше `attempts` вызовов.

**Приёмка.** Все существующие тесты проходят; `ApiError` по-прежнему
создаётся с двумя аргументами во всех старых местах.

---

## P1 — заметные баги и риски

### 1. Превью картинок: 429 без повтора и повторная генерация

**Проблема.**
- `backend:internal/attachments/thumbnail.go`, функция `thumbnail`: на весь
  инстанс два слота генерации (`thumbnailSlots: make(chan struct{}, 2)` в
  `New` в `service.go`). Если оба заняты, сразу
  `fail(w, 429, "thumbnails busy; retry shortly")`.
- Frontend [src/lib/attachmentRequests.ts](../src/lib/attachmentRequests.ts)
  не повторяет 429. В [MessageAttachments.tsx](../src/components/MessageAttachments.tsx)
  пользователь видит текст ошибки и кнопку «Повторить».
- Кэш превью на сервере — 64 записи в памяти. При промахе снова открывается
  и декодируется оригинал (до 2560 px).
- На frontend превью живёт как Blob URL только пока строка смонтирована.
  Лента виртуализирована, поэтому при прокрутке назад превью качается заново.

**Шаги — backend.**
1. Хранить превью на диске в подкаталоге `thumbs/` корня вложений.
   `Cleanup` пропускает каталоги (`entry.IsDir()`), поэтому подкаталог не
   попадёт под очистку файлов.
   - В `New` после `os.OpenRoot(dir)`: `_ = root.Mkdir("thumbs", 0o700)`
     (ошибку `os.ErrExist` игнорировать).
   - Имя файла: `thumbs/<id>.jpg`. `id` уже проверен `validID`.
2. В `thumbnail` порядок такой:
   1. Проверка прав `contentMetadata` (как сейчас, **до** любого чтения файла).
   2. Если `deleted` → 410 (как сейчас).
   3. Попробовать `s.root.ReadFile("thumbs/" + id + ".jpg")`. Если есть —
      отдать.
   4. Иначе ждать слот с таймаутом вместо мгновенного 429:
      ```go
      timer := time.NewTimer(5 * time.Second)
      select {
      case s.thumbnailSlots <- struct{}{}:
          timer.Stop()
          defer func() { <-s.thumbnailSlots }()
      case <-r.Context().Done():
          timer.Stop()
          return
      case <-timer.C:
          w.Header().Set("Retry-After", "1")
          fail(w, 429, "thumbnails busy; retry shortly")
          return
      }
      ```
   5. После получения слота ещё раз проверить файл на диске (его мог создать
      параллельный запрос).
   6. Сгенерировать превью (существующий код), записать атомарно:
      `WriteFile("thumbs/<id>.jpg.tmp")` → `Rename` в `thumbs/<id>.jpg`.
      Ошибку записи только логировать, ответ всё равно отдать.
3. In-memory кэш (`thumbnails`, `thumbnailOrder`) удалить: его заменяет
   файловый кэш и page cache ОС.
4. Удалять файл превью везде, где удаляется оригинал:
   - `service.go`, функция `cleanup`: после `s.root.Remove(id)`;
   - `maintenance.go`, `cleanupEntry`: после `removeMissingOK(s.root, name)`
     для не-`.part` файлов;
   - `copy.go`: при откате `s.root.Remove(id)`.
   Везде использовать `removeMissingOK(s.root, "thumbs/"+id+".jpg")`.
5. Заголовок `Cache-Control: private, no-store` оставить как есть: это
   защищает удалённые вложения от показа из HTTP-кэша браузера.

**Шаги — frontend.**
1. В `AttachmentView` (MessageAttachments.tsx) обернуть загрузку превью:
   ```ts
   attachmentRequest(controller.signal, () => retryBusy(controller.signal, () => api.community.thumbnail(tokenRef.current, attachment.id, controller.signal)))
   ```
   То же для `api.community.content`.
2. Создать `src/lib/thumbnailCache.ts` — LRU-кэш Blob URL с подсчётом ссылок:
   ```ts
   interface Entry { url: string; refs: number }
   const MAX_UNUSED = 80
   const entries = new Map<string, Entry>()   // порядок вставки = LRU
   export function acquireThumbnail(key: string): string | null { const entry = entries.get(key); if (!entry) return null; entries.delete(key); entries.set(key, entry); entry.refs++; return entry.url }
   export function storeThumbnail(key: string, blob: Blob): string { /* createObjectURL, refs=1, set, trim() */ }
   export function releaseThumbnail(key: string) { /* refs--, trim() */ }
   export function dropThumbnail(key: string) { /* refs===0: revoke + delete; иначе entry.stale = true, а releaseThumbnail при refs===0 и stale делает revoke + delete */ }
   export function clearThumbnails() { /* revoke все, clear */ }
   function trim() { /* пока число записей с refs===0 > MAX_UNUSED, удалять самые старые с refs===0 и revokeObjectURL */ }
   ```
   Ключ: `${api.storageScope}:${userId}:${attachment.id}`, чтобы кэш не
   смешивался между аккаунтами и инстансами.
3. В эффекте превью: сначала `acquireThumbnail(key)`; если есть — сразу
   `setPreviewURL`, без сети. Иначе загрузить, `storeThumbnail`. В cleanup
   эффекта вместо `URL.revokeObjectURL` вызвать `releaseThumbnail(key)`.
4. Когда приходит удаление (`setRemoved(true)` из события
   `voxhold:attachments`), вызвать `dropThumbnail(key)`.
5. Ключ уже содержит аккаунт и инстанс, поэтому смешивания нет. Чтобы
   освободить память при выходе, в `WorkspacePage` добавить
   `useEffect(() => () => clearThumbnails(), [])` — WorkspacePage
   размонтируется при выходе из аккаунта вместе со всеми превью.

**Тесты.**
- Backend `internal/attachments/thumbnail_test.go`: второй запрос не
  декодирует изображение (проверить наличие файла `thumbs/<id>.jpg` после
  первого запроса); удаление вложения удаляет превью; при занятых слотах
  запрос ждёт и получает 200, когда слот освободился; без прав → 404, даже
  если файл превью уже на диске.
- Frontend: `thumbnailCache.test.ts` (LRU, refs, revoke); в
  `MessageAttachments.test.tsx` повторное монтирование не вызывает
  `api.community.thumbnail` второй раз; 429 → повтор → картинка показана.

**Приёмка.** Три вкладки одновременно открывают канал с 20 картинками — нет
ни одной ошибки «thumbnails busy». Прокрутка вверх-вниз по ленте не порождает
повторных запросов `/thumbnail` для уже показанных картинок.

---

### 2. Пиковая память при обработке изображений, нет GOMEMLIMIT

**Проблема.**
- `backend:internal/attachments/service.go`, `upload`: для картинок
  `io.ReadAll(file)` читает файл целиком (до 64 МиБ), затем `compressImage`
  делает `image.Decode` полного размера (до 30 Мп). Это около 120 МБ для
  RGBA и около 240 МБ для 16-битного PNG. Одновременно таких загрузок две
  (`uploads: make(chan struct{}, 2)`).
- Масштабирование `draw.CatmullRom` — самый дорогой фильтр.
- `GOMEMLIMIT` не задан ни в коде, ни в Dockerfile, ни в compose. На VPS с
  1–2 ГБ возможен OOM, а он обрывает все звонки и трансляции.
- Те же паттерны (`ReadAll` + полный `Decode`) есть в `avatar/image.go`
  (`OptimizeWithCrop`), `linkpreview/service.go` (`thumbnail`),
  `recordings/preview.go` (`optimizePreview`).

**Шаги.**
1. Создать пакет `backend:internal/imagelimit` с функцией бюджета
   декодирования:
   ```go
   // DecodedBytes estimates memory image.Decode will allocate for config.
   func DecodedBytes(config image.Config) int64 {
       pixels := int64(config.Width) * int64(config.Height)
       switch config.ColorModel {
       case color.GrayModel, color.AlphaModel:
           return pixels
       case color.YCbCrModel:
           return pixels * 3 // 4:4:4 worst case; 4:2:0 needs 1.5
       case color.RGBA64Model, color.NRGBA64Model:
           return pixels * 8
       case color.Gray16Model, color.Alpha16Model:
           return pixels * 2
       default:
           if _, ok := config.ColorModel.(color.Palette); ok {
               return pixels
           }
           return pixels * 4
       }
   }
   const MaxDecodedBytes = 128 << 20
   ```
   Юнит-тест на каждую ветку `switch`.
2. В `compressImage` и в генерации превью (`thumbnail.go`) после
   `DecodeConfig` добавить проверку
   `imagelimit.DecodedBytes(config) > imagelimit.MaxDecodedBytes` → ошибка
   «invalid image». Существующий лимит 30 Мп оставить: для обычных JPEG/PNG
   поведение не меняется, отсекаются только «тяжёлые» 16-битные изображения.
3. Убрать `io.ReadAll` в `upload`: изменить сигнатуру на
   `compressImage(file io.ReadSeeker)`. Внутри: `DecodeConfig(file)` →
   `file.Seek(0, io.SeekStart)` → `Decode(file)`. В `upload` открыть `temp`
   через `s.root.Open`, передать файл, затем закрыть **до** `WriteFile`
   в тот же `temp`.
4. Фильтр масштабирования: добавить бенчмарк
   `BenchmarkCompressImage` (изображение 6000×4000) и сравнить
   `draw.CatmullRom` и `draw.BiLinear`. Если визуальная разница на тестовых
   фото незаметна, перейти на `BiLinear` (обычно в 2–3 раза быстрее).
   Бенчмарк и цифры приложить к описанию коммита.
5. Применить шаги 2–3 к `avatar`, `linkpreview`, `recordings/preview` (там
   данные уже в памяти и ограничены меньшими лимитами — достаточно шага 2).
6. Мягкий лимит памяти. В `backend:cmd/api/main.go` в самом начале `main`:
   ```go
   if os.Getenv("GOMEMLIMIT") == "" {
       if limit, ok := cgroupMemoryLimit(); ok {
           debug.SetMemoryLimit(limit / 10 * 8)
           log.Printf("memory limit set to %d bytes (80%% of cgroup limit)", limit/10*8)
       }
   }
   ```
   `cgroupMemoryLimit` читает `/sys/fs/cgroup/memory.max` (cgroup v2): если
   содержимое `max` или файла нет — `false`. Файл `memlimit_linux.go` +
   заглушка `memlimit_other.go` (`//go:build !linux`), как в
   `internal/storagebudget/free_*.go`. Явная переменная окружения `GOMEMLIMIT`
   имеет приоритет и описывается в `.env.example`.

**Тесты.** `compressImage` с файлом-ридером даёт тот же результат, что раньше
(сравнить размеры выходного изображения); 16-битный PNG 6000×4000 отклоняется;
обычный 6000×4000 JPEG проходит. Для шага 6 — юнит-тест парсера содержимого
`memory.max` (`"max\n"`, `"1073741824\n"`, мусор).

**Приёмка.** `go test -bench CompressImage -benchmem` показывает снижение
`B/op` минимум на размер исходного файла; heap-профиль (`pprof`) двух
одновременных загрузок 30 Мп JPEG — пик заметно ниже прежнего.

---

### 3. Ежеминутная очистка вложений открывает write-транзакцию на каждый файл

**Проблема.**
- `backend:cmd/api/main.go`, горутина `storage/maintenance`: раз в минуту
  создаётся **один** контекст на 2 секунды, общий для
  `diagnosticsRepository.Cleanup`, `attachmentService.Cleanup` и
  `messageRepository.PruneChanges`.
- `backend:internal/attachments/maintenance.go`, `Cleanup`: читает **весь**
  каталог вложений. Для каждого файла старше 24 часов (то есть почти для
  каждого обычного вложения) берёт два глобальных мьютекса и вызывает
  `claimAbandoned`, а тот открывает `storage.BeginWrite` (IMMEDIATE) и
  выполняет `UPDATE ... json_each(scheduled_messages...)`. Для прикреплённых
  к сообщениям файлов это всегда пустая работа, после которой идёт откат.
- Последствия при тысячах вложений: каждую минуту до 2 секунд держится
  writer-lock SQLite и мьютекс загрузок; очистка упирается в таймаут на одних
  и тех же первых по алфавиту файлах (до остальных она не доходит), а
  `PruneChanges` получает уже истёкший контекст, и журнал изменений сообщений
  перестаёт чиститься.

**Шаги.**
1. В `main.go` дать каждой задаче обслуживания собственный контекст:
   `diagnostics` — 2 с, `attachments` — 5 с, `PruneChanges` — 2 с. Порядок
   вызовов не менять.
2. В `Cleanup` отфильтровать кандидатов одним read-only запросом на пачку
   имён вместо write-транзакции на каждый файл:
   - собрать имена (без `.part`, только `validID`) в пачки по 500;
   - для пачки выполнить
     ```sql
     SELECT j.value FROM json_each(?) j
     LEFT JOIN attachments a ON a.id = j.value
     WHERE a.id IS NULL
        OR a.deleted_at IS NOT NULL
        OR (a.message_id IS NULL AND a.direct_message_id IS NULL)
     ```
     в транзакции `&sql.TxOptions{ReadOnly: true}` (или просто `QueryContext`);
   - только для вернувшихся id вызывать существующий `cleanupEntry` (он
     сам проверит возраст файла и арбитрирует через `claimAbandoned`).
     `.part`-файлы обрабатывать как сейчас.
3. Мьютексы `s.mu` и `storagebudget.Mu` брать только вокруг `cleanupEntry`
   для реального кандидата (как сейчас), а не для каждого имени.
4. Сделать обход возобновляемым: хранить в `Service` поле
   `cleanupCursor string` (имя последнего обработанного файла). Если контекст
   истёк, следующий запуск продолжает с курсора; дойдя до конца — сбрасывает
   курсор в `""`.

**Тесты.** В `internal/attachments` по образцу
`cleanup_concurrency_test.go`: создать 5 000 записей с `message_id` и файлов
с mtime старше суток плюс 3 брошенных вложения. Проверить, что `Cleanup`
завершается быстрее 2 секунд, брошенные удалены, прикреплённые не тронуты.
Отдельно: `PruneChanges` выполняется, даже если `Cleanup` вернул ошибку
таймаута. Существующий конкурентный тест должен проходить без изменений.

**Приёмка.** Логи `attachment cleanup: context deadline exceeded` и
`message journal cleanup: context deadline exceeded` не появляются на базе
с 10 000 вложений.

---

### 4. Доставка уведомлений задерживает отправку сообщения

**Проблема.**
- `backend:internal/realtime/message_events.go`, `PublishMessageCreated`,
  вызывает `p.onCreated(value)` синхронно. В `main.go` этот callback делает
  `communityService.RecordThread` и `notificationService.Deliver`, то есть
  HTTP-ответ на отправку ждёт обе операции.
- `backend:internal/notifications/service.go`, `Deliver`: `s.db.BeginTx(ctx, nil)`
  при `_txlock=immediate` сразу берёт writer-lock, даже если получателей не
  окажется (обычное сообщение без упоминаний). Каждое сообщение захватывает
  writer-lock дважды.
- `s.online()` (`realtimeHub.ConnectedUserIDs`) строит слайс всех подключённых
  пользователей на каждое сообщение с получателями.

**Шаги.**
1. **Разделить чтение и запись в `Deliver`.**
   - Первая фаза: `s.db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})`, оба
     существующих SELECT (канал и кандидаты), `Commit`.
   - Если `len(deliveries) == 0` — вернуть `nil` (write-транзакции нет).
   - Вторая фаза: `storage.BeginWrite(ctx, s.db)` и существующий INSERT.
     Добавить в INSERT повторную проверку доступа, потому что между фазами
     права могли измениться:
     ```sql
     AND EXISTS(SELECT 1 FROM channel_accessible_members a
                WHERE a.channel_id = c.id AND a.user_id = CAST(j.value AS INTEGER))
     ```
   - Публиковать события только пользователям, реально вставленным в таблицу:
     добавить `RETURNING user_id` к INSERT, читать его через `QueryContext`
     (а не `ExecContext`) и собрать множество вставленных id.
     `ON CONFLICT DO NOTHING` + `RETURNING` в SQLite возвращает только
     вставленные строки; `WHERE` в SELECT уже есть, поэтому
     неоднозначности разбора `INSERT ... SELECT ... ON CONFLICT` не будет.
     Если какой-то существующий тест ожидает событие без строки в таблице —
     остановиться и описать случай, не подгонять тест.
2. **Проверка онлайна без полного списка.** В `backend:internal/realtime/hub.go`
   добавить:
   ```go
   func (h *Hub) IsUserOnline(userID int64) bool {
       h.clientsMu.RLock()
       defer h.clientsMu.RUnlock()
       return len(h.clientsByUser[userID]) > 0
   }
   ```
   В `notifications.NewService` заменить параметр `online func() []int64` на
   `isOnline func(int64) bool`; в `main.go` передать `realtimeHub.IsUserOnline`.
   Обновить тесты, которые создают `NewService`.
3. **Асинхронная доставка.** В `notifications.Service`:
   - поле `queue chan message.Message` (ёмкость 1024), метод
     `Enqueue(value message.Message)`:
     ```go
     select {
     case s.queue <- value:
     default:
         // Очередь полна: не теряем уведомление, доставляем синхронно.
         if err := s.Deliver(value); err != nil { log.Printf("deliver message notification: %v", err) }
     }
     ```
   - метод `Run(ctx context.Context)` — один воркер, который читает очередь и
     вызывает `Deliver`. Порядок сообщений сохраняется, потому что воркер один.
     После `ctx.Done()` дочитать уже лежащие в очереди элементы (не дольше
     5 секунд), затем выйти.
   - В `main.go` запустить `Run` через `safego.Go`, как `community/worker`, и
     дождаться завершения при остановке (`sync.WaitGroup`). Останавливать
     воркер **после** остановки HTTP-сервера (учесть порядок `defer`), чтобы
     не терять сообщения, принятые в последние секунды.
   - В callback `SetCreatedListener` оставить `RecordThread` синхронным (это
     одна вставка и только для ответов в обсуждениях; от неё зависит, кто
     подписан), а `Deliver` заменить на `Enqueue`.
   - `Deliver` оставить публичным и синхронным: на нём построены тесты.

**Тесты.** Сообщение без упоминаний не открывает write-транзакцию (проверить
через тестовую обёртку или по отсутствию строк в `channel_notifications` и
по счётчику вызовов). Пользователь, у которого отобрали доступ между фазами,
не получает строку и событие. `Enqueue` при переполненной очереди доставляет
синхронно. Порядок доставки двух сообщений сохраняется. Race-тест пакета.

**Приёмка.** Время ответа `POST` сообщения не зависит от числа подписчиков
уведомлений; существующие тесты уведомлений проходят.

---

### 5. WebSocket: зависшие соединения и лишние разрывы

**Проблема — клиент** ([src/services/realtime.ts](../src/services/realtime.ts)):
- нет проверки живости на уровне приложения (браузер не видит
  WebSocket-ping сервера). После сна ноутбука или смены Wi-Fi сокет может
  минутами считаться открытым, а UI показывает «В сети»;
- нет немедленного переподключения по событиям `online` и возврату вкладки;
  после долгого обрыва ожидание доходит до 30 секунд backoff.

**Проблема — сервер** (`backend:internal/realtime/http/handler.go`,
`writeLoop`, ветка `pingTicker.C`): каждые 30 секунд сессия перепроверяется
через БД. Любая ошибка, кроме `account.ErrUnauthorized` (например, таймаут
БД под нагрузкой), возвращается из `writeLoop` и рвёт соединение. Под
нагрузкой это массовое переподключение всех клиентов.

**Шаги — сервер.**
1. В `backend:internal/realtime/event.go` добавить
   `EventPing EventType = "ping"` и `EventPong EventType = "pong"`.
2. В `handleIncomingEvent` (`switch event.Type`) добавить:
   ```go
   case realtime.EventPing:
       return queueEvent(client, realtime.OutgoingEvent{RequestID: event.RequestID, Type: realtime.EventPong})
   ```
3. В `writeLoop` в ветке пинга различать ошибки:
   - `account.ErrUnauthorized` или другой пользователь → закрыть как сейчас;
   - иная ошибка `Authenticate` → увеличить локальный счётчик
     `authFailures`, залогировать один раз, **не** выходить; закрывать с
     `StatusTryAgainLater` только после 3 неудач подряд; при успехе сбрасывать
     счётчик в 0;
   - `connection.Ping` вызывать всегда, когда сессия не признана
     недействительной. Ошибка самого `Ping` по-прежнему означает обрыв.

**Шаги — клиент.**
1. Поля класса `RealtimeClient`: `heartbeatTimer`, `pongTimer`,
   `pendingPing: string | null`, `lastMessageAt = 0`, `hiddenAt = 0`.
2. В обработчике `message` в самом начале (после проверки
   `this.socket !== socket`): `this.lastMessageAt = Date.now()`; если пришёл
   `pong` или `error` с `request_id === this.pendingPing` — очистить
   `pongTimer`, `pendingPing = null` и выйти, **не** вызывая `onError`.
   Старый backend ответит на `ping` ошибкой «unsupported event type» — это
   тоже доказательство живости, поэтому совместимость сохраняется.
3. После `ready` запускать `heartbeatTimer = setInterval(..., 25_000)`. Тик:
   если уже ждём ответа (`pendingPing !== null`) или с `lastMessageAt` прошло
   меньше 20 секунд — ничего не делать; иначе
   `pendingPing = this.send('ping', {})`; если `send` вернул `null` (сокет не
   открыт) — ничего не делать; иначе
   `pongTimer = setTimeout(() => this.abandonSocket('heartbeat_timeout'), 10_000)`.
4. Метод `abandonSocket(reason)`:
   - записать диагностику `websocket/heartbeat_timeout` (warn);
   - сохранить ссылку `const socket = this.socket`, затем выполнить ту же
     логику, что и обработчик `close`: `this.socket = null`, сбросить
     `authenticated`, подписки, `awaitingUnsubscribe`, вызвать
     `onStateChange('offline')`, запланировать переподключение;
   - вызвать `socket?.close(4000, reason)`. Все обработчики старого сокета уже
     проверяют `this.socket !== socket`, поэтому его поздние события будут
     проигнорированы.
   Логику сброса вынести в общий приватный метод, чтобы не дублировать её
   с обработчиком `close`.
5. Быстрое переподключение. В `connect()` подписаться, в `close()` отписаться:
   - `window` `online` → если сокета нет или он не `OPEN`, а
     `!intentionallyClosed`: `clearTimeout(reconnectTimer)`, `attempts = 0`,
     `open()`;
   - `document` `visibilitychange`: при уходе в фон запомнить `hiddenAt`;
     при возврате, если вкладка была скрыта дольше 30 секунд: при открытом
     сокете сразу отправить ping (шаг 3 без ожидания тика), при закрытом —
     переподключиться как в `online`.
6. Все таймеры и слушатели очищать в `close()` и при смене сокета.

**Тесты** (`src/services/realtime.test.ts`, там уже есть фейковый WebSocket):
нет ответа на ping за 10 секунд → `onStateChange('offline')` и новый сокет;
ответ `pong` или `error` с тем же `request_id` → соединение живо, `onError`
не вызывается; `online` при ожидании backoff → немедленное `open()`;
после `close()` таймеры не срабатывают. Backend: тест `writeLoop` с
authenticator, который один раз возвращает `context.DeadlineExceeded`, —
соединение не закрывается; на `ErrUnauthorized` — закрывается.

**Приёмка.** В DevTools: «Offline» на 40 секунд, затем «Online» — переподключение
происходит в течение 1–2 секунд, без ожидания backoff.

---

### 6. Лента «прыгает» из-за картинок без размеров

**Проблема.** У вложения нет ширины и высоты (`backend:internal/message/attachments.go`,
тип `Attachment`; frontend `src/domain/community.ts`, `Attachment`). Пока
превью грузится, на его месте кнопка «Загрузка изображения…», потом
появляется картинка до 320 px высотой. `estimateMessageSize` в
[ChatPanel.tsx](../src/components/ChatPanel.tsx) не учитывает вложения и
карточки ссылок. В виртуализированной ленте из-за этого строка меняет высоту
после загрузки, и при прокрутке вверх список дёргается.

**Шаги — backend (миграция 000033, общая с пунктом 18).**
1. `migrations/000033_attachment_dimensions.up.sql`:
   ```sql
   ALTER TABLE attachments ADD COLUMN width INTEGER CHECK(width IS NULL OR width > 0);
   ALTER TABLE attachments ADD COLUMN height INTEGER CHECK(height IS NULL OR height > 0);
   CREATE INDEX attachments_usage ON attachments(deleted_at, category, size_bytes);
   ```
   `.down.sql` в обратном порядке: `DROP INDEX attachments_usage;`, затем два
   `ALTER TABLE attachments DROP COLUMN ...` (как в `000032_schedule_retries.down.sql`).
2. В `message.Attachment` добавить два поля:
   ```go
   Width  int `json:"width,omitempty"`
   Height int `json:"height,omitempty"`
   ```
3. `compressImage` возвращает итоговые `w, h`. В `upload` записать их в
   INSERT и в JSON-ответ.
4. Добавить `COALESCE(width,0),COALESCE(height,0)` во **все** SELECT
   метаданных вложений и в соответствующие `Scan`:
   - `internal/message/sqlite/attachments.go`;
   - `internal/community/conversations.go` (два запроса);
   - `internal/attachments/service.go` (запрос `existing` в `upload`);
   - `internal/attachments/copy.go` (SELECT и INSERT копии — размеры копируются).
   Найти все места: `grep -rn "mime_type,size_bytes" internal`.
5. Старые вложения: размеры остаются `NULL`. Можно дозаполнять лениво — при
   генерации превью в пункте 1 записывать `UPDATE attachments SET width=?, height=? WHERE id=? AND width IS NULL`
   (размер оригинала уже известен из `DecodeConfig`). Это не обязательно.

**Шаги — frontend.**
1. В `Attachment` (`src/domain/community.ts`) добавить `width?: number; height?: number`.
2. В `AttachmentView` для картинок задать размер блока заранее:
   ```tsx
   const box = attachment.width && attachment.height ? { aspectRatio: `${attachment.width} / ${attachment.height}`, maxHeight: 320, width: `min(100%, ${Math.round(320 * attachment.width / attachment.height)}px)` } : undefined
   ```
   Применить `style={box}` к `figure` или к контейнеру картинки, а у `img`
   оставить `width:100%; height:100%; object-fit:contain`. Плейсхолдер
   «Загрузка изображения…» при известных размерах рисовать как пустой блок
   того же размера (CSS-класс `attachment-image--placeholder` с фоном
   `var(--line)`).
3. В `estimateMessageSize` добавить высоту вложений: для каждой картинки
   `Math.min(320, 440 * h / w)` (или 240, если размеров нет) плюс 34 px
   подписи; для файлов — 56 px. Для сообщения со ссылкой — плюс 90 px на
   карточку (её наличие определяется так же, как в `MessageLinkPreviews`).

**Тесты.** Backend: загрузка картинки возвращает `width`/`height`; копия
вложения сохраняет размеры; старые строки без размеров отдаются без полей.
Frontend: снапшот-тест стиля `aspect-ratio`; e2e
`client-performance.spec.ts` — прокрутка вверх по ленте с картинками без
скачков `scrollTop` больше 4 px после загрузки превью.

---

## P2 — CPU и ОЗУ

### 7. SFU: аллокация буфера на каждый RTP-пакет

**Проблема.** `remote.ReadRTP()` в pion v4 на каждый вызов выделяет буфер
размером MTU и новый `rtp.Packet` (`track_remote.go`, `ReadRTP`). Циклы
пересылки: `backend:internal/stream/session.go` (`forwardTrack`) и
`backend:internal/voice/session.go` (цикл после `s.room.synchronizeSessions()`).
Трансляция 1080p60 — это сотни пакетов в секунду на поток, голос — 50 пакетов
в секунду на говорящего; всё это постоянная нагрузка на GC.

**Шаги.**
1. В обоих циклах:
   ```go
   buffer := make([]byte, 1500)
   var packet rtp.Packet
   for {
       n, _, err := remote.Read(buffer)
       if err != nil {
           return
       }
       packet = rtp.Packet{}
       if err := packet.Unmarshal(buffer[:n]); err != nil {
           continue
       }
       // дальше прежняя логика, но с &packet вместо packet
   }
   ```
2. **Проверить безопасность переиспользования буфера.** `WriteRTP` у
   `TrackLocalStaticRTP` и у `relayTrack` синхронный, но исходящие
   интерцепторы (NACK responder) могут сохранять пакет для повторной
   отправки. Открыть исходник `github.com/pion/interceptor@v0.1.49/pkg/nack/responder_interceptor.go`
   и убедиться, что пакет **копируется** в собственный буфер (packet factory).
   Если не копируется — не переиспользовать буфер, а взять `sync.Pool` и
   **не** возвращать буфер в пул (тогда выигрыш только на `rtp.Packet`).
   Результат проверки записать в комментарий над циклом.
3. Замыкание в `telemetry.Forward(..., func() error { return local.WriteRTP(packet) })`:
   проверить `go build -gcflags=-m ./internal/voice ./internal/stream 2>&1 | grep "func literal"`.
   Если пишет `escapes to heap` — переписать вызов так:
   ```go
   if telemetry.Enabled() {
       _ = telemetry.Forward(telemetry.VoiceRTP, func() error { return local.WriteRTP(&packet) })
   } else {
       _ = local.WriteRTP(&packet)
   }
   ```
   Если не утекает — оставить как есть.
4. Бенчмарк: `BenchmarkVoiceForward` / `BenchmarkStreamRelayWrite` с
   `b.ReportAllocs()` до и после.

**Тесты.** Существующие тесты `internal/voice` и `internal/stream` с `-race`.
Тест, что два подряд прочитанных пакета с разным payload доходят до
`relayTrack` с правильным содержимым (защита от гонки по общему буферу).

**Приёмка.** `allocs/op` в цикле пересылки снижается минимум на 2 на пакет;
race-тесты зелёные.

---

### 8. Рассылки presence: перебор всех клиентов и запись last_seen на каждый сервер

**Проблема.**
- `backend:internal/realtime/hub.go`, `clientsForServer`: для каждого события
  уровня сервера снимок **всех** клиентов инстанса и проверка `hasServer`
  у каждого. Используется в presence, `PublishToServer`, голосе,
  правах ролей. После рестарта backend все клиенты переподключаются, и
  стоимость растёт квадратично.
- `broadcastPresence` вызывает `lastSeenSaver` (запись в БД с таймаутом 1 с)
  при каждом переходе **для каждого сервера** пользователя. Пользователь в
  10 серверах → 10 одинаковых UPDATE.

**Шаги.**
1. Индекс клиентов по серверу. В `Hub` поле
   `clientsByServer map[int64]map[*Client]struct{}` под `clientsMu`,
   инициализация в `NewHub`. Хелперы (вызываются под `clientsMu.Lock`):
   `indexServerLocked(serverID, client)` и `unindexServerLocked(serverID, client)`
   (удалять пустые внутренние map).
2. Обновлять индекс во всех местах, где меняется набор серверов клиента:
   - `Register`: после добавления в `h.clients` — для каждого
     `client.serverIDs()`;
   - `AddUserToServer`: после успешного `client.addServer(serverID)` —
     `clientsMu.Lock`, затем **проверить, что клиент ещё зарегистрирован**
     (`if _, ok := h.clients[client]; ok { h.indexServerLocked(...) }`),
     `Unlock`. Без этой проверки параллельный `Unregister` может успеть
     удалить клиента из индекса раньше, и закрытый клиент останется в
     `clientsByServer` навсегда;
   - `removeClientServer`: после успешного `client.removeServer(serverID)`;
   - `Unregister`: под существующим `clientsMu.Lock` — для каждого
     `client.serverIDs()` (до `unregisterPresence`, который очищает набор).
   Порядок блокировок: сначала `clientsMu`, внутри — методы клиента
   (`serverIDs`, `hasServer`). Обратного порядка нигде не вводить.
   Найти все вызовы: `grep -n "addServer(\|removeServer(" internal/realtime/*.go`.
3. `clientsForServer` переписать на
   `clientSetSnapshot(h.clientsByServer[serverID])` под `RLock`.
4. Дедупликация last_seen. В `Hub` поля `lastSeenMu sync.Mutex` и
   `lastSeenAt map[int64]int64`. В `broadcastPresence` перед `save(...)`:
   пропустить запись, если для этого пользователя уже сохранено то же
   значение секунды. При offline-переходе запись из map удалять после
   сохранения, чтобы map не росла.

**Тесты.** Новый тест: клиент в двух серверах, удаление из одного — событие
второго сервера доходит, первого нет. Существующие тесты presence,
`RevokeServer`, `RevokeUserFromServer`, `AddUserToServer` с `-race`. Тест с
моком saver: пользователь в 5 серверах подключается → saver вызван 1 раз.

**Приёмка.** Бенчмарк `BenchmarkPublishToServer` при 5 000 клиентах в 50
серверах — время пропорционально размеру сервера, а не инстанса.

---

### 9. Клиентская диагностика: событие на каждый HTTP-запрос

**Проблема.** В production минимальный уровень `info`
([src/platform/clientDiagnostics.ts](../src/platform/clientDiagnostics.ts),
`configuredLevel`). [transport.ts](../src/platform/transport.ts) пишет
`http.request_completed` с уровнем `info` на **каждый** успешный запрос.
Всё это раз в 10 секунд отправляется на сервер, который хранит до 10 000
событий на пользователя 24 часа (`backend:internal/diagnostics/diagnostics.go`)
и чистит не больше 500 строк в минуту. Получается постоянный поток записей в
SQLite и рост базы.

**Шаги.**
1. В `transport.ts` уровень `request_completed`:
   - `debug`, если ответ успешный и `duration_ms < 1000`;
   - `warn`, если `duration_ms >= 1000` или `status >= 500`;
   - `info` для 4xx (кроме 401 — оставить `info`).
   Так же поступить в ветке `HEAD`/`204`.
2. На реальном инстансе посмотреть, какие ещё события самые частые, и при
   необходимости понизить их до `debug`:
   ```sql
   SELECT category, name, level, count(*) FROM client_diagnostic_events
   GROUP BY 1,2,3 ORDER BY 4 DESC LIMIT 20;
   ```
3. Backend: снизить `MaxEventsPerUser` с 10 000 до 2 000 и поднять лимит
   ежеминутной очистки с 500 до 2 000 строк (`sqlite/repository.go`,
   `LIMIT 500`). Это отдельный коммит.

**Тесты.** Тест транспорта: быстрый успешный запрос не попадает в `pending`
при уровне `info`; медленный попадает как `warn`.

---

### 10. Опрос getStats для уровней голоса

**Проблема.** [src/services/voice.ts](../src/services/voice.ts):
`ensureLevelTimer` запускает `sampleRemoteLevels` каждые 200 мс, внутри
`readPeerStats(this.peer, 150)` — то есть полный `getStats()` пять раз в
секунду. Отчёт растёт с числом участников.

Уточнение к первоначальному обзору: у трансляций уже есть общий кэш
`readPeerStats` ([peerStats.ts](../src/services/peerStats.ts), 500 мс), но
два сэмплера по 2 секунды (качество в `stream.ts` и `DecodeWatchdog`) не
выровнены и обычно делают по отдельному запросу.

**Шаги.**
1. Голос: приостанавливать `levelTimer`, пока `document.visibilityState === 'hidden'`
   (индикаторы не видны). На `visibilitychange` при скрытии — `clearInterval`
   и `levelTimer = null`, при показе — `ensureLevelTimer()`. Слушатель
   снимать в `close()`.
2. Трансляции: в `monitorVideoQuality` (stream.ts) и в
   `sampleInboundVideoStats` (mediaRecovery.ts) вызывать
   `readPeerStats(peer, 1_900)`, чтобы оба сэмплера с периодом 2 секунды
   использовали один отчёт.
3. Не трогать измеритель микрофона в `voiceInput.ts`: от него зависит шумовой
   гейт.
4. Необязательный эксперимент (только с замерами): сохранять в голосовом SFU
   расширение `ssrc-audio-level` (сейчас `packet.Extension = false;
   packet.Extensions = nil` в `voice/session.go`) с перенумерацией ID под
   каждого получателя и брать уровни через
   `RTCRtpReceiver.getSynchronizationSources()` (синхронно и дёшево). Делать
   только если профилирование показывает, что шаг 1 недостаточен.

**Тесты.** `voice.test.ts`: при `hidden` таймер не тикает, при возврате
возобновляется; после `close()` слушатель снят.

---

### 11. Межвкладочный «heartbeat» через localStorage

**Проблема.** [src/services/messageNotifications.ts](../src/services/messageNotifications.ts),
`start()`: `setInterval(refresh, 2_000)`, и `contextChanged` пишет
`localStorage.setItem(readingKey, ...)` каждые 2 секунды, пока вкладка в
фокусе. Каждая запись — запись на диск и событие `storage` во всех других
вкладках.

**Шаги.**
1. Если `typeof BroadcastChannel !== 'undefined'`: создать в `start()`
   `new BroadcastChannel('voxhold.notifications:' + scope)`; вместо записи в
   `localStorage` делать `channel.postMessage({ ...reading, tabId, at })`;
   при `releaseReading` — `postMessage({ tabId, released: true })`.
2. Хранить последнее полученное чужое состояние в поле `remoteReading`
   (обновлять в `channel.onmessage`). В `isReading` читать его вместо
   `localStorage` (с той же проверкой «не старше 5 секунд»).
3. Если `BroadcastChannel` недоступен — оставить текущий код с
   `localStorage` как запасной путь.
4. В функции остановки закрыть канал (`channel.close()`).

**Тесты.** Две инстанции `MessageNotificationCenter` с общим scope (в jsdom
`BroadcastChannel` есть в Node 18+; при отсутствии — простой мок): уведомление
не показывается во второй, если первая «читает» канал; `localStorage.setItem`
для ключа reading не вызывается.

---

### 12. HTTP: нет таймаута и повторов для GET

**Проблема.** В `createFetchTransport` у `fetch` нет таймаута; зависший запрос
(смена сети на мобильном) оставляет спиннер навсегда (например,
`pinsLoading`). Повторов для идемпотентных запросов нет (пункт P0.3 из
`IMPROVEMENTS.md` всё ещё открыт).

**Шаги** (после пункта 0.1).
1. В `TransportRequest` добавить необязательное `timeoutMs?: number`.
2. В `request`: если `responseType !== 'blob'`, таймаут по умолчанию 20 000 мс
   для GET/HEAD и 30 000 мс для остальных. Объединить сигналы:
   ```ts
   const timeout = AbortSignal.timeout(timeoutMs)
   const combined = signal ? (AbortSignal.any ? AbortSignal.any([signal, timeout]) : signal) : timeout
   ```
   При срабатывании таймаута `fetch` отклоняется с `DOMException` `TimeoutError`;
   `unwrap` пропускает только `AbortError`, поэтому таймаут превратится в
   `ApiError(..., 0)` — это и нужно. Для `blob` (скачивание вложений) таймаут
   не ставить.
3. Повторы только для `GET`/`HEAD` и только если `signal` не отменён:
   сетевая ошибка (исключение `fetch`, кроме `AbortError` от пользователя),
   статусы 502/503/504 и 429 с `retryAfterMs <= 10_000`. Максимум 2 повтора,
   задержка `retryAfterMs ?? 400 * 3 ** attempt` + случайные 0–200 мс.
   POST/PUT/PATCH/DELETE никогда не повторять.
4. Диагностику писать на каждую попытку с полем `attempt`.

**Тесты.** `transport.test.ts`: GET 503 → 200 возвращает данные с двумя
вызовами `fetch`; POST 503 не повторяется; пользовательский abort во время
ожидания прерывает сразу; зависший `fetch` (мок, который отклоняется только
по `signal`) отклоняется через `timeoutMs: 20`. Для таймаута использовать
реальные короткие задержки: `AbortSignal.timeout` не управляется fake timers
Vitest.

В браузерах без `AbortSignal.any` таймаут при переданном пользователем
`signal` не применяется — это допустимо, не писать для этого полифил.

---

### 13. Загрузки файлов: два слота на весь инстанс, без повтора

**Проблема.** `backend:internal/attachments/service.go`, `upload`:
`uploads: make(chan struct{}, 2)`, при занятых слотах сразу
`fail(w, 429, "uploads busy; retry shortly")`. Ограничение общее для обычных
файлов (просто запись на диск) и для картинок (дорогая обработка).
Frontend ([MessageAttachments.tsx](../src/components/MessageAttachments.tsx),
функция `run`) на 429 показывает «Не отправлено» без автоповтора.

**Шаги — backend.**
1. Разделить ограничения:
   - `uploads` — ёмкость 8 (ввод-вывод);
   - новое `imageSlots chan struct{}` ёмкостью 2 — только вокруг
     `compressImage`, с ожиданием до 30 секунд по образцу пункта 1
     (`select` с `r.Context().Done()` и таймером);
   - ограничение на пользователя — не больше 2 одновременных загрузок:
     поле `userUploads map[int64]int` под **отдельным** мьютексом
     `uploadUsersMu sync.Mutex` (не использовать `s.mu`: он держится всё
     время коммита загрузки). Увеличивать счётчик до чтения тела, уменьшать
     в `defer`; удалять ключ, когда счётчик стал 0.
2. При отказе по-прежнему 429 с `Retry-After: 2`.

**Шаги — frontend.** В `run` обернуть загрузку в `retryBusy` (пункт 0.1)
с 5 попытками. Пока идёт ожидание, показывать в карточке состояние
`uploading` с текстом «Сервер занят, повторяем…» (новое поле `note` в
`Upload`, выводится там же, где `error`).

**Тесты.** Backend: третья одновременная загрузка обычного файла проходит;
третья одновременная картинка ждёт, а не получает 429; третья загрузка одного
пользователя получает 429. Frontend: 429 → повтор → `ready`.

---

## P3 — UI/UX и доступность

### 14. Перегруженная шапка канала

**Проблема.** В `WorkspacePage.tsx` в `content-header__actions` до шести
кнопок с подписями («Поиск», «Записи», «Закрепы», «Светлая/Тёмная»,
«Пригласить», участники). Подписи скрываются только в
`@media (max-width: 760px)` (`.header-action span { display: none; }` в
`src/styles/workspace.css`). На 1280 px с открытыми боковыми панелями и
комментариями название канала обрезается примерно до 100 px
([скриншот](screenshots/news-comments.png), 28 октября — перед работой
перепроверить в живом UI).

**Шаги.**
1. Подписи по ширине области контента, а не окна. В `workspace.css`:
   ```css
   .content-shell { container: content / inline-size; }
   @container content (max-width: 860px) { .header-action span { display: none; } .header-action { padding: 0 7px; } }
   ```
   Проверить, что `container` на `.content-shell` не ломает высоту и прокрутку
   (у `inline-size` контейнера нет ограничения по высоте, но проверить
   глазами на desktop и mobile).
2. Когда подпись скрыта, у кнопки должно остаться доступное имя: добавить
   `aria-label` кнопкам «Поиск», «Закрепы», «Пригласить», если его нет
   (`title` есть не у всех).
3. Переключатель темы убрать из шапки и перенести в `ProfileDialog`
   (секция «Оформление» с той же иконкой и `toggleTheme` из `useTheme`).
   Проверить, что e2e-тесты не ищут `.theme-toggle` в шапке
   (`grep -rn "theme-toggle" e2e src`).
4. При открытых комментариях новостей прятать колонку участников в диапазоне
   1181–1439 px:
   ```css
   @media (min-width: 1181px) and (max-width: 1439px) {
     .workspace--members-open:has(.news-comments) { grid-template-columns: var(--channel-sidebar-width, 252px) minmax(390px, 1fr); }
     .workspace--members-open:has(.news-comments) .members-sidebar { display: none; }
   }
   ```
   Сначала убедиться, что `.news-comments` находится внутри `.workspace` и что
   у `.members-sidebar` нет явного `grid-column`, иначе поправить и его.

**Тесты.** Playwright UI (`e2e/ui-fixes.spec.ts`): на 1280×900 с открытыми
комментариями ширина `h1` в шапке не меньше 200 px; на 375×812 все кнопки
шапки имеют accessible name.

---

### 15. Модальные окна: нет ловушки фокуса и стека

**Проблема.** [src/components/Modal.tsx](../src/components/Modal.tsx): каждая
открытая модалка сама вешает `keydown` на `document` и сама добавляет/снимает
класс `body.modal-open`. Если модалки окажутся вложенными (например, лайтбокс
картинки из `MessageAttachments` внутри другой модалки — **сначала проверить,
бывает ли так**), Escape закроет обе, а закрытие внутренней снимет
блокировку прокрутки у внешней. Клавиша Tab выводит фокус из модалки на фон.

**Шаги.**
1. Модульный стек в `Modal.tsx`:
   ```ts
   const stack: symbol[] = []
   ```
   При открытии `const token = Symbol(); stack.push(token)`; при закрытии
   удалить свой `token`. Обработчик Escape закрывает модалку, только если
   `stack.at(-1) === token`, и вызывает `event.stopPropagation()`.
   `body.modal-open` снимать, только когда стек пуст.
2. Ловушка фокуса: в том же `keydown` на `Tab` найти фокусируемые элементы
   внутри `section.modal-card` (`button, [href], input, select, textarea,
   [tabindex]:not([tabindex="-1"])`, без `:disabled`); на последнем
   `Tab` → фокус на первый, на первом `Shift+Tab` → на последний. Только для
   верхней модалки стека.

**Тесты.** `Modal.test.tsx`: две вложенные модалки — Escape закрывает только
верхнюю; после её закрытия у `body` остаётся `modal-open`; Tab с последнего
элемента переходит на первый.

---

### 16. Доступность: анимации, контекстное меню, нативный confirm

**Шаги.**
1. **Уменьшение движения.** В конец `src/styles/global.css`:
   ```css
   @media (prefers-reduced-motion: reduce) {
     *, *::before, *::after { animation-duration: .01ms !important; animation-iteration-count: 1 !important; transition-duration: .01ms !important; scroll-behavior: auto !important; }
   }
   ```
   Сейчас таких правил 3 на 21 анимацию и 35 переходов. Индикаторы загрузки
   (`.spinner`, `.loader-line`) после этого станут статичными — проверить,
   что состояние «загрузка» всё ещё видно (при необходимости оставить
   `.spinner` с медленной анимацией через отдельное правило с бо́льшей
   специфичностью).
2. **Контекстное меню** ([ContextMenu.tsx](../src/components/ContextMenu.tsx)):
   у `role="menu"` нет навигации стрелками. Взять образец из
   `MessageContextMenu.tsx` (обработчик `onKeyDown` на корневом `div`):
   ArrowDown/ArrowUp/Home/End переводят фокус по
   `button[role="menuitem"]:not(:disabled)`, Escape закрывает. При открытии
   фокусировать первый пункт.
3. **Нативный confirm.** `src/components/CommunitySettings.tsx`, удаление роли
   использует `window.confirm(...)`. Заменить на `ConfirmDialog` из
   `WorkspaceDialogs.tsx` (локальное состояние `pendingDelete: CustomRole | null`).
   Текст подтверждения сохранить.

**Тесты.** Тест контекстного меню: ArrowDown переводит фокус на следующий
пункт. Тест CommunitySettings: удаление роли открывает диалог, а не
`window.confirm` (`vi.spyOn(window, 'confirm')` не вызывается).

---

### 17. Лишние перерисовки WorkspacePage

**Проблема.** WorkspacePage — 2 560 строк, 60 `useState`; любое изменение
состояния перерисовывает его целиком.
- `onPresenceUpdated` всегда создаёт новый объект `onlineByServer`, даже если
  пользователь уже онлайн.
- `counterRefreshRef` после ответа `unreadCounts` делает `current.map(...)` по
  всем каналам, даже если счётчики не изменились.

**Шаги.**
1. В `setOnlineByServer` внутри `onPresenceUpdated`: если статус `online` и
   id уже есть (или `offline` и его нет) — вернуть `current` без изменений.
2. В `counterRefreshRef`: внутри `setChannels` сначала проверить, изменился
   ли хоть один `unread_count`; если нет — вернуть `current`. Если да —
   менять только изменившиеся каналы (неизменённые объекты оставить теми же).
3. То же для `setLastSeenByUser`: уже реализовано правильно, не трогать.
4. Разделение WorkspacePage на хуки — отдельная задача из бэклога
   `IMPROVEMENTS.md` (P1.1), в рамках этого пункта не делать.

**Тесты.** Тест с React Profiler или счётчиком рендеров: повторный
`presence.updated` с тем же статусом не вызывает рендер WorkspacePage.

---

### 18. Подсчёт квоты хранилища при каждой загрузке

**Проблема.** `backend:internal/storagebudget/budget.go`, `Get`:
`SELECT category, sum(size_bytes) FROM attachments WHERE deleted_at IS NULL GROUP BY category`
на каждой загрузке под глобальным `storagebudget.Mu`. Существующий индекс
`attachments_storage(category, deleted_at, created_at)` не покрывает
`size_bytes`, поэтому читается таблица.

**Шаги.** Покрывающий индекс `attachments_usage(deleted_at, category, size_bytes)`
добавляется в миграцию 000033 (пункт 6). Код запроса не менять. Проверить
план:
```sql
EXPLAIN QUERY PLAN SELECT category, COALESCE(sum(size_bytes),0) FROM attachments WHERE deleted_at IS NULL GROUP BY category;
```
В плане должно быть `USING COVERING INDEX attachments_usage`.

---

## Порядок работ

| Итерация | Пункты | Репозитории | Миграция |
|---|---|---|---|
| A. Backend-патч | 3, 2, 4, 5 (сервер) | backend | нет |
| B. Надёжность клиента | 0.1, 1, 5 (клиент), 12, 13 | оба | нет |
| C. Производительность | 7, 8, 9, 10, 11, 17 | оба | нет |
| D. UX и размеры картинок | 6, 18, 14, 15, 16 | оба | 000033 |

Зависимости: 1, 12 и 13 требуют 0.1; клиентская часть 13 и 1 работает и со
старым backend; 6 и 18 используют одну миграцию; 4 желательно делать после 3
(оба меняют `main.go`).

## Как измерять эффект

- **Backend:** включить `DIAGNOSTICS_LISTEN_ADDR` и снимать снапшот метрик
  (`db`, `realtime`, `voice`, `stream`, `goroutines`) до и после; для памяти —
  heap-профиль во время загрузок; Go-бенчмарки из пунктов 2, 7, 8 с `-benchmem`.
- **Frontend:** `npm run bench:optimization` и
  `npm run test:e2e:performance`; Performance-панель Chrome на 60-секундном
  голосовом звонке с 5 участниками (доля времени в `getStats`).
- Цифры «до» и «после» записывать в описание коммита и в итоговый
  `docs/audit-2.5.3-status.md`, по образцу `docs/audit-2.5-fixes-status.md`.

## Что не проверено

- Обзор сделан по коду; приложение целиком вживую не запускалось. Оценки
  выигрыша — ожидания, их подтверждают замеры из раздела выше.
- Вложенность модалок (пункт 15) и вид шапки (пункт 14) нужно перепроверить
  в живом UI перед началом работы.
- Безопасность переиспользования RTP-буфера (пункт 7) зависит от поведения
  интерцепторов pion — проверить по исходникам, как описано в шаге 2.
