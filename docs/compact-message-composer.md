# Compact message composer / Компактный редактор сообщений

Channels, discussions, personal/group conversations and Favorites keep their
actions inside the composer. The paperclip opens a vertical menu with file upload,
poll creation, scheduling and the current chat's scheduled messages. Each action
has its own icon and description. Empty upload/tool rows no longer reserve space;
the attachment tray appears only while files are staged. Upload limits, retries,
paste/drop, draft retention and attachment preparation/commit remain unchanged.

A normal send click or Enter sends immediately. Holding the primary pointer on
Send for 450 ms opens scheduling and suppresses the subsequent click, so releasing
the pointer cannot send the message accidentally. Leaving the button, cancelling
the pointer or losing window focus cancels a pending hold. The send menu is also
available with the context menu or Up/Down keys while the button is focused.

Menus open above the entire composer, stay inside the viewport, support arrow
keys/Home/End, and dismiss on Escape, outside press, window blur or resize. The
shared editor used for editing an existing message retains its save/cancel flow.
The menu renderer, action descriptions, and poll/scheduling dialogs load on
demand. The initial-bundle check also prevents the menu from becoming eager.

## По-русски

Скрепка слева объединяет «Прикрепить файл», «Опрос», «Отложить сообщение» и
«Отложенные». Отдельные строки над редактором убраны; панель вложений появляется
только после добавления файлов. Меню используется в каналах, обсуждениях, личных
и групповых беседах, а также в избранном.

Короткое нажатие на отправку и Enter отправляют сообщение как раньше. Удержание
кнопки 450 мс открывает отложенную отправку, без отправки при отпускании.
Можно также использовать правую кнопку мыши или стрелки на клавиатуре.
Код меню и описания действий загружаются при открытии; проверка начальной
сборки запрещает включать модуль меню в обязательную загрузку страницы.
