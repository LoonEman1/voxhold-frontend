# Performance in 2.5.0

The composer owns its draft/sending/error state, while memoized rows receive
stable action delegates and row-specific state. Reactor-loader identity remains
part of the row context because it scopes caches to the current account/channel.
The history store updates snapshots immediately and batches listener notification
for up to 8 ms. A single new ordered message uses an append path; quotes,
revisions, deletes, out-of-order data and resync still use reconciliation.

## Reproducible browser fixture

Run `npm run bench:optimization` with Playwright Chromium installed. Set
`VOXHOLD_PERF_OUTPUT` to a JSON path to retain the five samples. The fixture has
1,000 messages, 1,000 members/read receipts and 20 mounted rows. It types 120
characters and separately delivers 1,000 new messages to the history store.
Chromium's CPU throttle is 4x; React development profiling is enabled.

Measured locally on 30 October 2026, Chromium 151.0.7922.34, Ryzen 7 9800X3D,
five samples per version, sequential runs of the same fixture:

| Metric, median | Before | After |
| --- | ---: | ---: |
| JavaScript CPU time for typing 120 characters | 8,830 ms | 438 ms |
| React render time across those commits | 6,662 ms | 68 ms |
| P95 render duration | 58.5 ms | 0.7 ms |
| History burst, including notification delay | 704.8 ms | 159.7 ms |
| History listener notifications | 1,000 | 1 |

These numbers describe this stressed development fixture, not production FPS,
individual keystroke latency or an end-to-end network speedup. Real histories,
viewports and device speeds vary. Existing browser regressions cover recovery,
replies, scroll restoration, recording and UI behavior; unit coverage also checks
that replacing a reactor loader aborts the old scope through memoized rows.

Backend measurements and CPU images are described in the matching backend
[performance report](https://github.com/LoonEman1/voxhold-backend/blob/main/docs/performance-2.5.0.md)
and [AMD64 documentation](https://github.com/LoonEman1/voxhold-backend/blob/main/docs/amd64-levels.md).
