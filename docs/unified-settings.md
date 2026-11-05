# Unified personal settings / Единые настройки

The gear button and the account-menu **Settings** entry open the same dialog.
It has exactly three primary tabs: **Profile**, **Voice and audio**, and **Privacy**.
The selected tab is remembered while the workspace remains open. Profile, avatar,
appearance, password/session management and account deletion remain available in
the profile tab. Its unsaved draft stays mounted when another tab is selected.
Voice changes apply immediately; privacy contains message permissions, blocks
and system notification permissions. Tabs and the close control stay visible while
the selected panel scrolls. Keyboard arrows, Home/End and Escape are supported.

Shared speaker volume accepts **0–200%** and persists on the device. Voice rooms
and personal calls use a lazy Web Audio gain graph above 100%; setting the HTML
media element above 1 is never attempted. A room's shared volume composes with
the existing individual-participant multiplier. One context serves all boosted
outputs in a session, with separate destinations retaining each element's mute
and selected output device. Leaving the call releases generated tracks and nodes.
Personal-call output changes are delivered immediately without restarting the call.

Browser checks cover both themes at 1280, 390 and 320 pixels, account/gear entry
points, three-tab layout, draft retention, privacy saving and volume persistence.
A real-browser oscillator probe measures the samples at normal, double and half
gain, rather than testing only the slider's value.

## По-русски

Шестерёнка и пункт «Настройки» в меню аватара открывают одно окно с тремя вкладками:
«Профиль», «Голос и звук», «Приватность». Отдельные пункты настроек профиля и голоса
убраны. Аватар, оформление и безопасность находятся в профиле; разрешения личных
сообщений, блокировки и системные уведомления — в приватности. Переключение вкладок
сохраняет несохранённый текст профиля.

Ползунок громкости собеседников работает от 0 до 200%, сохраняется и применяется
к текущему голосовому каналу или личному звонку. Усиление выше 100% выполняется
через Web Audio и проверяется измерением настоящего аудиосигнала в браузере.
