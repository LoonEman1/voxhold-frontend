# Client performance and media quality

Channel history now has bounded caches, durable change synchronization and
idempotent send retries. Media activity subscriptions, member virtualization
and deferred dialogs are described in [channel history and rendering](channel-history.md).
The follow-up build has 262.50 kB initial JS (82.29 kB gzip) and 287.66 kB
workspace JS (81.70 kB gzip), with recording/voice/stream settings dialogs in
separate chunks. These bundle sizes do not measure a production FPS gain.

The workspace is loaded as a separate chunk after authentication. Chat history
uses TanStack Virtual with measured row heights, stable message IDs, scroll
anchoring on prepend, follow-on-append near the bottom and indexed search jumps.
Only the viewport and eight overscan rows on either side are mounted. Member
lookups are indexed. Raw microphone levels stay outside workspace React state.

## Microphone

`voiceGate.worklet.ts` runs the threshold gate on the audio rendering thread.
It uses a 3 ms attack, 180 ms hold and 60 ms release, with hysteresis. Meter
messages are limited to about 11 per second. Updating the threshold does not
reacquire the microphone. Mute preserves the capture graph and peer connection.
Unsupported worklet environments retain the existing compatibility graph;
`voice_input_ready.processing_path` identifies the selected path.

## Video

The preferred path transfers the processor/generator streams to a dedicated
worker. Every frame is inspected: explicit 8-bit BT.709 SDR frames retain their
original image through VideoFrame references; HDR, wide-gamut and unknown frames
are color-managed through an sRGB canvas. Rechecking every frame handles capture
surface changes. No format is assumed from the monitor setting alone.

The capture processor buffer is limited to one frame. Output writes are awaited;
idle refresh never adds another write while an output is pending. One last image
is retained for static-screen refresh. Frames, streams and workers are released
when the pipeline closes. Browsers that cannot transfer streams retain the
frame-driven and canvas compatibility paths.

## Diagnostics

The existing owner-only diagnostics export now includes:

- `session_started.browser`: browser family, including Yandex;
- `stream_connection_attempt` and `voice_starting`: unique `media_attempt_id`;
- connection-state events: initial `connection_ms` and successful `recovery_ms`;
- `stream_first_frame.first_frame_ms`: media attachment to first presented frame;
- `stream_playback_summary`: duration, visible playback stall count and duration;
- RTP event `quality`: interval packet loss, concealed audio, jitter-buffer delay,
  decode time, native video freeze counters, RTT, outgoing bandwidth and relay path;
- `main_thread_load`: long tasks over each 10-second visible-page interval;
- `stream_processing_path`: worker or compatibility video processing.

Missing interval measurements are null; `interval_available` distinguishes the
first sample. Percentages use counter deltas rather than lifetime averages.
RTT/route reporting never exports ICE candidate strings or network addresses.
Some browsers omit optional WebRTC counters. Initial connection time and player
first-frame time measure different phases and must not be added across unrelated
media attempts. Group attempts by session/browser and count each attempt once.

Concurrent quality, watchdog and diagnostic reads share an in-flight report and
reuse reports for at most 500 ms. Session-storage persistence is batched for
250 ms and forced on page hide/disposal. Diagnostic listeners and observers are
cleaned up; finished UI sound nodes are disconnected.
Voice per-track debug details sample at most four tracks and four outputs, so
large rooms retain their aggregate quality within the collector's 4 KiB event
limit; aggregate counters still cover every inbound stream.

## Verification

```sh
npm ci
npm run typecheck
npm run lint
npm test
npm run build
npx playwright install chromium
npm run test:e2e:performance
```

The standalone browser tests need no backend or account credentials. They verify
5,000-message history, prepend anchoring, append following, search navigation,
the actual AudioWorklet, mute track continuity and actual video worker playback.
They use synthetic audio/video in an isolated Chromium context. Cross-browser
hardware tests and production network measurements remain separate checks.

Runtime dependencies use React 19.3.1 and TanStack Virtual 3.14.22. The build uses
Vite 8.3.5 / React plugin 6.1.2, Vitest 5.0.5 and Node 24. The backend build uses
Go 1.27.3 and Pion WebRTC 4.2.25.

The recording and avatar changes add their own workspace code. The final production build on 2026-10-26 has an initial JS chunk of 259.69 kB (81.36 kB gzip) and a separately loaded workspace chunk of 294.86 kB (84.07 kB gzip), plus small workers. The original initial JS was 455.84 kB (137.22 kB gzip). This demonstrates deferred startup code, not a smaller total authenticated app or a measured FPS gain. Recording behavior and limits: [calls-recordings.md](calls-recordings.md).

A fresh npm registry review/audit found zero reported vulnerabilities. React/Vite/Vitest are current within the selected versions. Newer toolchain majors (TypeScript 7, ESLint 10, hooks plugin 7, jsdom 30) remain separate migrations: they do not make live media faster merely by changing versions. The tested TypeScript 5.9 toolchain and Playwright 1.62 are retained for this change; minor flag data/testing-tool updates are also deferred.

The browser regression job uses the official mcr.microsoft.com/playwright:v1.62.1-noble image on a pinned Ubuntu 24.04 runner, with a 15-minute job timeout. Its bundled browser/system dependencies avoid an unbounded cold install in the job; keep the image tag synchronized with the lockfile's Playwright version.
