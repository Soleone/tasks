# Tasks: roadmap

Updated 2026-10-15. This file holds direction, current state, the next step and the gates. The working plan for the cutover cleanup is `$DATA/plans/2026-10-14-tasks-full-cutover-cleanup.md` (stages 0 to 6). The previous detailed roadmap is in git at `f568d2b:PLAN.md`; older milestone history is at `86e3c1b:PLAN.md`.

## Direction

Tasks is a local-first, keyboard-first task list for one person working alongside agents: capture quickly, clarify, choose work, complete it, understand what changed.

- **One application.** One task model and command path for UI, CLI and agents. Tauri 2 and React with a bundled Node backend; MIT license.
- **Keep the established UI.** `App`, `TaskList`, the composer, pickers, toolbar, themes, help and settings, and the keyboard, mouse and focus behavior in [the client spec](spec/client/README.md). No frontend rewrite and no second client.
- **No coexistence.** Legacy code is deleted at cutover. Only the schema 1 reader in `src/migration/` survives, with preserved backups. No compatibility facades, dual writes or adapter frameworks.
- **One spec.** [spec/](spec/README.md) describes the app in three layers. Evidence lives in [docs/evidence/](docs/evidence/README.md).
- **Calm UI.** The list stays primary; technical detail goes to settings, help or the point of need. Tests alone don't establish usability.

## Owner decisions

