# Tasks: previous milestone baseline

**Reviewed:** 2026-09-06

**Status:** M0 complete; M1 in progress. This file preserves the existing decisions and M1/native recovery obligations. The current implemented behavior is described in the [system specification](spec/overview.md); the earlier multi-source-led TaskDB 2.0 roadmap is retained as an aspirational note in [ideas](ideas/taskdb-2.0-roadmap.md). Technical details live in [Development and validation](docs/development.md), with first-party interaction guidance in [Usage and interaction](docs/usage-guide.md).

## Direction

Tasks is a local-first, keyboard-first task app for one person working alongside existing external agents such as pi. Its core loop is:

> capture quickly → clarify → choose today's work → complete it → understand what changed

The UI and standalone CLI use the same typed TypeScript command path. Agents inspect and update the workspace only when explicitly invoked; Tasks is not an autonomous agent platform.

The first release should prove a useful personal workflow rather than become a team tracker or general agent framework.

## Confirmed decisions

- **Core:** TypeScript owns domain rules, validation, commands, and contracts.
- **Desktop:** Tauri 2 with React, Vite, and a thin Rust/native boundary.
- **Runtime:** a bundled Node LTS sidecar runs the TypeScript backend; users do not need Node installed.
- **Storage:** canonical task state is inspectable JSON; SQLite is a local, rebuildable query cache. See [Canonical workspace files](docs/canonical-workspace.md).
- **Agent access:** a standalone local JSON-lines CLI shares the command path and workspace with the desktop app.
- **Platforms:** Windows 11 is the primary native target; Omarchy/Linux is a secondary target.
- **UI foundation:** shadcn/ui with Base UI primitives, Tailwind, and semantic design tokens.
- **License:** MIT.

These decisions should not be reopened without new evidence from implementation, packaging, or real use.

## Scope

### First usable release

- One local workspace with quick capture, editing, completion, reopening, cancellation, and search.
- Inbox and a small daily working set with planning, due, and defer dates.
- Lightweight parent/child tasks and dependencies, with a deliberately shallow first hierarchy surface.
- One optional `@category` and any number of `#tags` parsed from the task title.
- Keyboard-first list/detail UI, discoverable commands, and Markdown notes.
- CLI create/read/update/state commands with structured output, previews, safe retries, and activity history.
- Backups, tested restore, versioned JSON snapshots, and readable task export.

### Deferred

Hosted sync, collaboration, PWA/browser storage, built-in AI or chat, autonomous execution, recurrence, reminders, calendar integration, complex taxonomies, plugins, Obsidian folder sync, and MCP. Do not reserve tables or build adapters for these until daily use provides evidence.

## Milestones

### M0 — Runtime and packaging proof — complete

Prove the TypeScript backend, SQLite/FTS5, CLI, Tauri bridge, bundled sidecar, and process lifecycle. The current evidence includes Linux backend/sidecar probes, native Windows 11 desktop and WSL bridge checks, sidecar recovery, and Windows MSI/NSIS builds. Omarchy native validation remains open.

### M1 — Recoverable vertical slice — in progress

Ship reliable flat-task capture and management over the real command path: activity, classification, optimistic versions, idempotency, previews, backup/restore, JSON export, and conflict handling. Native Windows UI dogfood and restart/restore evidence remain open.

Exit evidence includes UI capture, CLI edits visible without restart, persistence across relaunch, classification updates, stale-write and duplicate-retry tests, rollback/failure tests, and fresh-workspace restore tests.

### M2 — Daily human-and-agent workflow

Add Inbox/Today, dates and deferral, FTS search, keyboard completion for categories/tags, subtasks/dependencies, Markdown export, and visible agent activity. Dogfood for a working week and test dates, graph safety, search consistency, focus, accessibility, and hostile Markdown in actual desktop webviews.

### M3 — Distributable beta

Harden packaging, recovery, upgrade/data retention, documentation, licensing notices, repeatable Windows/Linux builds, and performance measurement on a representative 10,000-task workspace. Signing and public naming are decisions for this milestone.

## Current open items

- Complete M1 native Windows UI dogfood, restart, and restore evidence.
- Finish remaining M2 planning and search work and exercise the relationship slice in daily use.
- Validate themed surfaces and the core workflow natively on Omarchy/Linux.
- Keep the Node/SQLite binding and cross-platform distribution approach pinned to a supported runtime after packaging evidence, rather than relying on developer-machine versions.
- Record native-platform blockers explicitly; browser previews and WSL checks do not substitute for native desktop validation.

## Technical reference

For the implementation contract, consult [Development and validation](docs/development.md), especially:

- process architecture and module boundaries;
- shared command, version, idempotency, and activity rules;
- SQLite/cache, concurrency, sidecar lifecycle, and WSL access;
- backup, restore, import/export, and security expectations;
- required commands and native-platform validation boundaries.

For canonical files, conflicts, and rebuild behavior, consult [Canonical workspace files](docs/canonical-workspace.md). For multi-device operation, consult [Syncthing setup](docs/syncthing.md).
