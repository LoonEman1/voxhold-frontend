# Аудит 2.5: исправления и повторное ревью

Проверено 30 октября 2026 года. Все 18 основных пунктов, два небольших
замечания про MIME/поиск и пять воспроизведённых ошибок backend исправлены.
Ветки во всех трёх репозиториях: `codex/audit-2-5-fixes`.

## Матрица исправлений

| № | Что изменилось | Проверка |
|---|---|---|
| 1 | Истечение ждёт refresh/межвкладочный lock, старые сокеты игнорируются; замена соединения восстанавливает голос без повторного запуска recovery; личный звонок сохраняется при смене токена | AuthContext/realtime/conversationCall tests; E2E ротации между вкладками и выхода из Workspace |
| 2 | Активные Blob MIME становятся octet-stream; изображения используют allowlist; SVG-черновики не создают активный URL; backend ограничивает inline MIME | safeBlob, MessageAttachments, Community tests и серверные проверки заголовков |
| 3 | CSP разрешает текущий origin и явный runtime allowlist; шаблон .inc; HSTS на обоих TLS edge | Production nginx smoke на /, /assets, /api с двумя вариантами CSP; Caddy config tests |
| 4 | Debug фильтруется до санитизации, WS-трафик агрегируется; keepalive ≤60 КиБ; старые события повторно санитизируются | clientDiagnostics tests, включая один большой сохранённый event |
| 5 | Presence отделён от members, directory/map зависят от user_id/username/role; строки не получают сырой roster | Unit parse spy и браузерные счётчики: 200 обновлений / 100 сообщений, 0 новых рендеров строк и parseMentions |
| 6 | Видимые картинки запрашивают ограниченные превью, очередь ≤2, оригинал по действию; удаление адресное, старые события проверяются HEAD | MessageAttachments/attachmentRequests/transport tests; backend ACL, thumbnail и HEAD tests |
| 7 | Убран периодический polling; ready/focus/visibility и события; inbox из payload; privacy/roles не зависят от view; списки проходят курсоры | Community и communityPages tests, full UI и backend >200 records |
| 8 | Кэш аватаров привязан к API/аккаунту, токен читается через ref; версии сливаются, только null удаляет | AvatarProvider tests, включая ротацию и смену версий |
| 9 | Медиа, запись, player и закрытые диалоги загружаются динамически; React vendor отдельно; visualizer и бюджет сборки | Manifest traversal, npm build, Docker build, media/recording E2E |
| 10 | Меню и подтверждение явно говорят об instance-wide бане | UI ban confirmation test |
| 11 | Единый выбор text/news перед voice; удаление сбрасывает target/focus | channels helper tests и UI |
| 12 | InviteRoute завершает принятие через router state; Workspace сохраняет обычную позицию; слушается hashchange | App.test.tsx: одна установка Workspace после invite и ротации |
| 13 | Общий download helper освобождает URL спустя 60 секунд | downloadBlob и recordingStore tests |
| 14 | Нативное меню работает в полях, ссылках, выделении и при Shift | contextMenu/ChatPanel tests и UI |
| 15 | Шкала 11/12/13/14, мобильные поля ≥16px, контраст muted ≥4.5; исправлены светлые labels/placeholders | UI dark/light/mobile, проверка overflow и screenshot |
| 16 | Внешний theme-init.js синхронно работает до React; color-scheme, theme-color; storage защищён try/catch | ThemeContext test с заблокированным storage; production image smoke |
| 17 | HTTP(S)-ссылки с noopener/noreferrer/nofollow; код не затрагивается; пунктуация обрезается, длинный текст сокращается | MessageMentions tests: javascript/data, code, скобки, mention offsets и длинный href |
| 18 | Удаление аккаунта в профиле с точным вводом username; у владельца действия нет; VoiceDock имеет labels/pressed/off icons | Profile/server settings tests; UI username confirmation и VoiceDock toggles |

## Повторное ревью

После первого общего прогона устранён конфликт ключей поиска с чатом;
дополнительно разделены ключи меню сообщения и композера. Проверка поиска
теперь отслеживает ошибки консоли. Fixtures поддерживают query курсоров и
возвращают независимые снимки, как настоящий HTTP JSON.

При проверке Blob URL дополнительно закрыт SVG в черновике. Для диагностики
проверен одиночный event из старого storage, а не только новые пакетные записи.
Для показа экрана выделен небольшой screenCapture: getDisplayMedia вызывается
в обработчике клика до загрузки тяжёлых модулей и ICE-конфигурации; ошибка HDR
освобождает capture. Тесты проверяют синхронный вызов picker и освобождение tracks.

В сквозном тесте вкладка B удерживает refresh lock, старый WebSocket A закрывается
до ответа refresh. A остаётся в Workspace, принимает новый токен и ровно один раз
переподключает голос. Выход затем размонтирует Workspace без нового recovery.
Тест использует маршрутизируемый WebSocket; реальная передача медиадорожек
и восстановление encoder проверяются отдельными media E2E.

Оба небольших замечания также исправлены: uploadAvatar/uploadPreview имеют
fallback Content-Type, ключ поиска зависит только от сервера и имеет свой префикс.
После очистки baseline react-hooks/exhaustive-deps повышен до error.

## Финальные проверки

- npm run lint — успешно, 0 предупреждений; npm run typecheck — успешно.
- npm test — 82 файла, **340 тестов**, все прошли.
- Playwright UI — **48/48**; performance/reliability/media — **16/16**.
- npm run build и Docker production build — успешно. WorkspacePage:
  **296 808 байт** вместо 503 890 до исправлений, ниже бюджета 300 000.
  Manifest проверяет отсутствие статических зависимостей от тяжёлых media chunks.
- docker build --target test — успешно, те же 340 тестов.
- Production nginx: 6/64 МиБ принимаются, 65 МиБ отклоняются; CSP на трёх
  типах путей, тема в образе и отдельный API allowlist — успешно.
- Backend: go test/vet, Linux race, govulncheck production packages — успешно.
  Подробности: Voxhold-backend/docs/audit-2.5-fixes.md.

## Порядок обновления и границы

Сначала резервная копия и **миграция backend 000032**, затем backend,
frontend и TLS edge. Для отдельного API origin задаётся CSP_CONNECT_EXTRA
в окружении frontend и VITE_API_BASE_URL при сборке.
Production не обновлялся, изменения не опубликованы.

Пункты документа с формулировками «потом» и «отдельная серия PR» остаются
архитектурным backlog: отдельный kick endpoint, миграция localStorage-сессий
на HttpOnly+CSRF, крупное разделение Workspace на hooks и форматирование
Community без изменения поведения. Они не отмечены как выполненные исправления.
