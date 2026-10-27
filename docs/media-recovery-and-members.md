# Media recovery and member panel

The server viewer watchdog now preserves its ICE recovery stage until a decoded
frame actually advances. Further keyframes cannot restart the escalation loop.
A session that never receives initial video stats also reaches bounded recovery.
The player retries its live media attachment once after 10 seconds without
progress following an interruption and asks for a fresh viewer session after
20 seconds if frames still do not return. A healthy static screen and hidden
page do not trigger player repair. Automatic rewatches share a two-attempt,
two-minute budget; exhaustion produces an explicit error and a manual watch
action. Publisher capture and the voice call remain independent.

Remote speaking attribution is refreshed from audio SDP m-sections after each
accepted offer, including reused receivers with browser-generated track IDs.
Receiver audio-level statistics keep metering available when Web Audio is
suspended; the analyser is the fallback. Tests run real audio between two local
WebRTC clients and check that both views highlight the speaker and clear silence.

The right member panel offers Channel members and All members tabs, keyboard
navigation, current server-authorized access IDs, online/offline groups, refresh,
cancellation and retry. A denied list never falls back to displaying everyone as
permitted. The current backend access policy allows every member into every
channel, so the lists currently coincide. This feature does not add channel ACLs.
The extra role-colored dot is removed. Offline rows and profiles show relative
last-seen time with an exact local date/time tooltip. Presence updates merge
server timestamps live; reconnect refreshes missed times. Unknown history is
labelled explicitly. One visible-list clock updates relative times; there is no
timer per member. Lists remain virtualized above 100 rows.

Deploy backend v0.11.0 (including migrations 000020/000021 from the reliability
PR) before frontend v1.12.0. No new migration is needed for the roster or last seen.

References: [WebRTC RTP API](https://www.w3.org/TR/webrtc/#rtp-media-api),
[inbound RTP statistics](https://www.w3.org/TR/webrtc-stats/#dom-rtcinboundrtpstreamstats).

## Русский

После сетевой просадки восстановление проверяет декодирование кадров, а не
только статус connected. Последовательность ограничена: ключевой кадр,
перезапуск ICE, пересоздание просмотра; незавершённое подключение без первых
пакетов тоже обрабатывается. Плеер дополнительно перепривязывает живой поток,
если после обрыва не вернулись кадры. Повторные подключения ограничены общим
бюджетом; при исчерпании отображается ошибка с возможностью начать просмотр
заново. Голос и захват экрана автора при этом не перезапускаются.

Подсветка собеседников использует актуального владельца входящей дорожки и
работает при приостановленном AudioContext через WebRTC-статистику. Проверка
с настоящими локальными WebRTC-соединениями покрывает речь обоих участников
и снятие подсветки после тишины.

В списке участников появились вкладки канала и всего сервера. Вкладка канала
показывает допущенных пользователей, включая офлайн, по данным backend. Сейчас
индивидуальных прав каналов нет, поэтому эти списки совпадают. Точка роли убрана,
индикатор присутствия сохранён. Отображается последнее посещение с точными
датой и временем при наведении; неизвестные данные не выдумываются.

Сначала устанавливается backend v0.11.0 с миграциями 000020/000021, затем frontend
v1.12.0. Для списка доступа и последнего онлайна отдельной миграции нет.
