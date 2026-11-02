# Workspace and personal UI refresh

Based on `dev` 2.6.2. This is a development change, not a new release number.

The personal navigation occupies a 76 px column on desktop. On screens up to
760 px it becomes a persistent bottom navigation row. Channels, personal pages,
mobile drawers and message composers share the remaining space. Opening news
comments releases the members column while preserving the navigation column.

The rail provides channels, inbox, messages, favorites, server events, audit and
privacy. Favorites use a bookmark, events a calendar, and calls a phone icon.
Unread counters and active states have distinct, theme-aware colors. The rail
shows at most 12 recent conversations; Messages opens the complete searchable
list. This bounds mounted avatars without discarding conversations.

Personal calls occupy a separate layout row and can be collapsed. Microphone,
sound, sharing and hangup remain accessible while collapsed. Changing the layout
does not unmount the media component. The call never covers the message composer.
Call and screen capture runtimes remain lazy-loaded.

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

Изменения подготовлены от `dev` 2.6.2 без изменения номера опубликованного релиза.
Личная панель стала постоянной колонкой шириной 76 пикселей. На телефонах она
занимает отдельную нижнюю строку. Навигация, комментарии новостей, мобильные меню
и поле ввода учитывают доступное место и не перекрывают друг друга.

Перерисованы иконки навигации и действий в личных сообщениях: закладка для
избранного, календарь для событий, трубка для звонка, состояния уведомлений и
управления звуком. На панели показаны 12 последних разговоров; весь список
доступен через «Сообщения». Это уменьшает число одновременно загруженных аватаров.

Панель личного звонка занимает место в раскладке и сворачивается, сохраняя
управление микрофоном, звуком, экраном и завершением разговора. Медиакомпонент
продолжает работать при изменении раскладки, поле ввода остаётся доступным.

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

Проверки и команды приведены выше. Новые зависимости не добавлялись.
