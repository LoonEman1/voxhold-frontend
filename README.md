English | [Русский](README.ru.md)

# Voxhold frontend

Web client for a self-hosted Voxhold instance, built with React, TypeScript and
Vite. It connects to the Voxhold HTTP API, WebSocket events and WebRTC media.

**Related repositories:** [Backend](https://github.com/LoonEman1/voxhold-backend)
· [Production deployment](https://github.com/LoonEman1/voxhold-deploy).

Use the backend repository for API and database changes. Use the deployment
repository to install the complete application on a Linux server with HTTPS,
backups, TURN and coordinated updates from published images.

## Features

- Invite-only registration, account sessions, profiles and avatars.
- Spaces with member roles, private channels and access settings.
- Text, voice and news channels. The news group appears above text and voice
  groups only when the selected space has an accessible news channel.
- News publishers, reactions and optional per-post comments. Readers can react;
  channel managers select publishers and enable or disable new comments.
- Message replies, forwarding, reactions, editing, deletion, pins and search.
- Read receipts and persistent unread-notification badges, displayed up to `99+`.
- WebRTC voice, microphone/output controls and server-relayed or P2P screen sharing.
- Channel recordings with local/server copies, previews and download recovery.
- Dark/light themes, adjustable sidebars, mobile layouts and media reconnection.

Federation is currently a
[design proposal](https://github.com/LoonEman1/voxhold-backend/blob/main/docs/federation-concept.ru.md),
not a released client capability. This version connects to one instance.

## Interface examples

These screenshots use deterministic test fixtures and sample accounts.

### News feed and private channels

![News channel with a visible private-channel lock, reactions and a comments button](docs/screenshots/news-channel.png)

<details>
<summary>Post comments and call controls</summary>

Comments open beside the feed; disabling comments keeps the discussion history
available for reading.

![Comments beside a news publication](docs/screenshots/news-comments.png)

The call toolbar labels microphone, sound, screen sharing, recording, archive,
chat and leave actions.

![Voice room with labelled call controls](docs/screenshots/voice-room.png)

</details>

## Quick start with an existing backend

Requirements: Docker Engine and Docker Compose v2. The default configuration
expects a backend reachable at `host.docker.internal:8080` from the container.

```bash
cp .env.example .env
docker compose up --build -d
```

Open [http://localhost:3000](http://localhost:3000). Container Nginx serves the SPA
and proxies `/api` and WebSocket to the backend. Set `BACKEND_UPSTREAM` in `.env`
if the backend runs on another host or port.

For a complete local stack, clone the frontend and
[backend](https://github.com/LoonEman1/voxhold-backend) into sibling directories
named `Voxhold-frontend` and `Voxhold-backend`, then run from the frontend directory:

```bash
docker compose -f compose.fullstack.yaml up --build -d
docker compose -f compose.fullstack.yaml logs bootstrap
```

Save the generated owner password if `BOOTSTRAP_PASSWORD` was left empty. To stop
the stack without removing its SQLite volume:

```bash
docker compose -f compose.fullstack.yaml down
```

For a public installation, follow
[Voxhold deploy](https://github.com/LoonEman1/voxhold-deploy#one-command-installation-without-git).
HTTPS is required for browser microphone and screen capture outside localhost.
Publish voice UDP `50000` and screen-sharing UDP `50001`, and set
`WEBRTC_PUBLIC_IP` to an address reachable by your users.

## Invitations and access

Invitations use a web URL such as `https://chat.example.com/#/invite/TOKEN`.
The landing page validates the invitation and lets the recipient continue in
the browser or explicitly open the native client. Registration requires a valid
invitation; knowing an instance address does not grant membership or channel access.
Owners and administrators can inspect and revoke active invitation links.

Prefer one public origin for the frontend and `/api`. For a separate browser
origin, the instance owner can allow it under server settings → external client
access. The backend applies this CORS/Origin allow-list at runtime.

## Local development

Requirements: Node.js 24, npm and a running backend.

```bash
npm ci
cp .env.example .env
npm run dev
```

Validation:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

Browser regressions use Playwright and isolated fixtures; a production backend
is not needed:

```bash
npx playwright install chromium
npm run test:e2e:ui
npm run test:e2e:performance
```

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `VITE_API_BASE_URL` | empty | Build-time API origin; empty uses same-origin `/api`. |
| `VITE_DEV_API_PROXY` | `http://localhost:8080` | Backend used by Vite during development. |
| `BACKEND_UPSTREAM` | `host.docker.internal:8080` | Backend reachable from container Nginx. |
| `FRONTEND_PORT` | `3000` | Frontend port on the host. |
| `WEBRTC_PUBLIC_IP` | `127.0.0.1` | Local-stack backend address advertised to media clients. |
| `WEBRTC_UDP_PORT` | `50000` | Voice UDP port in the local full-stack Compose file. |
| `WEBRTC_STREAM_UDP_PORT` | `50001` | Screen-sharing UDP port in the local full-stack Compose file. |

ICE/TURN configuration is fetched at runtime from
`GET /api/v1/webrtc/config`; changing backend ICE settings does not require a
frontend rebuild. See [`.env.example`](.env.example) and the
[deployment configuration](https://github.com/LoonEman1/voxhold-deploy/blob/main/.env.example)
for media limits, TURN and production settings.

The HTTP transport and session storage adapters are defined in
[`src/platform/transport.ts`](src/platform/transport.ts); WebSocket transport is
in [`src/services/realtime.ts`](src/services/realtime.ts).

## Releases and upgrading

Frontend and backend share **2.5.1**. Install backend **2.5.1**, including migrations
**000027–000031**, before this frontend. The migrations add custom roles, thread
subscriptions, personal conversations and attachment metadata. Retain a verified backup before upgrading.

The published frontend image is `ghcr.io/looneman1/voxhold-frontend:2.5.1`;
`2.5` and `latest` are moving tags. To update an existing production deployment:

```bash
./update.sh --backend-version 2.5.1 --frontend-version 2.5.1
```

Run that command from the
[deploy repository](https://github.com/LoonEman1/voxhold-deploy), not this source
checkout. Review [release notes](RELEASE_NOTES.md) and the
[shared release workflow](docs/release-workflow.md). Changes pass through a PR to
`dev`, then a release PR to `main`; successful main CI publishes images, tags and
GitHub Releases automatically.

## Documentation

- [Channel history, synchronization and retries](docs/channel-history.md)
- [Private channels and stream tiles](docs/channel-access-and-stream-tiles.md)
- [Message replies, forwarding and reactions](docs/message-interactions.md)
- [Notification settings](docs/channel-notifications.md)
- [News channels, permissions, comments and counter API](https://github.com/LoonEman1/voxhold-backend/blob/main/docs/news-channels.md)
- [Calls, recordings and avatars](docs/calls-recordings.md)
- [Media recovery and channel members](docs/media-recovery-and-members.md)
- [Client performance](docs/client-performance.md)
- [Contributing](CONTRIBUTING.md)


Community 2.3: [attachments, conversations, inbox, roles and text threads](docs/community-2.3.md).
