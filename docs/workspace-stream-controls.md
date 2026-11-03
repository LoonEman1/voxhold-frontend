# Personal pages, server events and live stream controls

Follow-up to release 2.6.3. Changes target `dev` through a separate feature PR.

## Navigation and events

The permanent rail is the single set of personal navigation links. Inbox,
favorites, privacy, events and the audit log use the space beside the rail;
the wider conversation list appears only in Messages. Channel panes remain
mounted while hidden, preserving channel history and active media sessions.
The account menu in the rail retains profile, voice settings, logout and active
voice controls. On small screens, More contains events, administration and
privacy; hiding the desktop sidebar does not remove these destinations.

Events have calendar cards, attendance responses, cancellation confirmation,
a local-time editor, retryable loading and a useful empty state. Upcoming and
Recent filters reflect the existing API: past events cover the last 24 hours,
alongside returned cancelled events. This is not a full historical archive.
Changing community/account discards the old list/form; late requests cannot
replace the new community's data. Mutations are serialized and failed saves
retain the draft. The module is loaded only when events are opened.

## Changing quality while live

The publisher can open Quality from the stream card or floating player. Edits
remain a draft until Apply. Resolution, frame rate, content preference and
video/audio bitrate update existing capture clones and RTP senders. Capture
permission, capture/output tracks, PeerConnections and viewer sessions remain
alive. A rejected update attempts to restore the previous limits and leaves
the editor open. Only successful updates are persisted; volume/mute changes
made concurrently are retained.

Video bitrate remains 0.5–16 Mbit/s in 0.1 steps. These are upper targets:
source dimensions, browser encoders, CPU and network capacity still determine
the actual output shown in quality statistics. RTP scaling also bounds the encoded
resolution when a capture source accepts constraints but keeps its original size. Opus negotiates headroom for
live bitrate increases while preserving a lower server ceiling. The RTP cap
still controls the selected rate. P2P peers joining later inherit the latest
successful settings.

Transport, codec, dynamic range and audio capture are selected before starting;
they stay disabled in the live editor because they change the session/capture
contract. Existing stream mute and volume controls remain available.

## Several screens in a channel

The matching backend supports up to eight publishers per channel. Cards show
all publishers; watching selects one stream, avoiding background decoding and
audio from every card. Switching waits for the previous viewer's leave
acknowledgement before opening the selected publisher. A stop notification
removes only its publisher; unrelated viewers keep their player and connection.
Each connection retains its existing single role: publish one screen or watch
one stream. Publishing users see their own preview and can watch another screen
after ending their own show.

Authentication/Ready advertise `multi_streams`. Older backends keep a one-stream
limit; older frontend tabs receive the primary stream rather than every
publisher's lifecycle events. Update backend before frontend. No dependencies,
HTTP API changes or database migrations are added.

Validation includes real browser frames through both publishing classes while
changing 1080p/30 → 720p/15 → 1080p/45, stable track/peer identities, late P2P
viewers, desktop/mobile UI in both themes and recovery-generation regressions.

## Русский

Повторная широкая колонка «Личное» убрана: переходы остаются в постоянной панели,
а список разговоров — в «Сообщениях». Аккаунт и управление голосом доступны из
меню аватара. На телефоне события, журнал и личные настройки находятся в «Ещё».

События получили карточки с датой, ответы участников, фильтры, подтверждение
отмены и повтор загрузки. «Недавние» показывают данные существующего API, включая
прошедшие за последние сутки. Поздние ответы другого сообщества отбрасываются.

Кнопка качества меняет битрейт, разрешение, FPS и содержимое во время показа.
До «Применить» изменения остаются черновиком. Захват, дорожки и соединения не
перезапускаются; при ошибке выполняется попытка вернуть прежние ограничения.
Кодек, HDR/SDR, способ передачи и источник звука выбираются перед запуском.

В одном голосовом канале могут показывать экраны до восьми участников. Для
просмотра выбирается один поток; переключение не останавливает издателей.
Завершение чужого потока не закрывает выбранный. Собственный показ и просмотр
другого экрана сохраняют существующие отдельные роли подключения. Поддержка
нескольких потоков согласуется capability, поэтому старые версии сохраняют
один основной поток. Backend обновляется первым, схема БД не меняется.

Official Firefox 159 on Windows was checked separately with an isolated fake-
camera profile: both publishing classes continue presenting frames through
1080p → 720p → 1080p, preserve track/peer identities and retain updated limits
for a late P2P viewer. Its fake camera kept its source size, exercising the RTP
scaling fallback rather than treating a resolved constraints promise as proof.
