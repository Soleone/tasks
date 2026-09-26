# TaskDB 2.0 pivot

**Status:** Approved direction; execute one gated stage at a time.  
**Working name:** TaskDB, not a naming or package-identity decision.  
**Goal:** An open, local-first task engine with a great keyboard-first app and a dependable CLI for people and their agents.

## Product promise

The existing Tasks app is already useful. The pivot is to make its behavior understandable, reproducible in another language, and safe to access from more than one client or source. The first-party app remains opinionated and calm; the command contract lets independent clients participate. A public *standard* is earned by independent adoption, not declared because a spec exists.

- **One combined view:** desktop and CLI show tasks from configured locations without making the person switch workspaces. **All** includes everything; `@category` filters by the same slug across sources; **Uncategorized** selects tasks whose category is absent. There is no persisted `@uncategorized` value, project entity, or list entity in v0.
- **Origin without clutter:** internally a displayed task resolves to `(source key, task ID)`. Existing edits route to that source. Capture uses a configurable default destination, with an override hidden in task details; origin is visible in details and errors, not on every row. A dedicated source filter or Sources view can follow if real use calls for it.
- **Write-through adapters:** a mounted external source remains authoritative. A usable adapter must create, read, update, and perform basic completion/reopening where its model allows; it does not ship as a read-only facade. A disposable cache is not another owner. Importing a permanent TaskDB-owned copy is a different, explicit operation.
- **Narrow waist:** one documented command/query contract and controller, reached through the friendly CLI or the JSON-lines executable. No HTTP server is required. The CLI is the distribution surface, not where filesystem and domain rules must live.
- **Safe transfer later:** after the first external adapter works, add a deliberate move between sources with mapping, verification and recovery. Changing the source reference alone does not move data. Two separate stores cannot commit atomically.

Target the combined desktop/CLI experience for 2.0. Keep Android's current single-workspace behavior working; Android multi-source follows as a separate platform milestone. No clean-slate rewrite, forced v1 migration, generic plugin marketplace, hosted sync, team collaboration, or mandated UX for third-party clients.

## Authority and architecture

```text
Tasks desktop UI / tasks-cli / JSON-lines sidecar
                      |
        command controller + local source registry
        query: aggregate, filter, return source-scoped refs
        write: choose/resolve one source, check preconditions
                    /                  \
       v1 workspace adapter        external write-through adapter
       canonical JSON +           e.g. TaskNotes files or an sq project
       rebuildable SQLite          external store stays authoritative

Android: same documented command behavior where supported,
         separate SAF/SQLite execution; multi-source comes later.
```

A TaskDB v1 workspace owns one canonical JSON root and its identity. The *client* can mount several such roots and external stores into one view; there is no user-facing workspace switch required. Keep source keys in the local registry/client projection, not in v1 canonical task files. Detect duplicate mounts of the same workspace. Relationships and manual sibling order remain within a source unless a later spec and adapter can represent more; do not imply cross-source edges. With no registry, existing CLI calls still address the current v1 workspace; an opt-in multi-source profile changes the default list view and an explicit source/database selector keeps automation unambiguous.

A write-through adapter makes one authoritative write then refreshes its projection. Multiple agents still race: use version/hash preconditions, idempotent retries and source-native atomicity where available; preserve unknown external fields. Noncooperating editors may prevent true compare-and-swap on plain files, so test and disclose that limit rather than promising impossible linearizability. **Mirroring** is a separate, deferred design: two independently writable copies would need identity mapping, deletion semantics and conflict reconciliation. Unsupported advanced commands must fail explicitly, not silently discard relationships or status.

Today's `src/backend/tasks-cli.ts` and `src/backend/cli.ts` both call `executeCommand` in `src/backend/commands.ts`; it locks, opens and syncs the workspace before `executeTaskCommand` in `src/backend/tasks.ts`. Evolve this path into source routing rather than inserting another server or rewriting `src/backend/canonicalWorkspace.ts`. Android shares `src/backend/protocol.ts` and some portable rules but runs a distinct SAF/SQLite command implementation, not the Node engine.

## Source of truth for behavior

