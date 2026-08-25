# План улучшений качества и стабильности — Voxhold-frontend

Архитектурный разбор frontend-репозитория. Факты с путями, приоритеты P0 → P3.

## Что уже хорошо

- Восстановление медиа: конечный автомат `SignallingRecoveryCoordinator`
  (`src/services/mediaRecovery.ts:295-410`) с поколениями и grace-периодами; сериализация
  offer/answer через promise-очереди против glare (`voice.ts:502-534`, `stream.ts:505-551`);
  ICE-restart каскад с ретраями `[2000,5000,10000,20000]` (`webrtcRecovery.ts:20-71`);
  `DecodeWatchdog` по inbound-rtp с каскадом keyframe→restart→rewatch (`mediaRecovery.ts:48-205`).
- WS-клиент: экспоненциальный backoff + jitter, сброс счётчика на `ready`
  (`realtime.ts:446-454`), close 1008 без реконнекта (`realtime.ts:397`).
- Runtime ICE: кэш + ретраи `[500,1500,4000]`, строгий парсер, деградация в host-only
  (`webrtcConfig.ts:65-103`), refetch при переподключении WS (`WorkspacePage.tsx:698-700`).
- Безопасность: CSP/nosniff/X-Frame-Options в `docker/security_headers.conf`; токен не в URL;
  WS-авторизация первым сообщением; nginx-unprivileged; read_only rootfs.
- Качество: TS strict + noUncheckedIndexedAccess, 21 тестовый файл / 78 кейсов (Vitest +
  Testing Library), AppErrorBoundary с диагностикой (`App.tsx:79-96`), SBOM/provenance в CI.
- Ограниченные буферы повсеместно: pending ICE ≤64, diagnostics ≤256, request-id map ≤256.

## P0 — заметные риски

### P0.1. ESLint отсутствует полностью

Факт: ни конфигов eslint/prettier/.editorconfig, ни записей в devDependencies (`package.json`).
Единственный барьер — tsc strict, который не ловит hook-правила.

Предложение: eslint 9 flat config + typescript-eslint (strict) +
`eslint-plugin-react-hooks` (`exhaustive-deps` критичен при ~25 useRef-зеркалах) +
`eslint-plugin-react-refresh`; prettier; прогон в существующем CI-job `test`.

### P0.2. Токен в localStorage

Факт: весь AuthPayload с токеном лежит в localStorage `voxhold.session.v1`
(`platform/transport.ts:26-41`). XSS → полный захват аккаунта на 30 дней TTL.
Митигируется сильным CSP, но остаётся главным сценарием компрометации клиента.

Предложения (по возрастанию сложности):
1. Оставить как есть, но задокументировать угрозу-модель (осознанный трейд-офф SPA).
2. httpOnly Secure SameSite=Strict cookie для токена + CSRF-token двойной отправки для state-
   changing запросов; WS-авторизация уже через первое сообщение — совместимо.

### P0.3. Нет HTTP-ретраев и реактивного повтора после refresh

Факт: ретраев нет нигде кроме webrtc/config (`transport.ts:63-99`); после успешного refresh
упавший запрос не повторяется — пользователь видит ошибку, хотя сессия жива.

Предложение: retry с backoff только для идемпотентных GET (network/5xx, ≤2 попытки);
в `unwrap()` при 401 — один автоматический refresh+replay перед expire().

## P1 — устойчивость и диагностика

### P1.1. Декомпозиция WorkspacePage.tsx

Факт: 2053 строки, ~45 useState + ~25 useRef-зеркал (`WorkspacePage.tsx:59-163`) — главный
источник регрессий и конфликтов merge.

Предложение: постепенное выделение доменных hooks без изменения поведения:
`useVoiceSessionController`, `useStreamController`, `usePresence`, `useReadMarks`,
`useRealtimeConnection`. Каждый выносится отдельным PR с сохранением тестов.

### P1.2. Централизация 401-handling

Факт: проверка `status === 401 → expire()` продублирована в 7 местах
(`WorkspacePage.tsx:246, 359, 1646, 1798, 1810, 1822, 1838`).

Предложение: перенести в единую точку `unwrap()`/transport-обёртку; локальные проверки удалить.
Уменьшает шанс забыть проверку в новом коде.

### P1.3. Version stamping сборки

Факт: версия не вшита в HTML/bundle; `client_version` берётся из package.json
(`clientDiagnostics.ts:1,197`) и не связана с конкретным деплоем. Сопоставлять diagnostic-репорты
с релизом нельзя.

Предложение: инжект git SHA/build-id через Vite `define` + `<meta name="build-id">`;
отображать в UI настроек/ошибки.

### P1.4. Незакрытые подписки/таймеры (мелочи с эффектом накопления)

- Глобальные listeners диагностики ставятся один раз, `dispose()` существует, но не вызывается
  (`clientDiagnostics.ts:123-149, 219-222`).
- Таймеры авто-скрытия тостов не отменяются при unmount (`Toast.tsx:20`).

Предложение: вызывать `dispose()` в App unmount; хранить timer id и очищать в cleanup тоста.
Низкий риск сегодня, но дёшево исправить.

### P1.5. E2E smoke

Факт: e2e тестов нет; компонентные + unit только.

Предложение: Playwright happy-path без медиа: регистрация→сервер→канал→сообщение→logout,
прогон в CI на PR (webServer: vite preview). Медиа-сценарии оставить ручными smoke-тестами.

## P2 — качество разработки

- Sourcemaps: prod без `.map` (`vite.config.ts:23`). Для диагностики клиентских ошибок рассмотреть
  upload приватных sourcemaps в Sentry-совместимое хранилище вместо публичной раздачи.
- Bundle-бюджет: добавить `vite-plugin-bundle-size` или CI-проверку размера dist (регрессии
  чанков ловятся рано).
- i18n: весь UI захардкожен по-русски (`index.html:2`). Если планируется аудитория вне RU —
  вынести строки сейчас дешевле, чем позже; иначе зафиксировать решение «RU-only» в README.
- `invalidate()` у webrtc-config сервиса не вызывается в проде (`webrtcConfig.ts:99-101`) —
  либо вызывать при получении события смены конфигурации от сервера, либо удалить API.

## Чего не делать

- Не вводить Redux/Zustand/React Router без необходимости — текущий Context+useState покрывает
  потребности, декомпозиция решается hooks.
- Не добавлять heavy-зависимости ради мелочей (date-fns/dayjs и т.п.) — bundle для слабых
  устройств важнее.

## Рекомендуемый порядок

```
День 1:   P0.1 (ESLint + prettier + CI)
Неделя 1: P0.3 (retry/replay), P1.2 (централизация 401)
Неделя 2: P1.3 (build-id), P1.4 (cleanup), P1.5 (Playwright smoke)
Позже:    P1.1 (декомпозиция — серией маленьких PR), P0.2 (cookie-решение), P2
```

## Статус реализации (после ревью VOXHOLD_REVIEW.md)

- F-P0.1 (по ревью): ESLint 9 flat config (@eslint/js + typescript-eslint recommended +
  react-hooks/react-refresh), `npm run lint`, шаг в CI; exhaustive-deps = warn,
  lint-job пока continue-on-error до зачистки baseline.
- F-P0.3 (скорректировано ревью): refresh-replay НЕ добавлен (refresh тем же отклонённым
  токеном не восстановит сессию); вместо этого 401 централизован:
  `api.unwrap()` → `notifyUnauthorized()` → AuthProvider expire (authEvents.ts),
  дублирующие проверки удалены из WorkspacePage (7 мест). Retry GET на transient-ошибки —
  следующий шаг.
