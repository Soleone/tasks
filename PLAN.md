# Tasks: kickoff plan

**Reviewed:** 2026-09-06

**Status:** M0 complete. Backend and sidecar probes pass on Linux, Windows tests and the packaged Windows sidecar pass, the native Windows 11 long-lived desktop probe and WSL CLI bridge pass with the app open and closed, sidecar recovery passes, and Windows MSI/NSIS release bundles build successfully. Omarchy remains a later secondary target.

**Origin:** Review of the `2026-09-06-agentic-todo-app.md` concept brief. This file is the implementation plan of record.

## Review verdict

Keep the original direction: a coherent, keyboard-first, local-first task app with SQLite and a typed command surface. The strongest idea is shared access for people and agents, not a particular file format or a built-in chatbot.

The brief needed four adjustments before kickoff:

- **Narrow the promise.** Prove a useful personal workflow and one external-agent integration before adding a broad task-management feature set.
- **Name the runtime.** Tauri does not provide a Node backend. A TypeScript core needs a packaged runtime for desktop and headless use; that cost must be tested early, not hidden behind an adapter diagram.
- **Make trust concrete.** Stale-write protection, safe retries, visible changes, and tested recovery belong in the first durable slice.
- **Sequence the work.** Prove packaging first, then persistent capture, then daily planning and task relationships. Browser storage, sync, and MCP are later work.

## Confirmed decisions

The owner confirmed **TypeScript core**, **external agents first**, and **MIT licensing** during this review.

- Windows 11 and Omarchy/Linux are the initial desktop targets.
- Tauri 2 with React, TypeScript, and Vite. React Router when the navigation needs routes.
- shadcn/ui with the Base UI primitive base, Tailwind, and semantic design tokens.
- TypeScript owns domain rules and application commands. Rust stays at the Tauri/native boundary unless measured work justifies more.
- SQLite is canonical; descriptions are Markdown text. JSON and Markdown provide portability, not competing sources of truth.
- The first agent interface is a standalone local CLI using the same commands as the UI. No built-in model or account is required.
- A future PWA should reuse domain rules and contracts, but browser storage and runtime adapters are not MVP deliverables.

## Product wedge and scope

**Working audience:** an individual who manages personal and project work alongside existing agents such as pi. This is not initially a team issue tracker or an agent execution platform.

**Core loop:** capture a thought quickly, clarify it into actionable tasks, choose today's work, complete it, and understand what a human or agent changed. Existing agents can inspect and update the same workspace without silently overwriting newer work.

The first usable release should support:

- One local workspace/database, quick capture, editing, completion/reopening, and search.
- An inbox and a small daily working set, with explicit planning, due, and defer dates.
- Lightweight subtasks and dependencies, added after the flat-task slice is reliable.
- One optional workspace-wide `@category` per task and any number of `#tags`. These are typed in the task text, parsed into derived metadata, and shown quietly under the main text for filtering and quick scanning.
- A keyboard-friendly list and detail surface, discoverable commands, and useful Markdown notes. Start with a simple editor; add CodeMirror only if editing needs justify it.
- A headless CLI with structured output, read-only operation, mutation previews, safe retries, and readable activity history.
- Backup/restore and versioned JSON export/import. Markdown export is a readable view, not a lossless database round-trip.

**Not required for this release:** hosted sync, collaboration, PWA, built-in AI/chat, autonomous execution, recurrence, reminders, calendar integration, nested or complex project taxonomies, plugins, Obsidian folder sync, or MCP. Do not reserve tables or build frameworks for them. Add a feature when the daily workflow supplies evidence for it.

## Runtime and architecture

### Proposed starting point, to validate in M0

Bundle a supported Node LTS runtime with compiled JavaScript and resource files. It runs the TypeScript application layer and SQLite adapter outside the webview. Users should not need Node installed. Single-executable packaging is an option, not an architectural requirement.

