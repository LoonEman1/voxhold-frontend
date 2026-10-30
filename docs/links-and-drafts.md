# Links and drafts — 2.5.1

Message bodies in channels, discussions, private/group conversations and Favorites
recognize HTTP(S) URLs. Links open in a separate tab with `noopener noreferrer`.
Unsafe schemes, credential-disguised URLs and HTML remain ordinary escaped text.
Quotes/search snippets retain their existing navigation controls.

Public HTTPS pages can show cards from Open Graph, Twitter Card and ordinary
HTML metadata; YouTube also uses oEmbed. Cards are universal, not restricted to
particular publishers. Sites blocking metadata requests or requiring JavaScript,
login or a bot challenge can fall back to the clickable URL. Cards show a title,
description and thumbnail, not an automatically loaded third-party iframe.

Cards and images load near the visible area, with a shared four-request queue.
Images are fetched through the authenticated backend and displayed as blobs;
the browser does not automatically contact external publishers or CDNs.
Requires backend **2.5.1**, deployed first; no migration beyond **000031**.
See [backend fetch policy](https://github.com/LoonEman1/voxhold-backend/blob/main/docs/link-previews.md).

Text drafts are stored in local browser storage, separately by API instance,
account, channel, discussion root and conversation. They survive navigation and
reload and clear after successful sending. Files and reply targets are not
persisted, and drafts do not synchronize between devices.

Personal history now backfills missed pages after disconnection, including
changes/deletions in the loaded range. Conversation navigation follows all list
pages and can open an older conversation directly by its ID. Session renewal
retries transient errors without removing a valid login or closing a personal
call; an old WebSocket revoked during rotation cannot erase the new session.
