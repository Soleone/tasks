# Tasks: direction and delivery plan

**Reset:** 2026-09-30. **Current decision:** develop a portable, single-directory TaskDB contract through specs and conformance, with Tasks as its first-party app. A public standard is a goal to earn through an independent implementation, not a claim about the current v1 format. The opt-in multi-source v1 controller remains supported as a bounded prototype, but external adapters, a combined-source UI, and cross-source moves are not the next milestones. Do not alter v1 data before an opt-in, reversible migration is proven.

## Where we are

- M0 runtime proof is complete. The app has more implemented features than the old M1 scope, but M1 native UI/restart/restore acceptance is still open. Feature presence does not close that gate.
- V1 canonical files, command/CLI behavior, and the limited Node-only source controller remain the implemented root [spec/](spec/overview.md). The single-root [v2 contracts](spec/v2/overview.md) are now **accepted targets, not implemented**, with declarative fixtures. [Ideas](ideas/overview.md) preserves proposal reasoning and bounded model/transport evidence; it is not a second normative authority.
- On 2026-09-30 in WSL2, `pnpm check`, `pnpm test` (118/118), `pnpm test:sidecar`, and `pnpm lint` passed. The Linux SEA probe emitted `.note` injection warnings but both executables ran. This is not native Windows, Omarchy, or Android acceptance. See [conformance](spec/conformance.md) and [the v1 audit](docs/taskdb-audit.md) for the limits of prior evidence.
- The previous multi-source-led [TaskDB 2.0 roadmap](ideas/taskdb-2.0-roadmap.md) records completed audit/controller work, but its stages 4–7 are superseded as the implementation sequence. Preserve those results; do not start an external adapter just because it is the next unchecked box.

## Next gates

1. **Settle v2 safety decisions in ideas.** Specify collection identity and first-time merge (including duplicate task IDs), file layout and deletion semantics, v1-to-v2 migration/rollback with mixed-version refusal, canonical category/tag/title compatibility, timestamp/undo/activity behavior, and the public command boundary. Keep one owner per contract; cross-link rather than repeat rules.
2. **Prove sync and order candidates on disposable roots.** Test independent offline captures, equal-key inserts, conflicting reorders, same-task edits, external-file races, missing files, crash/retry, and conflict-copy preservation. Select an exact sparse-key algorithm/comparator and a recoverable merge policy. A local observed-file hash is a stale-write check, not an atomic cross-device compare-and-swap.
3. **Promote accepted decisions to a versioned `spec/v2/` contract before implementation.** Give each contract explicit status (`accepted target` until implemented), normative examples, failures, backward-compatibility rules, and black-box fixtures. `spec/` is the accepted contract; `ideas/` is the matching proposal workspace. Existing root `spec/*.md` remains the current v1 reference. Do not label target behavior as shipped until conformance passes.
4. **Build one recoverable v2 slice only after the contract and fixtures exist.** Keep old v1 readers/writers safe, back up and validate migration/restore on scratch data, and exercise the same contract through Node CLI and Android or document an intentional platform limitation. No second writable authority or silent data loss.
5. **Complete native evidence in parallel on capable hosts.** Windows 11 UI dogfood/relaunch/restore, Omarchy webview/focus, and Android SAF process-lifecycle/provider checks remain open. WSL, Chromium, and emulator standard-picker checks do not close their respective native or physical-provider gates. Use [development instructions](docs/development.md) and the [v1 audit](docs/taskdb-audit.md).