Evaluate `node:sqlite` first to avoid a separate native addon. Record its stability/support status in the chosen Node release and verify FTS5, transactions, backup, and packaged behavior. If unsuitable, assess a maintained SQLite binding and prove its native packaging before adopting it. Pin the runtime, driver, and packaging approach after the spike, not based on the developer machine's installed versions.

```text
React UI (TypeScript)
  -> typed Tauri bridge
  -> thin Rust process/lifecycle boundary
  -> bundled Node sidecar (framed JSON over stdin/stdout)
       -> TypeScript commands and domain rules
       -> SQLite adapter -> local database

Standalone CLI (same bundled runtime and application modules)
  -> the same TypeScript commands and SQLite adapter
  -> the same database, even with the desktop app closed
```

Use one long-lived sidecar for the desktop session; do not spawn Node for every interaction. The CLI may run in its own process. Shared implementation does not require a resident daemon or a localhost HTTP server. The desktop bridge now uses the JSON-lines `--stdio` session, with request correlation, malformed-response handling, restart-on-next-request behavior, and shutdown cleanup. The one-shot `--probe` path remains useful for direct packaging checks.

Keep these boundaries small:

- **Domain/contracts:** task rules, runtime input schemas, command/query types, and stable errors. No Tauri, Node, DOM, or database imports.
- **Application/storage:** authoritative validation, transactions, SQLite queries, migrations, activity, and idempotency. Only this layer writes task data.
- **Adapters:** UI transport, CLI argument/JSON handling, and native lifecycle/file integration. No duplicate business rules in Rust or React.

Start with modules in one repository; separate packages only when the build or distribution actually needs them. Do not introduce a generic repository framework. Share transport schemas and validate at process boundaries; TypeScript types alone do not validate incoming JSON.

### Concurrency and lifecycle

- UI and CLI resolve the same platform-specific app-data path, independent of the working directory. An explicit workspace-path override serves tests and alternate workspaces; it is not exposed as unrestricted renderer file access.
- Use SQLite foreign keys, short transactions, a bounded busy timeout, and WAL on a local filesystem. WAL still permits only one writer at a time. Verify the bundled SQLite includes the WAL-reset fix, present in 3.51.3 and later or an applicable backport.
- Keep the database out of live network/shared-folder/cloud-file sync. Moving snapshots is different from syncing an open database.
- A committed activity sequence can drive lightweight polling and query invalidation for CLI changes. Refresh on focus as well. An open detail editor must surface a conflict rather than replace unsaved text.
- Handle sidecar exit, malformed messages, timeouts, shutdown, and restart visibly. Correlate requests; keep protocol output on stdout and diagnostics on stderr. Do not replay uncertain writes without their original idempotency key.
- Synchronous SQLite work is acceptable in the separate backend process initially. Keep work bounded and off the UI thread; introduce workers only if measurement calls for them.

### WSL agent access

When the desktop app is running on Windows and an agent is running inside WSL, the WSL CLI must invoke the Windows SEA sidecar rather than open the Windows database from a Linux process over `/mnt/c`. The repository's `bin/tasks` wrapper resolves the Windows ApplicationData path, invokes the Windows sidecar, and passes the database path explicitly. `TASKS_WINDOWS_ROOT`, `TASKS_WINDOWS_SIDECAR`, and `TASKS_WINDOWS_DATABASE` provide local checkout and test-workspace overrides. This keeps both clients on Windows SQLite/file-locking semantics and avoids treating a cross-environment filesystem mount as a supported database transport.

### Browser path later

Keep the UI's command client replaceable and domain code runtime-independent. A browser version will still need a real execution/storage adapter, potentially browser SQLite/OPFS or IndexedDB, plus conformance tests. TypeScript reuse does not make Node APIs browser-compatible. Browser previews with test fixtures are not evidence of PWA support.

### Information density and focus

The main task surface should carry a lot of useful information without becoming a dashboard of competing signals.

