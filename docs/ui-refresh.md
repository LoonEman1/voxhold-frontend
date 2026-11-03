# Workspace and personal UI refresh

Prepared for 2.6.3 from `dev` 2.6.2. Frontend and backend versions are synchronized.

The personal navigation occupies a 76 px column on desktop. On screens up to
760 px it becomes a persistent bottom navigation row. Channels, personal pages,
mobile drawers and message composers share the remaining space. Opening news
comments releases the members column while preserving the navigation column.

The rail provides channels, inbox, messages, favorites, server events, audit and
privacy. Favorites use a bookmark, events a calendar, and calls a phone icon.
Unread counters and active states have distinct, theme-aware colors. The rail
shows at most 12 recent conversations; Messages opens the complete searchable
list. This bounds mounted avatars without discarding conversations.

Personal calls and expanded channel streams use draggable, resizable windows.
They show participants and screen sharing, preserve the media session during
movement/resizing/collapse, and remember their geometry. Arrow keys move/resize,
Shift moves faster and Home resets geometry. Windows stay within the viewport
and outside personal navigation. Mobile drawers remain above them. Explicit
fullscreen cinema mode is still available. Publishing a channel stream opens
its window automatically. Call and capture runtimes remain lazy-loaded.

Profile settings have Profile, Appearance and Security tabs. Unsaved profile edits
survive tab changes. Security includes password visibility, confirmation and
UTF-8 length checks, session cards, retryable loading and serialized mutations.
Account removal still requires the exact username and password.

Panel dragging updates once per animation frame and debounces preference writes.
Invalid or inaccessible browser storage falls back to usable defaults. Drag
listeners are removed on completion, cancellation, blur and unmount. Arrow keys
resize a panel, Home restores its default and End selects its available maximum.

Direct-message notification changes and sends reject duplicate concurrent
submissions. Older notification responses cannot overwrite a newer toggle.
Favorites search waits 200 ms after typing, and already-saved messages do not
offer another Save to favorites action. Blocking is available in the explicit
message menu rather than as a button alongside every message.

Incoming stream audio and outgoing screen audio support 0–200%. Playback above
100% uses a lazily created Web Audio gain graph; the video element stays within
its legal 0–1 volume range. Moving the slider does not renegotiate media or stop
capture tracks. Mute preserves the chosen level. A separate popup keeps the
percentage and slider readable in both themes and narrow players.

Search pagination cancels obsolete requests; clearing a search ends loading.
Older direct history survives a concurrent background refresh. Async dialog
completions cannot close a newly opened dialog. Cleanup filters are locked during
preview and recalculation discards the previous deletion plan. Ban lists ignore
stale server responses; unpin failures retain the list for retry.

Keyboard users can move between profile tabs with arrows, Home and End. The
country picker supports arrow navigation and closes on Escape while retaining
the profile dialog. Animations respect reduced motion. No dependencies were added.

## Validation

Run `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`,
`npm run test:e2e:ui` and `npm run test:e2e:performance`.
`VOXHOLD_UI_PORT` and `VOXHOLD_PERFORMANCE_PORT` optionally select unused test
ports, retaining defaults 4190 and 4189. Layout coverage includes 320, 390, 600,
760, 761, 1000, 1181, 1280 and 1440 px and both themes.

## Русский

Патч 2.6.3 подготовлен от `dev` 2.6.2; версии frontend и backend синхронизированы.
Личная панель стала постоянной колонкой шириной 76 пикселей. На телефонах она
занимает отдельную нижнюю строку. Навигация, комментарии новостей, мобильные меню
и поле ввода учитывают доступное место и не перекрывают друг друга.

Перерисованы иконки навигации и действий в личных сообщениях: закладка для
избранного, календарь для событий, трубка для звонка, состояния уведомлений и
управления звуком. На панели показаны 12 последних разговоров; весь список
доступен через «Сообщения». Это уменьшает число одновременно загруженных аватаров.

Личный звонок и развёрнутая трансляция канала открываются отдельными окнами.
Видны участники и показ экрана, включая предпросмотр собственного экрана. Окна
перетаскиваются, меняют размер, сворачиваются и запоминают положение. Стрелки
перемещают или меняют размер, Shift ускоряет действие, Home сбрасывает геометрию.
Окно учитывает размер экрана и постоянную навигацию; мобильное меню открывается
выше окна. Перемещение и изменение размера сохраняют медиасессию. Полноэкранный
режим доступен отдельной кнопкой. Запуск трансляции канала сразу открывает окно.

В профиле появились вкладки «Профиль», «Оформление», «Безопасность». Несохранённое
описание не теряется при переключении. Сессии отображаются карточками с отдельными
датами, адресом, меткой текущего устройства и понятными действиями. Есть повторная
загрузка, показ пароля, проверка подтверждения и ограничения UTF-8. Удаление
аккаунта по-прежнему требует точного имени пользователя и пароля.

Исправлены повреждённые настройки раскладки, ошибки доступа к localStorage,
лишние записи при перетаскивании, повторная отправка и конкурирующие переключения
уведомлений. Поиск в избранном объединяет быстрый ввод в один запрос. Блокировка
собеседника перенесена в явное меню сообщения. Escape сначала закрывает список
стран, сохраняя открытым профиль. Анимации учитывают уменьшение движения.

Громкость принимаемой трансляции и исходящего звука экрана регулируется до 200%.
Усиление свыше 100% использует Web Audio; значение громкости самого video остаётся
в диапазоне 0–1. Аудиограф просмотра создаётся только при необходимости усиления.
Выключение звука сохраняет выбранный уровень; ползунок и процент вынесены в
отдельное компактное окно, учитывающее доступную ширину.

Исправлены устаревшие ответы поиска, зависание его загрузки, потеря старой
истории при фоновом обновлении и завершение старого запроса в заново открытом
диалоге. Пересчёт очистки удаляет старый план, а фильтры блокируются до ответа.
Устаревший список блокировок не заменяет текущий; ошибка открепления оставляет
доступной повторную попытку.

Проверки и команды приведены выше. Новые зависимости не добавлялись.

## Custom video bitrate / Ручной битрейт видео

Video bitrate is entered directly in Mbit/s with a 0.1 step, from 0.5 to 16.
Values above 16 are immediately capped; finer values round to one decimal.
Clearing the field while editing keeps the last valid setting until commit.
Presets still populate the field, and custom values survive closing/reloading.
The media service continues to receive integer Kbit/s; no protocol change.

Видеобитрейт вводится вручную в Мбит/с с шагом 0,1 и пределами 0,5–16.
Число выше 16 сразу заменяется на 16; лишние знаки округляются до десятых.
При очистке поля во время ввода сохраняется последний корректный параметр.
Пресеты подставляют своё значение, а ручное значение сохраняется между входами.
В WebRTC передаётся целое количество Кбит/с; протокол не меняется.
