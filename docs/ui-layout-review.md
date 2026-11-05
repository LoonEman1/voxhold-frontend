# Dialog layout and stream preview

The shared `Modal` now owns a padded body. Content and headings share the same
horizontal inset; the scrollbar reserves equal gutters on both sides. Individual
forms and panels no longer add their own outer padding. This covers invitations,
scheduled messages, polls, camera/stream/voice settings, recordings, profiles,
server settings, channel access and confirmation dialogs. Input/select heights,
textarea spacing and action rows follow the same rules, with stacked invitation
fields on narrow displays. Layout assertions exercise dark/light themes at
1280, 390 and 320 pixels; the existing workspace browser suite covers navigation,
profiles, settings, chats and media controls.

Verified locally on 4 November 2026: 557 tests in 122 unit/component files,
75 browser UI scenarios, TypeScript, ESLint and the production build/bundle
budget check passed. Screenshots are saved under the backend workspace's
`output/ui-review-2026-11-04/` directory.

The stream preview defaults to 360×225 at the bottom right. Drag the channel name
or use its arrow keys; Home restores the default bounds. Resize from the bottom
corner. Fullscreen and Escape preserve the same video element and the saved
preview bounds. The back arrow returns playback to the voice-channel grid;
the close button stops only this user's viewing (or publishing).

## Capture audio limitation

System loopback audio can contain the voice room itself. `restrictOwnAudio` is
requested on capture and retried with `applyConstraints` when a supporting browser
does not apply it initially. Window capture requests `windowAudio: "window"` to
prefer the game's audio over the full system mix. These are browser capabilities:
accepting a hint does not prove that exclusion is active. The warning is based on
the returned track settings, not on an audio-content measurement. Game audio is
preserved when exclusion is unsupported, rejected or ignored; it is never muted
automatically. Headless/mocked capture checks cannot certify a friend's specific
Yandex Browser version and physical system-audio capture.

## По-русски

У всех модальных окон появился общий контейнер с одинаковыми отступами слева и
справа. Исправлены прижатые к границам списки приглашений, формы отложенной
отправки, опросов и похожие панели; выровнены поля и кнопки. Предпросмотр трансляции
стал маленьким окном справа снизу с управлением поверх видео. После Escape он
остаётся маленьким, сохраняет положение и не пересоздаёт видеоплеер.

Звук игры автоматически не отключается. Для отдельного окна запрашивается звук
этого окна, а исключение голоса Voxhold повторно применяется и проверяется, когда
браузер это поддерживает. Если браузер отдаёт только общий системный микс и не
подтверждает исключение Voxhold, эхо остаётся возможным; интерфейс сообщает об этом.
Полное устранение эха в конкретной версии Яндекс Браузера без реального захвата
не подтверждено.