- Keep task rows compact and scannable: main title/content first, then a muted metadata line for category and tags. Avoid a separate card or large control for every attribute.
- Prefer a focused screen over unnecessary scrolling, but do not compress every detail into the default view. Secondary information can appear on focus, in the detail pane, or through search/filter commands.
- Classification should be visually quiet: `@category` first, then `#tag` values in smaller muted text or restrained data attributes. Do not rely on color alone, and do not make every token a loud pill.
- Keyboard focus, selection, and hierarchy should remain obvious when the surface is dense. Use progressive disclosure instead of adding noise to every row.

### Appearance and themes

Themes are palettes in the omarchy `colors.toml` format. Components consume only region tokens; `src/styles.css` maps palette slots onto them, and `src/backend/themePalette.ts` parses and resolves palettes for the backend, CLI, and UI alike. Selection happens in the Ctrl/Cmd+K palette or through `theme.list`/`theme.set` on the shared command path, and the choice is stored in a `settings` table in the workspace database, so the CLI and agents see it too.

- Built-in themes are embedded `colors.toml` bodies, so the packaged sidecar needs no theme assets and a port stays copy-pasteable into a workspace.
- User themes are `.toml` files in a `themes/` folder beside the database; they appear in the picker and override built-ins by name. A theme may set any subset of slots, and unset slots fall back to the neutral ramp for its mode, so the built-in Default theme ships no palette at all and follows the system appearance.
- Palette values come from theme authors, so roles that carry text are corrected toward readability: secondary ink is mixed toward the body ink until it clears 4.5:1 on every surface it can sit on, and ink on an accent fill is the theme's own darkest or lightest stop. A theme whose accent cannot reach 4.5:1 keeps its author's color and is held to the 3:1 non-text floor instead.

## Minimum data model

This is a starting schema sketch, not a request to build every field in M0. Use migrations as each milestone introduces behavior.

| Record | Minimum shape | Introduce |
| --- | --- | --- |
| `tasks` | UUID `id`, non-empty `title`, `description_markdown`, `status`, nullable derived `category_id`, integer `version`, UTC `created_at`/`updated_at`, nullable `completed_at` | M1 |
| `categories` | Workspace-wide stable ID, normalized unique slug, display label, created/updated timestamps | M1 |
| `tags` and `task_tags` | Normalized unique tag slug/label and a unique task-to-tag join | M1 |
| `activity` | Monotonic `seq`, task ID, command/request ID, actor kind and label, timestamp, changed fields with before/after values | M1 |
| `command_receipts` | Unique client/idempotency key, canonical request hash, committed result | M1 |
| Migration history | Applied schema versions; reject unsupported newer schemas | M1 |
| Planning fields | Nullable `planned_for`, `due_on`, `defer_until` | M2 |
| Task relationships | Nullable `parent_id`; dependency edges `(task_id, depends_on_id)` with unique pair and foreign keys | M2 |
| FTS5 index | Derived title/description index, maintained with task writes and rebuildable | M2 |

Initial state semantics:

- Persist `open`, `in_progress`, `paused`, `done`, and `canceled`. Active tasks can start, pause, complete, or cancel; terminal tasks can explicitly reopen to `open`. Repeated transitions are no-ops, not extra activity.
- `completed_at` is present only for `done`. Every real mutation increments `version`; the backend sets timestamps and IDs.
- Inbox, Today, overdue, deferred, and blocked are views/conditions, not additional statuses.
- Start with date-only planning: `planned_for` means intended work date, `due_on` means deadline, and `defer_until` hides work from ready views until that local calendar date. Store valid `YYYY-MM-DD` values without UTC conversion. Timestamps remain UTC; recurrence and timed scheduling wait.
- Surface unfinished past plans and overdue deadlines without silently rescheduling them. Deferred tasks remain discoverable in all/search views, and deferral must not conceal an overdue warning.
- Parent links organize work; dependency links constrain readiness. Reject self-links and cycles in each graph in the same transaction as the change. Do not silently cascade completion or cancellation. A canceled prerequisite does not count as completed; make that unresolved dependency visible.
- The task text is canonical for classification. On create/update, parse plain text and reconcile the derived category/tag tables in the same transaction. Normalize lookup slugs case-insensitively while preserving a readable label. There is at most one `@category`; multiple category tokens produce a clear validation error rather than an arbitrary choice. `#tags` may repeat in text but store only one join per tag.
- Begin with names made of letters, numbers, `_`, and `-`. Do not treat Markdown headings, URLs, email addresses, code spans, or fenced code as tags/categories. Revisit the grammar only when real task text shows a need.
- The list's Delete key opens confirmation with Enter to mark one task `canceled`; the task, tags, and activity remain available, and it can be reopened. The `task.delete` command keeps its name for that keyboard contract, requires an expected version and idempotency key, and supports read-only/dry-run previews. No bulk destructive command.

