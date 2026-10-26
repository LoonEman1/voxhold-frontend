# Invitation management

The top **Пригласить** menu now contains **Новая ссылка** and **Активные ссылки**.
The active list is available to the current server owner and administrators.
It includes links from all creators, their IDs, authors, expiration dates,
use counts/limits and registration settings. Expired, revoked and exhausted
links are excluded by the backend. Refresh the list to retrieve current state;
larger lists support cursor pagination.

**Закрыть ссылку** asks for inline confirmation. Success removes the link from
the list and invalidates its generated-address panel when it is the same link.
A failed request leaves the entry visible and can be retried. Reopening the
dialog retrieves the current list. Closing or switching the server cancels
in-flight list requests.

The full address is available when a link is created; the management list shows
metadata, not recoverable historical tokens. Deploy the matching backend API
before this frontend. This feature requires no additional migration.

## Русский

В верхнем меню **Пригласить** появились разделы **Новая ссылка** и
**Активные ссылки**. Во втором владелец и администраторы видят ссылки всех
создателей: номер, автора, срок, число использований и лимит. Кнопка
**Обновить** загружает актуальное состояние, **Показать ещё** — следующую
страницу. Истёкшие, закрытые и исчерпанные ссылки исключаются сервером.

Для досрочного отзыва нажмите **Закрыть ссылку**, затем **Да, закрыть**.
Ссылка исчезнет после успешного ответа сервера. При ошибке она остаётся в
списке, чтобы можно было повторить запрос. Действующие участники сохраняют
доступ, новые вступления и регистрации по закрытой ссылке блокируются.

Полный адрес доступен при создании. Список управления показывает номер и
метаданные. Сначала обновляется backend; новой миграции для этой функции нет.
