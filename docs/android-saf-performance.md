# Android SAF read performance: investigation record

## Decision

Keep **four concurrent canonical-file reads** on Android. `AndroidWorkspacePlugin.readCanonicalFilesInternal` uses a fixed worker pool, not one coroutine per file, and a plugin-wide four-permit semaphore so overlapping scans cannot open more than four file streams in total. Indexed results preserve the provider's listing order; a failed file read rejects the whole scan. The full read remains necessary to see content-only edits even when SAF size/mtime metadata does not change. There is no persistent full-scan cache.

This is supported by one real-workspace measurement, not a proven optimum for every provider or workspace. The temporary self-benchmark and its automatic SAF report writer were **removed** after the run. Normal debug and release builds do not create benchmark files or perform extra scans.

## Evidence (2026-09-23)

A temporary debug APK ran on a **Pixel 10a, Android API 37**, using `com.android.externalstorage.documents` and an existing workspace with **68 canonical files, 72,016 known bytes**, no unknown file sizes. The runner read/decoded the entire tree and built the same native JSON array as the normal scan. It performed three rounds in the order `1,2,4 → 4,2,1 → 1,2,4`, waiting 300 ms between scans. Two scans overlapped a normal app read and are excluded below. Values are native scan times, including directory listing, but **not** Tauri transfer, JavaScript validation/hashing, SQLite reconciliation, or rendering.

| Read limit | Non-overlapping native scan times | Median | Samples |
| --- | --- | ---: | ---: |
| 1 (sequential) | 1,017 ms; 1,532 ms | 1,274.5 ms | 2 |
| 2 | 548 ms; 772 ms | 660 ms | 2 |
| 4 | 289 ms; 398 ms; 415 ms | 398 ms | 3 |

Across all nine scans there were **zero provider read errors** and **zero Android main-thread frame gaps above 50 ms** during the native reads. Directory listing alone took 55–115 ms. The four-reader native median was roughly 3.2 times faster than the sequential median on this provider/workspace; that is **not** an end-to-end UI speedup figure. The user also reported that the app felt snappier. PSS and Java/native heap were sampled only before and after each scan; values varied substantially and do not establish peak memory or a memory improvement. The two excluded scans were the second round at limit 1 and third round at limit 2. There are too few independent samples for a meaningful p95.

Host checks after retaining the four-reader implementation: Android JVM tests cover worker/stream bounds, overlapping scans, order, empty and sequential cases, and error propagation. Kotlin compilation and an arm64 APK build passed. A physical device was used for the SAF report, but full native UI, recovery, and SQLite acceptance are separate outstanding work.

## Repeating or extending the investigation

The diagnostic runner is **not shipped**. If a future regression or new SAF provider justifies another run, make a temporary debug-only instrumentation branch or worktree and remove it after collecting results:

1. Use a backed-up existing workspace with the user's consent. Record Android/device version, provider authority, canonical file count and known bytes, online/offline state, and whether Syncthing is idle. Never log task contents, file paths, document URIs, or workspace IDs. Do not uninstall/clear a personal app to install a debug APK with a different signature.
2. Run the same native directory listing, bounded file reads, UTF-8 decoding, and JSON-array assembly at limits **1, 2, and 4**. Repeat in balanced forward/reverse order on unchanged files. Time listing, reads, and total with `SystemClock.elapsedRealtimeNanos()`. Track provider exception **type**, not its potentially sensitive message. Track concurrent normal scans and discard overlapping samples; background polling can otherwise skew comparisons. Bound the total trial count/duration and do not block task operations on report writing.
3. For APK-only collection, create one unique **noncanonical `.txt`** report at the SAF sync root *after* measuring. The app ignores root files other than `workspace.json`, so the report can sync without entering `tasks/` or `order/`. Keep it small, avoid overwriting existing files, and treat report-write failures as diagnostics rather than task read failures. Remove the report from synced devices after analysis. The temporary run used Android `Debug.MemoryInfo` for before/after PSS/heap snapshots and `Choreographer` callbacks for main-thread gaps above 50 ms; neither is a peak-memory or WebView frame trace.
4. For a broader conclusion, test a **larger real workspace and each provider actually used** with more independent trials, including cold and warm launches. Capture end-to-end bridge/JS parse and list readiness, peak memory (Android Studio/Perfetto), provider errors, UI input/frame responsiveness, and a content-only external edit. Compare against sequential reads. Do not introduce a metadata-only cache that could miss that edit.

The original unbounded-per-file fanout was introduced in `6ef6672`. The benchmark's aggregate results above are retained here, not the personal synced report or the one-off benchmark code. The report outside the repository was left in place for the owner to delete when ready.
