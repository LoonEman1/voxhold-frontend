# Chat and voice-settings review, 2.3.2

Direct/group messages reuse MessageAvatar and MessageHeader with channel chat,
including dates, grouping and the existing avatar cache/provider. Dialog authors
open profile cards through the workspace. Hover activation extends 56 pixels
from the left edge and uses a passive listener rather than a click-blocking
invisible overlay. Background refresh preserves exhausted history pagination
and a failed-send error.

The supplied historical logs show a viewer render TypeError followed by local
stream/voice/WebSocket closure. They have no component name, failing expression
or settings-open event; linking that exact error to opening microphone settings
is an inference, not a confirmed root cause. Dialogs previously sat outside the
content error boundary, so either a lazy-import failure or a dialog render crash
could still unmount the media owner. WorkspaceDialogBoundary now isolates them.
Microphone settings are eagerly included in the workspace chunk, avoiding the
need to fetch their first lazy chunk from a replaced deployment during a call.

A confirmed independent bug used the fatal media error handler when replaceTrack
rejected a microphone change. It now records a nonfatal input error, preserves
the peer/remote outputs, and exposes retry to the owner. The path is applied both
to an initial join and to a recovered voice session. Another test covers closing
an idle microphone preview while AudioContext.resume is pending: no late meter
or device-refresh callback is allowed after cleanup.

Validation includes unit tests for failed input replacement with preserved remote
audio and subsequent retry, lazy-dialog failure without owner teardown, preview
cleanup, pagination and failed-send refresh. Browser tests verify matching message
geometry, avatars/date separators, wide hover access, touch/keyboard, and opening
and changing microphone settings during real WebRTC video without ending capture
or replacing its peer. The full community flow is also tested against an isolated
Docker backend. Backend 2.3.1 returns attachments immediately in HTTP/realtime and
idempotent replay, including server-deleted placeholders; it adds no migration.