**Gate progress (2026-10-02):** proposal reconciliation and bounded ordering/transport design gates are complete; versioned v2 target contracts and a declarative corpus of 112 cases plus a full-field v1 mapping golden root now exist. Corpus integrity is not execution of those cases. Gate 4 is in progress, starting with an isolated strict read-only Node filesystem helper and execution of the model fixtures. An explicit opt-in Node JSON-lines subset now supports info/get/list/category/tag without v1 watcher/registry fallback. On Linux it additionally supports guarded single-task content updates/previews, local SQLite receipts/activity, a shared-profile physical-root lock/immutable pending intent and explicit published-intent recovery. Disposable WSL2 tests include real subprocess kills after staging/replacement, before/after receipt commit, historical replay, cache loss and divergent/missing/partial/scope-arrival refusal. Windows/Android writable commands are withheld; malformed/unpublished local intent and different-cache recovery require inspection/reconciliation. The Linux stage-only copy primitive remains available as component evidence. Public opt-in `workspace.archive`/`workspace.restore` now add fixed byte-bearing copy intents, durable prefix/binding evidence, verified publication, SQLite receipt replay and explicit copy recovery. Both archive/restore CLI paths pass all 0–5 file prefixes, verification/reservation/publication, receipt/lost-reply and retirement cuts. Published targets remain locally pending until receipt completion; selection never changes automatically. Unbound directory creation, malformed/partial evidence, missing recorded files and changed bindings require preserved inspection, not guessed ownership or repair. A strict read-only v1 converter now checks complete source records/hashes/graphs/orders and returns deterministic v2 bytes in memory; it matches the independent full-field golden byte-for-byte and checks eight adapted mapping/invalid-source vectors. Converter subprocess kills and late source changes produce no publication or source repair. Linux `workspace.migrateV1` now uses fixed source/mapping witnesses, independently retained raw v1 recovery data and the guarded copy/prefix/report/publication/SQLite receipt path. All 12 migration corpus cases execute, including actual CLI interruption/replay and explicit fresh-authority v2 selection followed by preserved-v1 client rollback, without reverse conversion of later v2 edits. Linux-only `workspace.init` now explicitly initializes existing empty roots with exact no-clobber descriptor publication and guarded pending recovery; `workspace.rebuild` atomically refreshes only the retained cache projection, preserving context/receipts/history while reissuing task tokens. Lifecycle tests execute `root-empty` and `receipt-rebuild`, plus actual CLI publication/receipt/retirement cuts, divergence and cache-loss refusal. Linux capture/status now add fixed UUID/time and complete-sibling first placement, all six accepted status commands without cascades, receipt-only no-ops, guarded task publication and explicit recovery. Creation durably records progress before pending publication and records publication start before the no-clobber link: missing progress or an unexplained missing target requires inspection, not resurrection. Public input/status/time/authority cases and actual process cuts/races pass. Linux `task.move`/`task.dependency.add/remove` now validate full prospective graphs and target eligibility, preserve descendants/closure, use fixed relationship edit time and complete first-in-new-scope allocation, and reuse guarded replacement/replay/recovery. Reparenting reissues affected old/new scope tokens without sibling rewrites. Public `time-parent` plus independent graph/no-op/version cases and actual CLI cuts/races pass. Linux `task.reorder`/`task.order.normalize` now add pinned complete-scope planning, bounded tied-run repair, immutable multi-file preimage/next-byte intents and per-replacement/final verification. Selected unchanged-key moves receive fresh tokens and appear in one selected/incidental group with complete old/new scopes. Same-cache schema-3 membership upgrade retains receipts/history/context. Original key/time/scope/prefix/divergence cases and all actual CLI prefixes/receipt/cleanup cuts pass; at that milestone the full suite was 841 passed/one optional skip. Linux status undo/undoMany/transitionMany and operation-ID inverse now add eligible retained-history/consumed-claim checks, unaffected-field preservation, exact closure, complete graph/order postconditions and fixed full-root multi-file recovery. Only unchanged unreferenced creation may be physically removed, with verified permanent raw recovery bytes preceding publication/deletion. Same-cache schema-4 claims preserve prior authority/receipts/history across upgrade/rebuild. Original five undo cases plus actual batch/replacement/deletion/receipt/archive/cleanup/cache-loss cuts pass; latest full suite is 993 passed/one optional skip. Fully materialized execution is 88 cases, not the full corpus. Legacy writers/sharing must be paused manually; they do not share the new control lock. This is not the complete writer/protocol profile, power-loss, UI migration, native/provider or personal-data rollout acceptance. Still required: remaining vertical-slice conformance, purge/doctor destructive recovery, clients and intentional provider limits. Personal/v1 data remains unchanged and native M1 is still open.

