# Проверка патча 2.5.3

31 октября 2026 года. Реализован план `improvement-plan-2.6.md`; номер выпуска
по уточнению владельца — **2.5.3**. Новых зависимостей нет. Миграция одна — **000033**.

| Пункт | Результат | Проверка |
|---|---|---|
| 0.1 | Retry-After в Fetch/XHR/ApiError, отменяемый retryBusy | seconds/date/clamp, abort, лимиты попыток |
| 1 | Дисковый кэш превью, ожидание слота; scoped LRU Blob URL с refs | ACL на тёплом кэше, удаление, ожидание, remount и 429 |
| 2 | io.ReadSeeker вместо ReadAll, бюджет декодирования, cgroup GOMEMLIMIT | Все модели/overflow, отказ до Decode, benchmem, heap/RSS и OOM-контроль |
| 3 | Cleanup читает кандидатов пакетами 500, блокирует только кандидатов | 5000 прикреплённых + 3 брошенных файла, гонка с отправкой, отдельные deadlines |
| 4 | Очередь 1024, read-only получатели, writer только для сохранения; повторная ACL | drain/full/порядок, writer contention, revoked/duplicate/phantom |
| 5 | App ping/pong, WS auth переносит 2 временных сбоя; быстрый reconnect | реальные WS и fake timers, revoked/timeout/старый backend/error pong |
| 6 | Размеры после компрессии/при копировании/в каналах и ЛС; стабильное место превью | реальные миграции, upload/retry/copy/NULL JSON, CSS и scroll delta ≤4px |
| 7 | Переиспользование RTP buffer/packet | исходники Pion copy packet factory, реальная NACK retransmission, bench/race |
| 8 | clientsByServer и дедупликация last_seen по времени/статусу | membership/disconnect race, пять серверов — одна запись перехода, bench |
| 9 | fast 2xx debug; slow/5xx warn; история диагностики 2000 | transport levels, реальные фильтры diagnostics, quota/batch tests |
| 10 | Голосовые уровни остановлены hidden; video stats кэш 1900ms | visibility/disposal tests, реальные WebRTC browser tests |
| 11 | BroadcastChannel с startup handshake, TTL и независимыми читателями | две вкладки, release, abrupt close/TTL, storage fallback, закрытие канала |
| 12 | Единый timeout логического запроса и ограниченные GET/HEAD retries | abort/backoff/body/timeout; записи не повторяются |
| 13 | 8 I/O слотов, до 2 image слотов, max 2 загрузки/пользователя; busy note/retry | три аккаунта, третий same-user, image wait/cancel, клиент busy→ready |
| 14 | Container query шапки; тема в профиле; участники скрыты с comments на 1280 | просмотр desktop/mobile screenshots, h1 ≥200px, accessible names/overflow |
| 15 | Стек модалок, top-only Escape, Tab/Shift+Tab и возврат фокуса | initially nested и последовательное открытие, реальный browser focus/role confirm |
| 16 | Клавиши меню, диалог удаления роли, видимый reduced-motion loader | Arrow/Home/End, родной slider Home/End, ошибки/повтор, отсутствие window.confirm |
| 17 | Пропуск одинаковых presence/unread, прежние ссылки неизменённых каналов | React Profiler: нет commit на повторы; online→offline в одном batch |
| 18 | attachments_usage(deleted_at,category,size_bytes) | EXPLAIN: USING COVERING INDEX; down/up и CHECK dimensions |

## Повторное ревью и уточнения к плану

- По разрешению владельца исправлены старые фикстуры уведомлений: сообщения
  создаются в БД, все исходные проверки доставки сохранены.
- Проверены исходники Pion: NACK сохраняет копии заголовка/payload; дополнительный
  тест воспроизводит retransmission после перезаписи общего входного буфера.
- Превью публикуется через уникальный временный файл и повторную проверку ACL
  под тем же mutex, что физическое удаление оригинала.
- Проверены отмена, shutdown/drain, освобождение слотов, refs/URL и таймеров,
  порядок locks и отсутствие повторной индексации отключённого клиента.
- В текущем UI бан/удаление аккаунта подтверждались внутри того же окна;
  подтверждение удаления роли теперь создаёт реальную вложенную модалку.
- Универсальное prefers-reduced-motion уже присутствовало: правило сохранено,
  добавлена статичная видимая полоса загрузки и браузерная проверка.