- Daily-use scope (2026-10-14): capture, edit, complete, delete; classification and priority; filters and search; parents and blockers (done blockers still block, canceled don't); persistent manual order; all-or-nothing bulk status; about 50 steps of same-client undo kept across reopen; backup and restore; global focus shortcut (desktop only); preferences kept across restarts. No new sharing feature. No workflow losses agreed.
- Move completely to the new engine (2026-10-14). Legacy runtime is deleted; schema 1 survives only in the migration tool.
- **Android is dropped until ported** (2026-10-14). The old Android runtime is deleted at cutover; Android returns later as its own project on the new engine.
- **Windows parity before cutover** (2026-10-14). Child capture, parent and blocker edits, reorder, batch status and general undo must work and be proven on Windows first. Windows 11 is the first release platform.
- Themes (2026-10-15): ship the built-in palettes only for now; custom theme imports may come later. The candidate model and its Syncthing probe are dropped (2026-10-15).
- Typed text is kept (2026-10-15): tasks store the shorthand as typed in `text` next to the parsed title, category and tags, so editing shows it unchanged. Changing classification any other way clears it. Schema 2 gains the field without a version bump because no real workspace uses schema 2 yet.
- Tests stay focused (2026-10-15): protect data integrity, tricky rules, process boundaries and known bugs. Prefer representative workflows over exhaustive permutations; don't add tests just to give every spec rule a citation.
- Desktop capture writes a temp file and renames it; a duplicate after a crash between rename and receipt is accepted. Native launch is `pnpm dev:native`.
- Personal data: reading, converting or selecting the owner's workspace each need explicit permission at that moment.

## Current state

1. `pnpm dev:web --root PATH --database CACHE` runs the established UI on the current engine over a Linux dev bridge. Every agreed workflow except global focus works there; the owner reported high-level smoke success on disposable data (no case-level walkthrough).
2. `tasks-cli --root PATH --database CACHE` is the friendly CLI on the current engine; JSON lines via `tasks-backend --stdio --root ...`. Neither has a default workspace.
3. `--legacy` reaches the old app and CLI. Native desktop and Android builds still start the legacy app until cutover.
4. Code is named by responsibility. Legacy code lives in `src/legacy/` ([src/LEGACY.md](src/LEGACY.md)), migration in `src/migration/`. The shared UI derives task fields from the current model; legacy field names stay at the old transport boundary. `scripts/check-naming.mjs` keeps version names at zero outside migration and persisted names.
5. Windows native runs the established UI on a smaller proven command set: capture, edit, priority, six statuses, latest status undo. Child, relationship, order, batch and general undo are withheld there. The gap list is [spec/client/platforms.md](spec/client/platforms.md).
6. The latest owner-machine Windows launches stopped before the main window appeared. Automated Windows diagnosis (`100`) is owner-deferred.
7. Migration from schema 1 is rehearsed on Linux/WSL2 with disposable data ([runbook](docs/migration-rehearsal.md)). No personal data has been touched.
8. Spec rules are slugged and checked by `scripts/check-spec-rules.mjs`. Client tests in `src/spec/` render the app over a disposable workspace. Uncited rules are information, not a blanket test backlog.

## Next step

Kit r1 adoption (owner request, 2026-10-16) runs in three steps before stage 5: (1) knip in `pnpm lint`, dead code removed and the accepted prune findings applied: done; (2) the Vite+ toolchain (`vp check`, `vp lint`, `vp test`, oxfmt): done; (3) stock shadcn files with local fixes moved to wrappers, then the `@soleone/theme` kit. Each step needs its own go-ahead; step 3 needs an owner look at the UI. `.kit.json` tracks the revision.

Cleanup stage 4 refactoring (approved 2026-10-15) is complete and validated. `TaskListRows.tsx` and `TaskListToolbar.tsx` own presentation; `useTaskListSelection.ts` and `useTaskListKeyboard.ts` own selection and shortcut dispatch. `useWorkspaceTasks.ts` owns workspace queries and visible-task membership; `useWorkspaceActions.tsx` owns command-result handling and undo. `App.tsx` retains preferences, dialogs and focus wiring. Legacy-only branch removal still waits for cutover. Stop at this checkpoint: stage 5 (Windows parity) needs the owner's Windows entry gate and a separate go-ahead; automated diagnosis (`100`) remains deferred.

## Gates

### Windows (stage 5, before cutover)

1. The owner manually reaches the main Tasks window on Windows. This unblocks everything else; `100` stays paused.
2. Then, one family at a time: sidecar and permissions route, close and relaunch, durable preferences, original-request recovery, the simplified-create Node/SEA proof ([pending](docs/evidence/windows-create-proof.md#simplified-route-proof-pending)), child capture, parent and blocker edits, reorder, batch status, general undo, global focus, friendly CLI writes.
3. Never attach to or stop owner sessions, inspect personal windows or data, change permissions or install runtimes without permission. No silent allowlist expansion.

### Owner acceptance

At least three short owner sessions over two days on realistic disposable data, after the Windows entry gate: capture, edit, complete, undo, search, refresh, reopen, plus keyboard, mouse, focus and retry friction. Automation counts as zero sessions.

### Cutover (stage 6)

1. Migrate the owner's workspace with the schema 1 converter into a separate root, with verified backups, only with explicit approval at that moment.
2. Delete `src/legacy/`, `--legacy`, the Android runtime and legacy fixtures that aren't migration inputs.
3. Close the `platforms.md` gap rows; the naming ratchet allows only `src/migration/` and stored names.
4. Prove restart and recovery on the default route on Linux and Windows with disposable data, then with the real workspace. Never strand pending work or discard receipts, history or retry authority.

### Publication

Review the chosen release platforms against the default route, packaging, signing and installer, and record remaining blockers. No blanket release claim and no personal migration implied.

## Working rules

- Each stage or task needs its own go-ahead; stop at its checkpoint. A generic "proceed" covers only the next approved step. SQ readiness is not approval.
- Canonical JSON owns task state. The SQLite cache also owns receipts, history and undo authority, so it isn't disposable: keep root, cache and profile bindings, pending journals, recovery copies and retry envelopes.
- Keep the accepted model rules (literal titles, sparse order keys, timestamp and status rules, done blockers still block) unless a deliberate spec change says otherwise.
- Use disposable data. Track work in SQ with metadata under `pi_tasks`, one writer per directory.
- Run `pnpm check`, `pnpm lint` and `pnpm test`, apply the clean-code checklist, commit validated work, and report unresolved host, contract, tooling or permission blockers instead of working around them.
