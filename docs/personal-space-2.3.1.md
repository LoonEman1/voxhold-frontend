# Frontend 2.3.1: personal-space interface fixes

The four links above the channel list are replaced by a drawer at the left edge.
Hover over the edge or activate its visible handle by keyboard/touch. Escape and
an outside click close it. Recent direct conversations show avatars and unread
badges. Conversations are separated into direct dialogs and groups, with search.

Direct messages, groups, the inbox and privacy settings occupy the workspace.
They no longer open a chat modal. Enter sends a message; Shift+Enter adds a line.
Server roles and storage live in tabs under server settings. Voice controls remain
available; opening a personal page does not mark hidden channel messages as read.
Channel notification links return to the channel and an active stream stays in
its persistent mini-player while browsing the personal workspace.

Click a member to open a compact card; click the avatar to open the full profile.
The card shows profile text, presence, country and roles. Only the instance owner
can assign/remove roles or create one with selected permissions. Assignment merges
with fresh server state to preserve other roles. A created role remains available
if its subsequent assignment fails, avoiding duplicate creation on retry.

Validation: typecheck, lint, all unit tests, production build, UI and performance
browser suites, and the isolated community fullstack test against backend 2.3.0.
Browser checks cover desktop, touch, keyboard, failed requests, privacy and roles.
This frontend patch requires backend 2.3.0; it introduces no backend migration.


## Mixed messages and quieter discussions

Files are uploaded into a draft tray and are only published when the composer
submits. A single request carries the caption and up to ten image/file IDs.
Channel, comment and direct-message composers share staging, progress, removal
and retry behavior. A failed channel send keeps its attachment IDs in the outbox
and retries the same idempotency key. A failed direct send retains its caption
and files. Text channels show the discussion link and reply count only after
replies exist; a new discussion starts from the message context menu.

## Media reliability review

The supplied production diagnostics identify a viewer render TypeError followed
by deliberate teardown of media and signalling, and a later connected session
whose video no longer progressed. The original TypeError's message and component
stack were absent, so its exact expression cannot be reconstructed from the logs.
A content error boundary now isolates presentational failures from the workspace
that owns voice and stream sessions. Diagnostics include bounded component names
and an error category/property, never raw messages or stack contents.

Viewer recovery keeps decoded static pictures instead of restarting a healthy
transport merely because video bytes stop changing. A fresh connection promptly
requests a keyframe. Stale viewer callbacks and a close event after an intentional
local close cannot tear down a successor. A publisher watchdog can replace a
stalled SDR pipeline's video input on its existing connection while keeping the
capture, audio and viewers. Repairs are bounded and an unsuccessful repair does
not itself stop an existing publisher. Worker write backpressure also has a
bounded failure signal. This is recovery support, not a guarantee against network
outages or a browser terminating the actual display capture.

Review fixes additionally reject stale role-list responses during role creation,
so a successful create followed by a failed assignment stays available to retry.