## Command and agent contract

Start with create, get/list, update, complete, reopen, cancel, and activity queries. Add plan/defer/link/search as their behavior ships. A small set of well-defined commands is better than exposing speculative verbs such as an ambiguous `task.schedule`.

- Use a versioned JSON envelope with a request ID, command, arguments, and actor/client identity. Publish its runtime schemas and examples alongside the CLI.
- CLI JSON mode accepts structured input through stdin and emits one structured result to stdout. Diagnostics go to stderr; failures have stable error codes and nonzero exit status. List/search queries have deterministic ordering and bounded pagination.
- Every mutation has an idempotency key; editing existing tasks also requires an expected version. The UI generates these too.
- Check for a prior successful receipt before checking the current task version. Repeating the same key and payload returns the original result without another mutation; reusing the key for a different payload is an error.
- Commit the task change, activity entry, and successful receipt in one transaction. Reject stale versions explicitly. Do not silently retry a conflict against a newer version.
- Provide read-only mode and `--dry-run` previews. Dry runs perform validation and show intended changes but persist nothing, including activity or receipts. A preview is not a reservation; execution revalidates against current data.
- Agent writes are explicitly invoked by the external tool/user, not an app-run autonomous loop. No elaborate proposal/approval subsystem is needed initially. In a read-only session, proposed changes stay outside the database until an authorized write is invoked.
- Actor labels are provenance, not authentication or tamper-proof auditing. A process with the user's OS permissions is not sandboxed by this API. Read-only mode is a command-surface guarantee, not protection against arbitrary local malware.

MCP can later be a thin adapter over this contract. It does not need its own command semantics or storage access.

## Recovery, portability, and security

- Provide a consistent SQLite backup using the backup API or `VACUUM INTO`; never just copy the main file of a live WAL database. Back up before schema upgrades and let the user create a backup on demand.
- Test restore before trusting the app with valuable tasks. Validate a snapshot in a new location before switching to it. Migration and restore need exclusive workspace access and should fail clearly if another client is using it; ordinary commands must not upgrade a schema underneath another process.
- JSON snapshots are versioned and preserve canonical records, including IDs, versions, relationships, history, and receipts. Derived indexes can be rebuilt. Initially import into a new/empty workspace; defer merge semantics. Markdown export prioritizes readable tasks and notes and documents what it omits.
- A portable tasks export (`workspace.exportTasks`, format `tasks.tasks-export` v1) gives other apps a readable JSON view: camelCase tasks carrying the typed `@category`/`#tag` slugs, notes Markdown, and timestamps, without internal concurrency state. The backend resolves the destination itself, `exports/tasks-<UTC stamp>.json` beside the database, and never overwrites an earlier export; a renderer never supplies filesystem paths. `workspace.info` reports the database path and task count read-only. The lossless snapshot and `workspace.backup` remain the restore and backup path.
- Migration failure must leave the previous database usable or recoverable from a tested backup. An older CLI refuses an unsupported newer schema rather than attempting writes.
- Treat Markdown and imported files as untrusted input. Disable raw HTML or sanitize it, validate external link schemes, and avoid automatic remote-resource loading. Do not pass task text to a shell.
- Restrict Tauri access to the fixed sidecar and required native capabilities. No arbitrary shell/SQL interface, remote-content privileges, or unauthenticated network listener. Account for custom-command permissions, not just plugin permissions.
- No telemetry or network dependency is needed for the core workflow. Local storage is not encryption; rely on OS file permissions initially and make that limitation clear. Debug logs should not dump task content by default.

