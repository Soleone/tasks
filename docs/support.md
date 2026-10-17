# Current support

What runs where today. The target behavior is [the spec](../spec/README.md); what Windows doesn't have yet is listed once, in [spec/client/platforms.md](../spec/client/platforms.md). The previous detailed index, with per-family evidence, is frozen at [evidence/support-2026-10-14.md](evidence/support-2026-10-14.md).

## Entry points

| Entry point | Engine | What it offers | Evidence |
| --- | --- | --- | --- |
| `pnpm dev:web --root PATH --database CACHE` (Linux) | Current | The established UI over the dev bridge: capture, edit, classification, priority, statuses, child capture, parent and blocker edits, reorder, status batches, about 50 steps of same-client undo, Settings backup and restore, filters, search, external refresh, remembered preferences | [Routing tests](../scripts/mainClientRouting.test.mjs), [editor tests](../scripts/workspaceEditor.test.mjs); owner-reported high-level smoke on disposable data, no case-level walkthrough |
| `tasks-cli --root PATH --database CACHE` (Linux) | Current | Queries, task, link, undo and purge verbs, init, rebuild, archive, restore, migrate, recover, with retry metadata | [Friendly CLI tests](../src/backend/friendlyCli.test.ts) |
| `tasks-backend --stdio --root PATH --database CACHE` | Current | Every command in [spec/backend/commands.md](../spec/backend/commands.md), including reorder, batches and doctor. On Windows Node, init, migrate, child capture, blocker, move, reorder, status batch, undo and backup were smoke-tested on disposable data (2026-10-16) | [Gateway tests](../src/backend/gateway.test.ts), [conformance history](evidence/conformance-history.md) |
| Desktop app (`pnpm build:tauri`, `pnpm dev:native`) | Current | The established UI on the remembered task folder; first-launch setup picks or starts a folder | [Desktop setup test](../scripts/desktopWorkspace.test.mjs); no owner launch yet |
| `--legacy`, Android builds | Legacy | The old app and CLI, until they are deleted | Old specs in git history |

## Open blockers

- **Desktop launch:** the new desktop app has not been launched on Windows or Linux yet. Earlier Windows pilot launches stopped before the main window appeared; the pilot launcher is gone, and the owner tests a release build next. Global focus is deferred.
- **Windows crash checks:** the proof-profile fault-injection checks were removed with the profile; crash recovery is tested on Linux only until they are rebuilt.
- **Browser walkthrough:** no case-level interaction run exists for the dev:web route. The last attempt stopped before a page opened (missing `libglib-2.0.so.0` on the worker host).
- **Owner acceptance:** no qualifying multi-day owner sessions recorded yet.
- **Migration:** `pnpm migrate`, owner-only, not part of the app ([runbook](migration.md)). Tested with disposable data only. No personal data has been read or converted.
- **Corpus:** 101 of 112 original corpus cases execute in backend tests; the other 11 have no executor.

When support changes, update this table, the platforms table and the evidence together. Never relabel an unsupported case as passed to make documentation agree.
