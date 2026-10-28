# Community 2.3 / Новые возможности общения

Requires backend 2.3.0 and migrations 27–30. See the authoritative
[API, permission and storage contracts](https://github.com/LoonEman1/voxhold-backend/blob/v2.3.0/docs/community-2.3.md).

- Channel messages and personal/group conversations accept files, clipboard
  images, drag/drop and short videos (64 MiB input limit). Upload progress,
  interruption retry, inline images, image expansion, inline video and downloads
  retain bearer authentication. Files removed by the owner show a placeholder.
- The owner sees a joint disk allocation chart and separate image/file/recording
  quotas both in server settings and the storage navigation entry. Cleanup shows
  the exact count/bytes before confirmation and requires a fresh preview after
  changing category/period. Allocations may be zero; lowering them preserves files.
- Participant profiles have **«Написать»**. The personal section creates direct
  or small group conversations, restores unread counts, controls who can write,
  blocks/unblocks participants and allows leaving. Failed text/file sends retry
  their original keys, including after a lost acknowledgement.
- **«Входящие»** links mentions, replies and followed threads directly to the
  message/discussion. Background refreshes are batched; settings failures do not
  erase successful attention results.
- Text messages have **«Обсудить»**. The right panel supports comments,
  subscriptions, unread state, reply quotes, reactions, editing and deletion.
  Main-channel quoted replies keep their previous behavior.
- The owner creates and assigns roles with name/color and read, publish, voice,
  stream and moderation permissions. Private-channel grants and role preview
  are available. Badges appear in messages and profiles. The UI displays effective
  publish permission; the backend remains authoritative for every action.

Пользовательские роли складываются; назначенные роли заменяют обычные права
участника. Удаление последней роли возвращает стандартный набор. Владелец и
администраторы сохраняют полный доступ. Предпросмотр не изменяет вашу сессию.

Validation: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`,
`npm run test:e2e:ui`, `npm run test:e2e:performance` and the optional isolated
`npm run test:e2e:community` fullstack scenario. The backend documentation explains
how to create public fixture data in a fresh directory; never use production data.