Create `spec/` **before extraction**, following the spirit of [try's spec](https://github.com/tobi/try/tree/main/spec): plain-language behavior, examples, and eventually runnable compliance tests, independent of TypeScript and Tauri. Start with:

- `spec/README.md`: product promise, normative vs informative text, compatibility/versioning, and navigation.
- `spec/model.md`: task identity, classification, source-scoped references, state, grouping, and data ownership.
- `spec/commands.md`: command envelope and semantics, safe writes, errors, retries, and adapter capabilities.
- `spec/storage-v1.md`: existing canonical file records, cache/recovery rules, and distinction from exports and wire protocol.
- `spec/interaction.md`: first-party keyboard/mouse/focus contract and combined-view behavior; clients may implement a different UI.

Begin by codifying *observed v1 behavior* and label 2.0 proposals as proposed until conformance proves them. Link and reconcile `docs/usage-guide.md`, `docs/canonical-workspace.md`, `docs/development.md`, and `PLAN.md` instead of maintaining two contradictory specifications. The current canonical `sync/` JSON root is authoritative task state; SQLite is a rebuildable query cache. Activity and idempotency receipts are local, not canonical. Portable `workspace.exportTasks`, cache snapshot `workspace.export`, and JSON-lines requests are different formats; do not equate them.

## Baseline and reuse

- Preserve `tasks.workspace`, `tasks.task`, and sibling-order v1 files, existing IDs, hashes, order, backups, pending-write recovery and explicit conflict copies. Wrap the current implementation as the **first source adapter** without changing its on-disk format. A migration, if ever needed, must be opt-in, backed up, and reversible.
- `src/backend/protocol.ts`, `taskText.ts`, `taskQueries.ts`, `taskRecords.ts`, `taskArguments.ts`, `commands.ts`, `tasks.ts`, `canonicalWorkspace.ts`, `tasks-cli.ts`, and `cli.ts` already hold much of the contract and dispatch. Extract only portable rules shown to be shared; keep filesystem, SQLite and process lifecycle at their boundaries.
- `src/platform/androidBackendEngine.ts` shares the protocol and classification but implements its own storage path. `scripts/platformParity.test.mjs` is a useful fixture, not proof of complete parity.
- The separate pi-tasks repo already consumes `tasks-cli` and has adapters for sq, tq, beads and TODO.md. Its normalized Task is a *projection*: in particular `done` and `canceled` collapse to `closed`. Do not adopt that projection as canonical TaskDB status. Continue to use `pi_tasks`-namespaced metadata when manipulating sq/tq records.
- `PLAN.md` still owns the current M1 recovery/native-validation commitments. The web dev bridge is not a distributable PWA, a browser build is not native desktop validation, and an Android emulator standard picker is not physical-device or third-party-provider acceptance.

## Files involved

- New `spec/*.md` and later conformance fixtures; `PLAN.md`, `README.md`, `docs/{development,canonical-workspace,usage-guide,syncthing,android-saf-performance}.md` for links and reconciled decisions.
- `src/backend/{protocol,commands,tasks,tasks-cli,cli,canonicalWorkspace,taskText,taskQueries,taskRecords,taskArguments}.ts` and new controller/source modules only when audit evidence calls for them.
- `src/platform/androidBackendEngine.ts`, `scripts/platformParity.test.mjs`, existing backend tests and `scripts/check-ui.mjs` for parity and end-to-end evidence.
- `/home/soleone/src/pi/pi-tasks/src/backend/adapters/tasks/` is an external consumer and compatibility probe, not a module to relocate automatically.

## Stages and exit gates

Keep each stage reviewable and reversible. Do not mark it complete while its gate fails. Native recovery and M1 safety blockers take precedence over architecture extraction.

- [x] **0. Establish `spec/` and the product contract.** Capture the model, command boundary, v1 storage and UX from code and the existing guides. Work three examples: a personal TaskDB workspace; an agent in one `@category` (or a project-local sq source); and a writable external source viewed beside it. Explain source identity, default capture, edits, All/Uncategorized filtering and source authority without assuming any new package or network server. **Gate:** a reader can reconstruct command routing, storage ownership and the editing path without consulting TypeScript; contradictions with v1 are flagged, not silently rewritten.

  **Evidence:** `spec/` documents the v1/proposed split and three journeys. A disposable CLI run created, filtered and completed a task, yielding `workspace.json`, one task file and `order/root.json`; `pnpm build:backend`, `pnpm lint`, and relative-link checks passed. The obsolete outside-repo draft was removed after consolidation.
- [x] **1. Audit safety and the native baseline.** Trace create/edit/status/reorder, restore, external-file import, interrupted writes and multi-agent edits through CLI, desktop and Android. Map each invariant to its owner, tests and discrepancies. Keep a restorable disposable v1 fixture; finish or record M1 native lifecycle/recovery blockers. **Gate:** evidence-linked write-path/invariant matrix, backup/restore proof and recorded native limitations; `pnpm check`, `pnpm test`, `pnpm test:sidecar` and `pnpm lint` pass before large structural changes. Native checks use the README commands on scratch data.

  **Evidence:** [Stage 1 audit](../docs/taskdb-audit.md) maps authority, command paths, recovery and platform discrepancies; `scripts/fixtures/taskdb-v1/sync/` rebuilt and restored to scratch roots with valid SQLite backup. A bounded desktop-sidecar timeout, late-close guard and focused test were added. All four gate commands passed (`pnpm test`: 112/112). WSL2 cannot run the Omarchy/Android native checks; these are recorded release/M1 blockers. Stage 2 can proceed on scratch data, but Stage 3 extraction waits for native-host validation or owner re-scoping.
- [x] **2. Freeze a small v0 contract and conformance suite.** Specify source-scoped references, statuses, P0-P4, title-derived `@category`/`#tags`, All/Uncategorized queries, per-source order/relations, command and file versions, actor/expected-version/idempotency behavior, stable errors and adapter capabilities. Add black-box desktop/CLI tests and extend `scripts/platformParity.test.mjs` where Android supports the behavior. Cover stale and duplicate-key writes, graph cycles, cache rebuild, incomplete workspace and conflict copies. **Gate:** old clients still read/write v1, scratch fixtures round-trip without loss, unsupported Android operations are labeled, and tests pass.

  **Evidence:** [Combined-source v0 contract](../spec/contract-v0.md) freezes the `TaskRef`, query, capability, version, and error semantics while explicitly marking multi-source behavior as not yet implemented. `scripts/taskdbConformance.test.mjs` exercises disposable fixture copies through JSON-lines and `tasks-cli`, including full status/priority boundaries, stale writes, idempotent replay/key reuse, graph cycles, cache-loss rebuild, incomplete workspace rejection, conflict retention, and snapshot restore with task IDs/relationships/order preserved. `scripts/platformParity.test.mjs` verifies Android-supported P0–P4/status/retry behavior and pins partial-update and restore limitations. Gates passed: `pnpm check`, `pnpm test` (**115/115**), `pnpm test:sidecar` (Linux x86_64 backend/CLI probes), `pnpm lint`, and `git diff --check`. WSL2 native M1 blockers remain; Stage 3 extraction is still held until native-host validation or owner re-scoping.
- [ ] **3. Route through a controller and wrap v1.** Keep the existing lock/canonical-write/recovery engine intact as the first adapter. Add a local source registry, stable source-scoped references, bounded aggregated reads and targeted writes in small slices. Keep CLI and sidecar on one command path; make the no-registry default backward compatible. **Gate:** two distinct v1 roots list together, duplicate mounts do not duplicate tasks, writes never hit the wrong root, and pi-tasks and existing UI/CLI work without migration.
- [ ] **4. Pilot one writable external adapter.** Compare TaskNotes and sq against concrete user workflows and the spec before choosing. Implement read/create/update/complete/reopen against its own authority, field-preserving mapping, capabilities and cache freshness. Exercise concurrent agents and an external editor in a disposable source. **Gate:** the original source changes, no TaskDB-owned duplicate appears, detectable stale edits reject, and any unpreventable noncooperating-editor race is disclosed. No read-only pilot counts as done.
- [ ] **5. Ship the unified desktop/CLI experience.** All, category and Uncategorized aggregate across configured sources; default capture and source override live quietly in task details. Source origin is hidden by default; add a source filter/Sources view only if real use shows the need. Preserve focus, keyboard and mouse contracts; measure responsiveness before changing rendering tech. Keep Android v1 functional, with honest native Windows/Linux/Android evidence. **Gate:** end-to-end capture/edit/filter with multiple sources, packaged CLI, native desktop checks and explicit Android regression status.
- [ ] **6. Add a deliberate cross-source move.** After the pilot, design transfer with field-loss preview/refusal or consent, create-and-verify at destination, then remove from origin with a recoverable journal and idempotent retry. A failed origin deletion leaves a visible recoverable duplicate, not lost data. **Gate:** disposable tests cover destination failure, origin deletion failure, interrupted transfer and retry before 2.0 is called complete.
- [ ] **7. Decide what is public 2.0.** Have an independent client and pi-tasks exercise the command contract. Publish only proven schemas/examples/fixtures, support matrix, compatibility/deprecation and backup/rollback guidance. Research the working name separately before package IDs or installer migrations. **Gate:** an outsider can use the contract without reading app internals; otherwise keep the engine internal and ship the app/CLI without claiming an industry standard.

## Validation and stop rules

Run code quality checks (`pnpm lint` after changes, plus targeted tests, `pnpm check` and packaging probes) for each implementation slice. Test writes, stale rejection, same-key retry, category semantics, field preservation, interrupted recovery and source transfer on **disposable** workspaces, not personal tasks or an Obsidian vault. Preserve the existing keyboard-first UX and all supported mouse paths. Browser builds do not substitute for Tauri desktop or Android native proof.

Pause extraction if a v1 workspace cannot survive cache loss, interrupted write and old-client access. Pause an external adapter if it cannot safely write to its source. Do not broaden adapters, add two writable authorities for one task, or declare a universal format just to support the new positioning. Standards work needs independent demand and governance.
