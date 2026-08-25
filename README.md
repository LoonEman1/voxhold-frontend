# Voxhold Frontend

Production-ready React-клиент для `Voxhold-backend`: авторизация, серверы, каналы, участники, профиль, приглашения, история сообщений, редактирование/удаление/закрепление, полнотекстовый поиск, realtime-синхронизация и голосовые комнаты WebRTC/Opus.

Поиск выполняется по всем текстовым каналам выбранного сервера. Нажатие на результат или закреп загружает контекст сообщения, переключает канал и подсвечивает найденное сообщение.

Непрочитанные текстовые каналы выделяются жирным шрифтом и индикатором. Клиент
сравнивает `last_message_id` из списка каналов с собственным
`last_read_message_id`, не загружая историю каждого канала отдельным запросом.

## Быстрый запуск

Если backend уже работает на `localhost:8080`:

```bash
cp .env.example .env
docker compose up --build -d
```

Сайт откроется на [http://localhost:3000](http://localhost:3000). Nginx внутри контейнера отдаёт SPA и проксирует `/api`/WebSocket в backend, поэтому CORS не требуется.

Если frontend и backend опубликованы на разных origin, владелец инстанса может
добавить адрес сайта в «Настройки сервера → Доступ внешних клиентов». Список
загружается и применяется backend в рантайме; перезапуск контейнеров не нужен.

Чтобы поднять frontend, backend и миграции одной командой (репозитории должны лежать рядом):

```bash
docker compose -f compose.fullstack.yaml up --build -d
```

Остановить стек:

```bash
docker compose -f compose.fullstack.yaml down
```

Данные SQLite находятся в Docker volume `voxhold_data`; `down` их не удаляет.

## Приглашения

Созданное приглашение ведёт на веб-страницу текущего инстанса: `https://chat.example.com/#/invite/TOKEN`. Страница проверяет токен и предлагает открыть нативный Voxhold либо остаться на сайте для входа или регистрации. Прямой `voxhold://` используется только после нажатия «Открыть приложение»; если desktop-клиент не установлен, пользователь может продолжить в браузере.

Для корректных публичных ссылок frontend и `/api` рекомендуется публиковать на одном origin через входящий в проект Nginx. Отдельный адрес веб-клиента в настройках пользователя не нужен.

Для голоса fullstack-compose публикует один UDP-порт `50000`. При локальном запуске Docker Desktop и браузера на той же машине используйте `WEBRTC_PUBLIC_IP=127.0.0.1`. Для клиентов из локальной сети укажите LAN IPv4 Windows-хоста и разрешите выбранный UDP-порт в firewall. При развёртывании на VPS укажите публичный IP сервера и также откройте UDP-порт. Доступ к микрофону вне `localhost` браузеры дают только по HTTPS.

## Локальная разработка

Нужен Node.js 22+ и запущенный backend:

```bash
npm ci
cp .env.example .env
npm run dev
```

Команды проверки:

```bash
npm run typecheck
npm test
npm run build
```

## Конфигурация

| Переменная | По умолчанию | Назначение |
|---|---:|---|
| `VITE_API_BASE_URL` | пусто | Публичный origin API. Пустое значение включает same-origin `/api` и рекомендуется для Docker. |
| `VITE_DEV_API_PROXY` | `http://localhost:8080` | Backend для Vite dev-server. |
| `BACKEND_UPSTREAM` | `host.docker.internal:8080` | Адрес backend из контейнера Nginx. |
| `FRONTEND_PORT` | `3000` | Порт сайта на хосте. |
| `WEBRTC_PUBLIC_IP` | `127.0.0.1` | IP, который backend публикует в ICE-кандидате. На VPS укажите публичный IP. |
| `WEBRTC_UDP_PORT` | `50000` | Единый UDP-порт медиатрафика WebRTC. |
| `WEBRTC_MAX_PARTICIPANTS` | `32` | Максимум одновременных соединений в голосовой комнате. |
| `WEBRTC_MAX_AUDIO_BITRATE_KBPS` | `128` | Серверный максимум входящего Opus-битрейта одного микрофона. |
| `WEBRTC_ICE_SERVERS` | пусто | Опциональные STUN/TURN URL через запятую для backend. Браузер получает их в рантайме через `GET /api/v1/webrtc/config`; пересборка frontend при смене TURN не нужна. |

## Подготовка к Wails

UI и доменные типы не зависят от браузерного HTTP напрямую. Точка интеграции — интерфейс `Transport` в `src/platform/transport.ts`. Для Wails реализуйте `Transport.request` через сгенерированные Wails bindings и передайте его в `createApi`. Текущая реализация `createFetchTransport` останется для сайта. Хранилище сессии также вынесено в `SessionStorageAdapter` и может быть заменено на native secure storage.

WebSocket-клиент находится отдельно в `src/services/realtime.ts`. Когда нативный backend будет встроен в процесс Wails, ему можно передать локальный WebSocket URL или заменить этот сервис без изменений UI.

## Восстановление после обрыва

Короткая потеря WebSocket (до 60 секунд) не выбрасывает пользователя из голоса и трансляции: peer-соединения закрываются, но захваченный микрофон (`BrowserVoiceInput`) и экран остаются жить; после переподключения сессия автоматически пересоздаётся на новом connection id без повторного запроса разрешений. Если микрофон пропал (устройство отключено), выполняется попытка перезахвата выбранного устройства, затем устройства по умолчанию; при неудаче отправка отключается, приём чужого звука продолжается и появляется кнопка «Повторить». Блокировка автовоспроизведения не выглядит как чёрный экран: видео показывается без звука с явной кнопкой «Включить звук».

## Production

- multi-stage образ: Node используется только на этапе сборки;
- runtime работает на unprivileged Nginx, с read-only root filesystem и без Linux capabilities;
- immutable cache для hashed assets и `no-cache` для HTML;
- CSP и базовые security headers;
- `/healthz` для оркестратора;
- same-origin reverse proxy с поддержкой WebSocket;
- экспоненциальное переподключение realtime и автоматическое обновление сессии.

Перед публичным развёртыванием поставьте TLS-терминатор (Caddy, Traefik, Cloudflare или ingress) перед контейнером и не публикуйте backend-порт наружу.
# Screen sharing

Screen sharing is available inside an active voice channel. It supports
server-forwarded and P2P modes, 720p/1080p/1440p, 30/60 FPS, video rates up to
12 Mbit/s, and separate system-audio rates up to 320 Kbit/s. Server mode also
requires UDP `${WEBRTC_STREAM_UDP_PORT:-50001}` to be reachable.
