# Channel access and call stream tiles / Доступ к каналам и плитки трансляции

Channel settings now include an open/restricted access section with role and
individual member selection, effective member count, search and explicit save.
Owner/admin retain access. The current role system is owner/admin/member;
custom roles and separate read-only/speak/stream overrides are outside this change.
Deploy backend migration 000022 first. The backend enforces visibility everywhere;
the frontend reflects it and purges revoked history, pending sends and search.
Both member tabs remain available; channel roster changes are refreshed live.

An active screen share starts as a square tile alongside voice participants.
Clicking a live preview opens focused viewing; clicking an unwatched tile starts
watching and opens it when media arrives. A speaking participant strip preserves
room context. Fullscreen hides the surrounding UI, fades controls after inactivity
and restores them on input. Escape/F return from cinema; collapse returns to the
call grid. Layout changes reattach the same MediaStream without stopping tracks.
Existing mini-player behavior while browsing other channels is preserved.

## Как пользоваться

- Меню канала → «Изменить канал» → «Доступ к каналу» → «Закрытый канал».
- Отметьте нужных людей. Роль «Участник» отмечайте, только если хотите открыть
  канал всем обычным участникам, в том числе будущим.
- Для канала только владельца и администраторов оставьте списки пустыми.
- Нажмите «Сохранить доступ»: изменения действуют сразу, в том числе в звонках.
- Трансляция отображается плиткой в сетке звонка. Нажмите на неё для крупного
  просмотра; «Полный экран» скрывает интерфейс. Esc/F возвращают управление.

Validation: TypeScript, ESLint, unit tests, Chromium browser UI/reliability suites,
and screenshots in dark/light/mobile layouts. Browser stream layout tests use a
real canvas MediaStream; existing voice tests exercise real WebRTC audio. A live
multi-device SFU call on the production host is not part of this local verification.