The immediate implementation gate is **the accepted single-root v2 target plus actual safe migration/recovery proof**, not the next adapter. No v2 fields, file versions, or published standard are approved merely by appearing in `ideas/`. The local development queue is `sq list --ready`; `.sift/` is ignored by Git, so this plan remains the portable record of direction and gates.

### Remaining v2 work queue

The staging implementation is committed as `4caaee9`. `xz2` remains the recoverable-slice umbrella, with concrete backup/conversion/migration children below; `69t` retains the existing native M1 obligations. Children are not blocked by their open umbrella. The queue records accepted-target work, not permission to upgrade personal data or a claim that the full target is implemented.

**Next Node implementation:** verified canceled-task purge/recovery (`fag`), then reviewed doctor. `64y`, `88e`, `4qj`, `7qe`, `ydv`, `5xb`, `q3h` and `6nf` now have bounded Linux backup/converter/migration/lifecycle/capture/status/relationship/ordering/undo acceptance, including explicit root/client adoption, preserved-v1 rollback, empty-root initialization, retained-cache rebuild and conservative absent-target recovery. Rebuild retains receipts/context while reissuing task versions, following the accepted fixture rather than the queue's corrected stale unconditional-reset wording. `xz2` stays open for broader vertical-slice conformance/acceptance; native `69t` is still open. No personal rollout, UI integration, native/provider or power-loss acceptance follows from these disposable controls. The remaining implementation/acceptance work is priority 3, and independent interoperability is a later priority-4 gate. Per-capability fixture/fault tests belong in each implementation task; the final conformance task is not permission to defer them.

| Work | sq task(s) |
| --- | --- |
| Usable backup/restore, fixed copy recovery, receipts and verified publication | `64y` (bounded Linux subset complete) |
| Strict complete v1 snapshot validation and full-field conversion | `88e` (read-only component complete) |
| Guarded migration, fresh-authority adoption and explicit v1 rollback | `4qj` (bounded Linux control/client proof complete) |
| Explicit collection initialization and retained-cache rebuild | `7qe` (bounded Linux controls complete) |
| Capture/status and guarded parent/dependency edits | `ydv` (closed), `5xb` (bounded Linux commands complete) |
| Guarded status/batch/grouped undo and archived unreferenced creation removal | `6nf` (bounded Linux subset complete) |
| Verified canceled-task purge and reviewed conflict repair | `fag`, `wsd` |
| Opt-in human CLI and Tasks UI integration | `q7r`, `m1p` |
| Supported native Windows writes and Android document-provider implementation | `82r`, `erd` |
| Remaining black-box corpus execution and separate v2 native acceptance | `23b`, `gex` |
| Human migration/rollout guide after runnable behavior and acceptance | `y9b` |
| Independent second-implementation proof before a public-standard claim | `zaq` |

All mutation/migration work uses disposable roots and retains default v1 behavior. Platform tasks must withhold unsupported capabilities rather than approximate guarantees. V2 native acceptance is separate from `69t`; neither browser/WSL evidence nor a completed converter closes either native gate. Actual dependencies and acceptance criteria live in `sq show <id>`; this table is the portable map because `.sift/` is not tracked.

## Previous milestone baseline

**Reviewed:** 2026-09-06

**Status at that review:** M0 complete; M1 in progress. The following decisions and M1/native recovery obligations describe the earlier app baseline. When v2 proposals challenge a v1 decision, resolve the difference explicitly in the versioned spec rather than silently rewriting this history. Current behavior is described in [the system specification](spec/overview.md); technical details live in [Development and validation](docs/development.md), with first-party interaction guidance in [Usage and interaction](docs/usage-guide.md).

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