## Milestones and exit evidence

### M0: Prove the TypeScript runtime and packaging

**First work item.** Set up minimal Tauri/Vite and a TypeScript backend probe, not the full task UI. Package the runtime, run a SQLite transaction and FTS5 query, and exercise the same command from the Tauri bridge and CLI. The backend, CLI, Linux sidecar, native Windows 11 desktop probe, WSL bridge, lifecycle recovery, and Windows release bundles now pass.

The primary native target is the Windows 11 host. WSL is useful for backend and packaging checks but is not the desktop acceptance environment. Omarchy is a secondary target to validate after the core workflow has a stable milestone, not a reason to delay the first Windows build.

Exit evidence:

- Packaged desktop and headless CLI run on Windows 11 without a system Node installation. A WSL-only result does not satisfy the native desktop check.
- Both clients find the same test database; the CLI works with the app closed. Concurrent access, lock timeout, and sidecar crash/restart behavior have explicit results.
- Record runtime/driver versions, SQLite features, package size, cold startup, idle memory, and packaging commands. Select and pin the supported distribution approach.
- If a target cannot be tested or packaging fails, keep the gate open and record the blocker. Revisit the packaging approach without silently replacing the confirmed TypeScript core.

### M1: Ship a recoverable vertical slice

Build flat-task capture, list/detail, editing, completion/reopening/cancellation, activity, classification extraction, and the standalone CLI over the same real command path. Include one optional `@category`, multiple `#tags`, a compact metadata footer, conflict handling, idempotency, read-only/dry-run behavior, backups, and JSON restore/export before adopting it for personal data.

Exit evidence:

- Capture in the UI, edit from the CLI, observe the change without restarting, and reopen the app with the same persisted data.
- A task such as `Prepare @todo-app launch #planning #product` yields one category and two tags in list/search results, and editing the text updates the derived metadata without stale labels.
- Automated tests cover token boundaries, Markdown false positives, multiple categories, stale writes, duplicate retries, key reuse with different payloads, transaction rollback, busy storage, and schema compatibility. Test against file-backed SQLite, not only mocks or in-memory databases.
- Exercise failure after commit but before reply; retrying does not duplicate the task or history. Dry runs/read-only requests leave all tables unchanged.
- A populated backup and JSON snapshot restore into a fresh workspace with matching canonical records. Migration and restore tests include failure paths.

### M2: Prove the daily human-and-agent workflow

Add Inbox/Today, explicit dates and deferral, FTS5 search, keyboard completion for existing/new categories and tags, subtasks/dependencies, Markdown export, and visible agent activity. Preserve keyboard focus and unsaved edits across refreshes. Keep hierarchy and status readable without relying solely on color, and use dogfooding to ensure dense rows stay calm rather than noisy.

Exit evidence:

- Dogfood for a working week, including capture, planning, completion, a deferral, an external-agent edit, a stale-edit rejection, and a restore drill. Record friction before adding more features.
- Test date boundaries/timezone changes, graph cycles and concurrent graph edits, search-index consistency, focus behavior, and hostile Markdown.
- Test keyboard-only use, accessible labels, contrast, text scaling, and the empty/error/conflict states in the actual desktop webviews. Browser automation complements native checks, not replaces them.

### M3: Prepare a distributable beta

Harden packaging and recovery, publish CLI/schema examples and backup instructions, and produce repeatable Windows/Linux builds. Include MIT and dependency/runtime redistribution notices. Decide public naming and Windows signing/distribution details before public release; automatic updates can wait.

