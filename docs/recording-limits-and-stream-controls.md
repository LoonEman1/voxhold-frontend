# Recording limits, reply navigation and stream controls

The recordings dialog displays the instance owner's configured storage quota
from the authenticated recording list, including for ordinary members. It
refreshes when the dialog opens and immediately reflects a quota saved in this
tab. The total storage budget and the per-file upload cap remain separate API
values. Older servers without the quota field retain the retention description
without displaying an invented quota.

Reply navigation reuses messages already in the channel cache, including rows
outside the virtual viewport. Repeated clicks share an outstanding context
request. Existing history stays mounted while a distant target loads; only the
latest selected target can replace the window. Clicking the same quote again
recenters it even after manually scrolling away.

Stream audio buttons reveal a horizontal volume slider on hover or keyboard
focus. The publisher adjusts outgoing screen audio through a Web Audio gain
stage; viewers adjust their local player independently. Both controls cover
room tiles, the mini player and expanded/fullscreen playback. Mute, including
moving the slider to zero, preserves the previous positive level for unmute.
The viewer's level and mute state and the publisher's level are stored locally.
The gain stage closes with the stream and never monitors the publisher's own
audio through the speakers.

Full viewer recovery accepts both `stream.left` and an older server's
`stream is not active on this connection` response as a successful leave. A
peer can have disappeared before the leave request arrives. Request errors are
scoped to the original playback attempt so queued ICE errors cannot close the
replacement session. Unrelated access errors still stop recovery.

## Русский

В списке записей показывается лимит хранилища из настроек инстанса, в том числе
обычным участникам. Значение обновляется при открытии списка и после сохранения
настроек в текущей вкладке. Общий объём хранилища и ограничение отдельного файла
передаются разными полями API. Со старым сервером без поля квоты сохраняется
описание срока хранения без выдуманного значения лимита.

Переход по ответу использует уже загруженные сообщения, включая строки вне
видимой области. Повторные клики объединяются в один запрос контекста. История
остаётся на экране при загрузке далёкого сообщения, а устаревший ответ не меняет
последний выбранный переход. Повторный клик снова прокручивает к цитате.

При наведении или фокусе с клавиатуры кнопка звука раскрывает ползунок.
Автор регулирует исходящий звук экрана, зритель — громкость своего плеера.
Управление доступно на плитке, в мини-плеере и развёрнутой трансляции, включая
полный экран. Мьют и перевод ползунка в ноль сохраняют предыдущую громкость
для анмьюта. Уровни сохраняются локально; исходящий микшер освобождается при
завершении трансляции и не воспроизводит собственный звук автора в динамиках.

При полном переподключении зрителя ответ старого сервера «сессия уже закрыта»
считается успешным выходом и запускает повторный просмотр. Запоздалые ошибки
предыдущей попытки не закрывают новое подключение. Ошибки доступа по-прежнему
останавливают восстановление.
