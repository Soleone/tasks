# Current support

What runs where today. The target behavior is [the spec](../spec/README.md); what Windows doesn't have yet is listed once, in [spec/client/platforms.md](../spec/client/platforms.md). The previous detailed index, with per-family evidence, is frozen at [evidence/support-2026-10-14.md](evidence/support-2026-10-14.md).

## Entry points

| Entry point | Engine | What it offers | Evidence |
| --- | --- | --- | --- |
| `pnpm dev:web --home PATH` (Linux) | Current | The established UI over the dev bridge: capture, edit, classification, priority, statuses, child capture, parent and blocker edits, reorder, status batches, about 50 steps of same-client undo, Settings backup and restore, filters, search, external refresh, remembered preferences | [Routing tests](../scripts/mainClientRouting.test.mjs), [editor tests](../scripts/workspaceEditor.test.mjs); owner-reported high-level smoke on disposable data, no case-level walkthrough |
| `tasks-cli --home PATH` (Linux) | Current | Queries, task, link, undo and purge verbs, init (creates the home), rebuild, archive, restore, recover, rebind, new-history, with retry metadata | [Friendly CLI tests](../src/backend/friendlyCli.test.ts) |
| `tasks-backend --stdio --home PATH --client app\|cli` | Current | Every command in [spec/backend/commands.md](../spec/backend/commands.md), including reorder, batches and doctor. On Windows Node, init, migrate, child capture, blocker, move, reorder, status batch, undo and backup were smoke-tested on disposable data (2026-10-16) | [Gateway tests](../src/backend/gateway.test.ts), [conformance history](evidence/conformance-history.md) |
| Desktop app (`pnpm build:tauri`, `pnpm dev:native`) | Current | The established UI on the remembered Tasks home; first-launch setup creates or opens a home. Not yet built natively with the Tasks home (2026-10-20) | [Desktop setup test](../scripts/desktopWorkspace.test.mjs); owner confirmed native Windows 11 app works (2026-10-19), without a case-level walkthrough |
| Android app (`pnpm build:android`, arm64, Android 11+) | Current | The desktop UI and setup, with the backend bundled as a Node executable; the Tasks home is a path on shared storage | Signed release APK builds in WSL; owner confirmed Android app works (2026-10-19), without a case-level walkthrough |

## Open blockers

- **Native coverage:** the owner confirmed native Windows 11 and Android apps work (2026-10-19). Linux desktop remains unverified; detailed workflow coverage and save-speed measurements were not reported. Global focus is deferred.
- **Windows crash checks:** the proof-profile fault-injection checks were removed with the profile; crash recovery is tested on Linux only until they are rebuilt.
- **Browser walkthrough:** no case-level interaction run exists for the dev:web route. The last attempt stopped before a page opened (missing `libglib-2.0.so.0` on the worker host).
- **Owner acceptance:** native Windows 11 and Android smoke success is owner-confirmed; qualifying multi-day use and personal migration have not been reported.
- **Migration:** `pnpm migrate`, owner-only, not part of the app ([runbook](migration.md)). Tested with disposable data only. No personal data has been read or converted.
- **Corpus:** 101 of 112 original corpus cases execute in backend tests; the other 11 have no executor.

## Development health

The 2026-10-19 check passed `pnpm check`, `pnpm lint`, `pnpm test` and `kit check`: 1,444 tests passed, one skipped, with no vendored drift or dead-code findings. The web build passes but warns about a roughly 601 kB minified `mainWorkspace` chunk (190 kB gzip). This is not a native release or crash-recovery validation.

When support changes, update this table and the current state in [PLAN.md](../PLAN.md). Change the platforms spec only when behavior changes; keep dated evidence frozen. Never relabel an unsupported case as passed to make documentation agree.
