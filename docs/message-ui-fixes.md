# Messages: attachments, scheduled history and direct-chat recovery

Image cards follow the image width, preserve its aspect ratio and wrap filenames
below the preview. Portraits, landscapes and legacy images without dimensions
stay within the message column on mobile.

Choose **Scheduled** in the attachment menu to replace the current channel,
direct/group conversation or Favorites history with scheduled messages. Send
dates appear below their content, earliest first. Sent/cancelled items disappear
on server events; reconnecting and returning to the app reconcile the list.
The back button restores the ordinary history and preserves the composer draft.

Opening a direct chat accepts both the complete creation response and the older
`{id}` contract: the latter is hydrated before it enters navigation state.

Links accept bare domains as well as HTTP(S). Metadata is requested through the
existing HTTPS-only backend; busy responses are retried. When the remote site
does not provide metadata, a URL card remains available. Server timeouts, access
restrictions and missing metadata cannot guarantee a rich preview for every site.

## Русский

Карточка изображения соответствует ширине фотографии; подпись переносится
снизу, а изображение сохраняет пропорции и помещается на мобильном экране.

«Отложенные» в меню вложений открывает список вместо истории текущего чата.
Время отправки показано под сообщением; отправленные и отменённые записи
исчезают автоматически. Кнопка возврата восстанавливает обычную историю
и сохраняет черновик. Изменение времени/текста и отмена остаются доступны.

Открытие ЛС поддерживает полный ответ создания и старый `{id}`: участники
загружаются до добавления диалога в навигацию, предотвращая падение на `.find`.
Домены без протокола распознаются как ссылки. Для предпросмотра используется
HTTPS, при занятости сервера выполняется повторная попытка. Если метаданные
недоступны, остаётся карточка ссылки без выдуманного описания или картинки.