Exit evidence:

- Clean-machine install, launch, CLI discovery, upgrade, data retention, and uninstall behavior are checked on both targets. Uninstall does not silently erase the workspace.
- Benchmark a representative 10,000-task workspace on named hardware. Starting goals: warm edits feel immediate (roughly 100 ms), indexed search responds within roughly 150 ms, and cold launch is usable within roughly two seconds. Treat these as hypotheses until baselined; include the sidecar in memory/startup measurements.
- Bound queries and render work first; virtualize when list/tree size requires it and verify keyboard/accessibility behavior. No extra cache, Rust rewrite, or worker framework without evidence.

## Current readiness and open items

The repository now has a Vite/React shell, TypeScript backend, JSON-lines CLI, SQLite/FTS5 probe, Tauri shell configuration, and a Linux Node SEA sidecar. No full implementation milestone has passed.

- The local environment is WSL2/Ubuntu 26.04, with Node 22.22.3, pnpm 11.22.0, and Rust/Cargo 1.96.0 available. These are observations, not pinned project requirements.
- `pnpm check`, `pnpm test`, `pnpm build`, and the target Linux SEA sidecar probe pass locally. Tests now cover a bounded SQLite writer conflict and restarting the compiled CLI against the same database. The SEA executable runs with a minimal environment and no system Node on `PATH`.
- The current Linux SEA sidecar is 124,914,880 bytes (about 120 MiB) and its probe takes about 20–30 ms on this WSL host. Treat that size and timing as an early packaging observation, not a release target.
- `node:sqlite` reports the experimental-feature warning on Node 22.22.3. Keep the binding decision open until a supported runtime and cross-platform package are proven.
- Native Tauri compilation in WSL remains blocked by missing `libdbus-1-dev` before the WebKitGTK checks. This is not blocking the primary Windows path.
- The first native Windows 11 run succeeded from the Developer Command Prompt. It reported Node `v24.19.0`, SQLite `3.53.3`, WAL, FTS5, one match, and database path `C:\Users\soleone\AppData\Roaming\com.soleone.tasks\tasks.db`.
- Windows validation passes: `pnpm test` reports 6/6, `pnpm test:sidecar` builds and probes the `x86_64-pc-windows-msvc` SEA sidecar, the native desktop `--stdio` bridge reports Node `v24.19.0`, SQLite `3.53.3`, WAL, FTS5, one match, and the expected app-data path, and `bin/tasks` succeeds from WSL with the app open and closed. Killing the packaged sidecar is recovered by the next desktop probe. `pnpm build:tauri` produces both `Tasks_0.1.0_x64_en-US.msi` (38.2 MB) and `Tasks_0.1.0_x64-setup.exe` (25.7 MB); the MSI installs and launches successfully on Windows 11. Omarchy access and validation can follow the stable M1/M2 workflow; do not claim a cross-platform pass from WSL or a browser preview.
- M1 implementation is underway: the shared backend now supports task CRUD/state transitions, classification, activity, optimistic versions, idempotency, previews, backup, JSON export/restore, and schema/failure tests. Native Windows UI dogfood and restart/restore evidence remain open.
- The React shell was reset to a keyboard-first minimal surface after owner review of the old dashboard-style UI: title capture where Enter saves, Tab reveals and focuses an optional Markdown description when the title has content, and otherwise moves to the task list, Ctrl/Cmd+Enter saves from either field, leaving an empty description hides it, Escape returns to the title, and Escape in the edit title goes back to the list, Ctrl/Cmd+K opens a searchable palette of shortcuts, syntax (@category/#tags), and themes; it re-reads the theme list every time it opens because theme files can appear or disappear while the app runs. Tab is trapped in a tight cycle, title, description, task list, back to title, and never leaves the app. The task list is one tab stop navigated with Up/Down (Home/End jump, Enter opens, Escape returns to the title); the Add-task and Add-description buttons stay clickable but outside the Tab order because Enter and Tab already cover them, and the header's Help and Settings icon buttons (a shadcn button group with tooltips) stay outside it too, with Ctrl/Cmd+K and a palette Settings entry covering the keyboard. Saved tasks open a focused editor that hides capture and the list. The task list now shows a colored status icon; Space cycles open, in-progress, paused, and done, while Delete confirms cancellation and keeps the row visible. `pnpm test:ui` covers these keyboard flows, the Tab cycle and arrow navigation, status cycling, focus return, stale-edit conflict retention, lost-reply receipt retry, theme selection from the palette, a workspace theme file joining the picker, theme persistence across reloads, validation, reload persistence, responsive overflow at 1280/390/320 px, and axe against a scratch database and again under a ported theme; it requires agent-browser with Linux Chromium.
- Theming landed as a palette-format slice: `src/backend/themePalette.ts` parses omarchy `colors.toml` (legacy aliases, warnings), resolves the region ramp, and corrects text roles toward readability; `src/backend/themes.ts` embeds seven omarchy ports plus the neutral Default, reads `themes/*.toml` beside the database, and serves `theme.list`/`theme.set` with the selection in a `settings` table that stays schema version 1 because an added table does not invalidate older readers. The UI applies a palette as `--om-*` slots on `<html>`, caches the last theme in localStorage to avoid a pre-paint flash, and lists themes in the Ctrl/Cmd+K palette. Backend tests cover parsing, resolution, contrast floors, discovery, override, persistence, dry-run, and unknown names; `pnpm test:ui` covers selection, a workspace theme file, persistence across reloads, and axe under a ported theme. Native webview checks of the themed surfaces remain open with the rest of the desktop validation.
- Data transparency landed as a settings slice: the header's text Help button became an icon-only button group (Help, Settings) with shadcn tooltips, and a Settings dialog's Data section shows the workspace database path and exports tasks as portable JSON beside the database through `workspace.exportTasks`, reporting the written path with a copy action. The Ctrl/Cmd+K palette uses a custom per-word scorer so a typed query matches rows verbatim instead of fuzzy-subsequence matching, and a Settings entry opens the same dialog by keyboard. Backend tests cover the export shape, destination, no-clobber, and dry-run; `pnpm test:ui` covers opening the dialog by mouse and by palette, the export file on disk, and focus return.
- The dev-only HTTP bridge now runs the command before writing response headers and destroys half-written responses, so rejected mutations (for example stale versions) answer with protocol errors instead of crashing the bridge mid-session.
- Fast UI iteration no longer needs the Tauri shell: `pnpm dev:web` runs Vite plus a dev-only HTTP bridge (`src/backend/devServer.ts`) over the same commands and SQLite storage. The bridge is iteration tooling only: it binds 127.0.0.1, rejects non-local origins, is never packaged, and is not PWA/sync evidence. `dev:tauri` now skips the SEA rebuild when backend sources are unchanged. The "Browser preview" header marker was removed at the owner's request; the page looks the same in both modes.
- Runtime packaging and the SQLite binding are M0 decisions. Product naming and release signing are later decisions, not reasons to delay the current backend work. License and core-language choices are settled.

## Technical references

- [Tauri architecture](https://v2.tauri.app/concept/architecture/), [Node sidecars](https://v2.tauri.app/learn/sidecar-nodejs/), and [external-binary packaging](https://v2.tauri.app/develop/sidecar/)
- [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) and [capabilities, including custom commands](https://v2.tauri.app/security/capabilities/)
- [Node LTS SQLite API](https://nodejs.org/docs/latest-v24.x/api/sqlite.html) and [single-executable packaging](https://nodejs.org/docs/latest-v24.x/api/single-executable-applications.html), if selected
- [SQLite WAL behavior and fixes](https://sqlite.org/wal.html) and [consistent backups](https://sqlite.org/backup.html)
