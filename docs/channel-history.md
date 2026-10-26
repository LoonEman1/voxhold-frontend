# Cached history and media rendering

Deploy the backend with migrations **000020/000021** before this frontend.
The authenticated WS client opts into `channel.sync_required` and the HTTP
client uses `/messages/sync`; an older backend does not provide that endpoint.

The cache belongs to one API instance and authenticated user. It keeps eight
recent channel histories with at most 1,000 messages per history. Evicted
pages remain available through normal pagination. If the reader is away from
the bottom when the window fills, new messages do not evict the reading position;
the window gains a newer-page indicator. The cached anchor is a message ID and
offset, so returning to a channel can restore it while refreshing in the background.

Up to 20 outgoing messages across the session retain their UUIDs, status, and
retry actions. Outbox entries survive history LRU eviction without retaining
the evicted message pages. They are held in memory, not persisted across page
reloads. Log out or loss of server access removes the corresponding private
cache; in-flight requests cannot populate another user's or channel's cache.

Initial and expired-cursor sync responses are authoritative snapshots. Delta
pages restore edits and deletion tombstones. Revision checks, request generations,
and live-event replay protect against delayed HTTP responses. Each retry keeps
the original UUID; a WS acknowledgement can complete a send whose HTTP reply
was lost. Missing or failed replies are shown beside the pending message.

High-frequency stream quality and speaking indicators use external stores with
subscriptions at the consuming components. These changes do not rerender the
workspace or chat. Member lists above 100 rows use one virtualized scroll
viewport. Recording, microphone, and stream settings dialogs load on demand.

Regression coverage includes actual Chromium workspace navigation, cached
scroll positions, 2,500 members, dropped change events and lost send replies.
It uses a simulated API/WS fixture. The existing real media tests remain separate;
these changes do not constitute a production network throughput measurement.

## Русский

Сначала обновите backend с миграциями **000020/000021**. История хранится в
памяти отдельно для каждого пользователя: восемь последних каналов, до 1 000
сообщений в окне. Старые страницы можно повторно загрузить. Возврат в канал
показывает кеш сразу и восстанавливает позицию по ID сообщения и смещению.

До 20 отправок сохраняют UUID для повтора без дублей. Неотправленные сообщения
переживают вытеснение истории канала, но пока не сохраняются после перезагрузки
страницы. Выход или потеря доступа очищают соответствующий кеш.

После обрыва загружаются пропущенные правки и удаления. При истёкшем курсоре
применяется новый снимок. Задержанный ответ истории не отменяет более новую
правку и не восстанавливает известное удалённое сообщение.

Статистика стрима и говорящие участники обновляют только своих потребителей,
без перерисовки всего workspace. Большие списки участников виртуализированы;
диалоги записей, микрофона и трансляции загружаются при открытии.
