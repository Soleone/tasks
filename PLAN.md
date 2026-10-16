# Tasks: roadmap

Updated 2026-10-16. This file holds direction, current state, the next step and the gates. The working plan for the cutover cleanup is `$DATA/plans/2026-10-14-tasks-full-cutover-cleanup.md` (stages 0 to 6). The previous detailed roadmap is in git at `f568d2b:PLAN.md`; older milestone history is at `86e3c1b:PLAN.md`.

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
- **Switch everything as soon as possible** (2026-10-16, replaces "Windows parity before cutover" from 2026-10-14). No Windows proof gate: the desktop app moves to the new engine on every OS, the legacy runtime is deleted, and the owner tests the Windows build once it is ready. Global focus is deferred. Windows 11 is the first release platform.
- Themes (2026-10-15): ship the built-in palettes only for now; custom theme imports may come later. The candidate model and its Syncthing probe are dropped (2026-10-15).
- Typed text is kept (2026-10-15): tasks store the shorthand as typed in `text` next to the parsed title, category and tags, so editing shows it unchanged. Changing classification any other way clears it. Schema 2 gains the field without a version bump because no real workspace uses schema 2 yet.
- Tests stay focused (2026-10-15): protect data integrity, tricky rules, process boundaries and known bugs. Prefer representative workflows over exhaustive permutations; don't add tests just to give every spec rule a citation.
- Desktop capture writes a temp file and renames it; a duplicate after a crash between rename and receipt is accepted. Native development is `pnpm dev:native`, the release build `pnpm build:tauri`.
- Personal data: reading, converting or selecting the owner's workspace each need explicit permission at that moment.

## Current state

1. `pnpm dev:web --root PATH --database CACHE` runs the established UI on the current engine over a Linux dev bridge. Every agreed workflow except global focus works there; the owner reported high-level smoke success on disposable data (no case-level walkthrough).
2. `tasks-cli --root PATH --database CACHE` is the friendly CLI on the current engine; JSON lines via `tasks-backend --stdio --root ...`. Neither has a default workspace.
3. The desktop app starts on the current engine (2026-10-16): it opens the remembered task folder, and the first launch asks for one, starts it empty or imports the old version's tasks. Only `dev:web --legacy` and `tasks-cli --legacy` still reach the old code, which is being deleted.
4. Code is named by responsibility. Legacy code lives in `src/legacy/` ([src/LEGACY.md](src/LEGACY.md)), migration in `src/migration/`. The shared UI derives task fields from the current model; legacy field names stay at the old transport boundary. `scripts/check-naming.mjs` keeps version names at zero outside migration and persisted names.
5. The backend allows every command on every desktop OS. On Windows Node, setup (init, import) and the formerly withheld writes were smoke-tested on disposable data. The new desktop app has not been launched by the owner yet; earlier pilot launches stopped before the main window.
6. Import only reads the old version's files and writes a new folder. No personal data has been touched.
7. Spec rules are slugged and checked by `scripts/check-spec-rules.mjs`. Client tests in `src/spec/` render the app over a disposable workspace. Uncited rules are information, not a blanket test backlog.

## Next step

1. **Owner tests the Windows build** (`pnpm build:tauri`), after backing up `%APPDATA%\com.soleone.tasks`. First launch imports the old tasks into a new folder.
2. **Delete the legacy runtime** in parallel: `src/legacy/`, `--legacy`, the Android runtime, legacy tests and fixtures that aren't migration inputs; move `pnpm test:ui` to the current route; adopt the `@soleone/theme` kit (no D hotkey, kit r3) and bump `.kit.json`.
3. Rebuild Windows crash checks for the unified backend (the proof-profile checks were removed).

Kit r1 adoption steps 1 to 3 and the React hook warnings are done (2026-10-16). `src/components/ui` is stock upstream, pending an owner look at the UI.

## Gates

### Owner acceptance

The owner uses the Windows build on their real tasks (imported, old files kept) and reports friction: capture, edit, complete, undo, search, refresh, reopen, keyboard, mouse and focus. Automation counts as zero sessions.

### Cutover

1. Delete `src/legacy/`, `--legacy`, the Android runtime and legacy fixtures that aren't migration inputs. The naming ratchet allows only `src/migration/` and stored names.
2. Adopt the `@soleone/theme` kit: use `tasks.selectedTheme` as its `storageKey` and remove `themePalette.ts` and `builtinThemes.ts` with the backend theme list. No D dark/light hotkey (owner, 2026-10-16; dropped from the registry in kit r3). Then bump `.kit.json`.
3. Never strand pending work or discard receipts, history or retry authority. Keep the old version's files until the owner deletes them.

### Publication

Review the chosen release platforms against the default route, packaging, signing and installer, and record remaining blockers. No blanket release claim and no personal migration implied.

## Working rules

- Each stage or task needs its own go-ahead; stop at its checkpoint. A generic "proceed" covers only the next approved step. SQ readiness is not approval.
- Canonical JSON owns task state. The SQLite cache also owns receipts, history and undo authority, so it isn't disposable: keep root, cache and profile bindings, pending journals, recovery copies and retry envelopes.
- Keep the accepted model rules (literal titles, sparse order keys, timestamp and status rules, done blockers still block) unless a deliberate spec change says otherwise.
- Use disposable data. Track work in SQ with metadata under `pi_tasks`, one writer per directory.
- Run `pnpm check`, `pnpm lint` and `pnpm test`, apply the clean-code checklist, commit validated work, and report unresolved host, contract, tooling or permission blockers instead of working around them.
