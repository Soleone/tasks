# Current support

What runs where today. The target behavior is [the spec](../spec/README.md); what Windows doesn't have yet is listed once, in [spec/client/platforms.md](../spec/client/platforms.md). The previous detailed index, with per-family evidence, is frozen at [evidence/support-2026-10-14.md](evidence/support-2026-10-14.md).

## Entry points

| Entry point | Engine | What it offers | Evidence |
| --- | --- | --- | --- |
| `pnpm dev:web --root PATH --database CACHE` (Linux) | Current | The established UI over the dev bridge: capture, edit, classification, priority, statuses, child capture, parent and blocker edits, reorder, status batches, about 50 steps of same-client undo, Settings backup and restore, filters, search, external refresh, remembered preferences | [Routing tests](../scripts/mainClientRouting.test.mjs), [editor tests](../scripts/workspaceEditor.test.mjs); owner-reported high-level smoke on disposable data, no case-level walkthrough |
| `tasks-cli --root PATH --database CACHE` (Linux) | Current | Queries, task, link, undo and purge verbs, init, rebuild, archive, restore, migrate, recover, with retry metadata | [Friendly CLI tests](../src/backend/friendlyCli.test.ts) |
| `tasks-backend --stdio --root PATH --database CACHE` | Current | Every command in [spec/backend/commands.md](../spec/backend/commands.md) on Linux, including reorder, batches and doctor | [Gateway tests](../src/backend/gateway.test.ts), [conformance history](evidence/conformance-history.md) |
| `pnpm dev:native --root ... --database ... --local-profile ...` (Windows) | Current, Windows profile | The established UI with capture, edit, classification, priority, six statuses, latest status undo, filters, search and external refresh | [Native pilot](evidence/windows-native-pilot.md), [restored client](evidence/restored-main-client.md) |
| `tasks-backend --stdio --root ... --windows-task-proof --local-profile ...` (Windows) | Current, Windows profile | 18 commands: five queries, `activity.list`, create, update, six statuses, latest status undo, archive and restore to absent folders, recovery resume | [Update](evidence/windows-update-proof.json), [create](evidence/windows-create-proof.md), [status](evidence/windows-status-proof.md), [copy](evidence/windows-copy-proof.md) |
| `--legacy`, `pnpm dev:tauri`, Android builds | Legacy | The old app and CLI, until cutover | Old specs in git history |

## Open blockers

- **Windows host:** the latest owner-machine launches stopped before the main window appeared. Automated diagnosis is owner-deferred; the next step is a manual launch by the owner. The simplified-create route has no Windows Node/SEA proof yet.
- **Browser walkthrough:** no case-level interaction run exists for the dev:web route. The last attempt stopped before a page opened (missing `libglib-2.0.so.0` on the worker host).
- **Linux desktop:** no Tauri launch on the current engine has been checked; global focus is untested there.
- **Owner acceptance:** no qualifying multi-day owner sessions recorded yet.
- **Migration:** rehearsed on Linux/WSL2 with disposable data only ([runbook](migration-rehearsal.md)). No personal data has been read or converted.
- **Corpus:** 101 of 112 original corpus cases execute in backend tests; the other 11 have no executor.

When support changes, update this table, the platforms table and the evidence together. Never relabel an unsupported case as passed to make documentation agree.