- CatmullRom сохранён: более быстрый BiLinear не принят без доказательства
  равнозначного качества фотографий. Эксперимент RTP audio-level не понадобился.
- Сборка сохранила лимит 300000 байт: обработка микрофона загружается при входе
  в звонок; изменение состояния во время загрузки не создаёт устаревший input.
- Дополнительно воспроизведён OOM: два фото 6000×4000, hard limit 768MiB,
  legacy ReadAll/default GC: Docker OOMKilled=true, exit 137. Новый soft limit
  без снижения параллелизма вызывал 544 GC; поэтому при Go memory limit <1GiB
  тяжёлые картинки обрабатываются последовательно, сохраняя отдельные I/O слоты.

## Измеренный эффект

Это результаты отдельных сценариев, а не общий процент ускорения всего приложения.
Микробенчмарки RTP измеряют decode+forward без сети. Hardware: Ryzen 7 9800X3D;
Go 1.27.3. Объём памяти на операцию (B/op) отличается от пикового RSS процесса.

| Сценарий | До | После | Изменение |
|---|---:|---:|---:|
| Voice RTP decode/forward | 299.5 ns; 1681 B/op; 2 alloc | 30.46 ns; 0 B/op; 0 alloc | время −89.8%; аллокации байт −100% |
| Stream RTP decode/forward | 302.1 ns; 1776 B/op; 3 alloc | 39.77 ns; 96 B/op; 1 alloc | время −86.8%; байт −94.6% |
| Presence, 5000 клиентов / 50 серверов / 100 адресатов | 122301 ns; 84328 B/op | 5834 ns; 3304 B/op | время −95.2%; байт −96.1% |
| Компрессия JPEG 24 Мп, исходник ~14.6 MB | 437812112 B/op | 403761424 B/op | выделено за операцию −7.8% |
| Два фото 24 Мп, peak RSS изолированного процесса | ~781 MiB (контроль с 1.5GiB) | ~611 MiB (лимит 768MiB, последовательная обработка) | ориентир −21.8%; приоритет — избежать OOM |
| Голосовые getStats hidden | до 5 чтений/сек | 0 от индикаторов | −100% для этого фонового опроса |
| Два video stats sampler/2сек | обычно 2 отчёта | общий свежий отчёт | до −50% вызовов в совпадающем окне кэша |
| Heartbeat чтения в активной вкладке | localStorage каждые 2сек | BroadcastChannel | −100% heartbeat-записей при поддержке BC |
| Сохранение last_seen при 5 членствах | до 5 одинаковых записей | 1 на переход | −80% в этом сценарии |

Пик фото измерялся сэмплером MemStats/RSS каждые 2ms; heap-профили сохранены
локально вместе с логами. Размер/лимит контейнера и сериализация являются частью
изменения; это не обещание снижения RAM на 21.8% в любом режиме. Сериализация
тяжёлых фото увеличивает время обработки их пачки ради запаса памяти.
В простое до обновления Selectel: backend 16.68MiB, frontend 3.555MiB;
нагрузка реальных пользователей не воспроизводилась одинаково до/после.
Честный единый процент CPU/RAM для приложения целиком по этим данным не определяется.

## Проверки

- Frontend: strict lint, TypeScript, **395** unit/component tests, production build;
  WorkspacePage **296215 bytes**, бюджет 300000 сохранён.
- Playwright UI: **54** успешно; client performance/reliability и optimization benchmark — успешно.
- Backend: go test/vet всех пакетов; Linux race + goroutine leak detection — успешно.
- Linux production govulncheck: **0 достижимых** уязвимостей, 0 в импортируемых
  пакетах; 1 в требуемом модуле без вызова уязвимого кода.
- EXPLAIN и обратимость миграции 33, права тёплого thumbnail cache, реальный NACK,
  потеря WS/pong/auth failures, abort/retries, nested focus и delayed images.

## Обновление

Бэкап БД и файлов → миграция 33 → backend 2.5.3 → frontend 2.5.3 → health/public
проверки. Старые поля JSON необязательны; новые ping/pong работают со старым
backend через matching error. Кэширование не отменяет проверки доступа.
Старые Docker-образы удаляются только после проверки работающего обновления;
образы запущенных/остановленных контейнеров и комплект отката сохраняются.
