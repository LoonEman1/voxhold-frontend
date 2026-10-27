# Frontend audit fixes in 2.1

Auth startup and renewal share one scheduler and one in-flight rotation. A token
and generation check discards old refresh results after login/logout/unmount.
Unauthorized transport notifications carry the request token; public login 401s
cannot expire an unrelated session. Browser storage adapters use Web Locks and
storage events to share rotation/logout across tabs. Adapters without that
optional capability retain per-provider protection, without a cross-tab guarantee.

Server member snapshots are canceled across token/server generations and retried
when a live mutation crosses the request. Reconnect loads a complete authoritative
catalog. Role updates preserve monotonic last-seen and omitted avatar metadata.
Channel rosters hide stale data immediately after access/membership invalidation;
there is no periodic HTTP polling. The list means people with channel access,
with a separate server-online indicator, as agreed with the user.

The empty voice room and call control SVGs were inspected in Chromium at 360×800,
1280×720 and 1920×1080 in light/dark themes. Tests also cover state transitions,
retry, private channel access, reconnect behavior, two-tab auth and existing UI.

Run typecheck, lint, unit tests, build and both existing Playwright UI/performance
suites before release. See the matching backend audit report for media measurements
and deliberate deferrals (adaptation, PGO, cache ownership, memory policy).
