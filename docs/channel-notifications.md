# Text channel notifications / Уведомления текстовых каналов

Right-click a text channel and select **Уведомления**. Account-scoped settings
support all messages, user/role mentions (default), or none. Preferences persist
on the backend and sync to other connected tabs/devices. Backend migration 000023
must be installed before this frontend.

The `@` picker searches server members and built-in roles. Selected identities
stay stable while names remain readable in composition, editing, messages,
outbox, search and pins. Plain @username requires exact case; use the picker for
names with spaces or case-insensitive lookup. Personal and matching role mentions
have an amber row accent and styled mention chips.

Alerts arrive from other channels/servers over an active connection. They ignore
the sender, edits, history loads, send retries and inaccessible channels. Clicking
an alert rechecks access and jumps to its message. A focused, actively read
channel stays quiet. Scrolling away, a covering dialog or focused stream viewing
ends reading suppression immediately; a stale heartbeat from the same tab does
not override its current state. Failed sends preserve selected mention IDs when
restoring the draft. Four toasts and 256 recent message claims bound memory;
sound is limited to one soft two-note cue per 3 seconds. Web Locks and local
storage suppress duplicates across tabs; private browsing/storage failure keeps
a best-effort memory fallback. Queued alerts and existing toasts are cancelled on
revocation/muting. Fullscreen viewing keeps in-app alerts in the fullscreen host.

Системные уведомления включаются отдельно кнопкой «Разрешить». Они показываются,
когда окно не активно, и требуют открытого Voxhold. Офлайн push и доставка при
закрытом браузере в эту версию не входят. Звук использует общие настройки звуков
интерфейса, громкости и устройства вывода; в меню есть предпрослушивание.

Validation includes backend access/preference/delivery/replay/queue tests,
frontend parser/editor/settings/delivery tests and real Chromium scenarios for
dark/light/mobile layouts, message jumps, explicit browser permission and two-tab
deduplication. No notification content is stored in local storage.
