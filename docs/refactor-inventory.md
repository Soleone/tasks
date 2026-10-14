# Refactor inventory and consolidation map

**Reviewed 2026-10-07 for SQ `q6z`.** This is an audit and a set of follow-up proposals, not authorization to implement them. **Follow-up `wf3`:** owner continuation approved only the recommended copy-stage cleanup. The three superseded files are removed after moving unique checks to public copy/recovery suites. Validation: 69 public copy/recovery checks and full regression (1,662 passed/two existing skips), types/lint and backend bundles pass. The lower total reflects 18 obsolete tests removed and seven public-path tests added, not reduced corpus coverage. Remaining proposals await scope approval and cutover gates remain open. Inventory counts and caller findings below describe the pinned audit state. **Follow-up `pa1`:** owner continuation approved support-documentation/integrity reconciliation; [current support](support.md) now owns the live matrix and stale blanket status/native claims are corrected. Named milestone evidence and this original inventory remain historical. No runtime or acceptance scope changed. [PLAN.md](../PLAN.md) owns sequencing and acceptance. No personal tasks were read, no capabilities enabled, and no runtime changed. Later status: `8v8` withheld the selected Settings receive confirmation (§3 row 82 and the Settings bullet are resolved); §7's first three bullets are resolved.

## Decision in brief

Keep the replacement model, guarded writers, recovery evidence and established main UI. Stop treating the engineering workbench as another application. Consolidate by concrete responsibility, not by adding a common writer framework or removing prefixes while both engines survive.

**There is not full native feature parity.** The Linux backend is substantially more complete than its Windows profile or main-client integration. Relationships, ordering, batch operations and broader undo are implemented assets, not finished Windows workflows. Cleanup cannot turn withheld operations into supported ones.

The first independent cleanup can remove the superseded stage-only copy implementation. Documentation can also be made truthful before owner testing. Deleting the legacy runtime, promoting one sole-default spec and switching personal data still require the workflow/platform and migration gates below.

## 1. What the commit count means

The original 50 commits are pinned to **`96a5b01c4ccd3be1771c371d04611ab4274f5052..9beca73`**, where `96a5b01` is the reviewed `origin/main` base and `9beca73` is the launch-argument proof. Audit-start HEAD is **`b0470833787c5bdbccbb7ed4eff8c18d22d8e124`**, one additional planning commit that introduces this inventory sequence. Use these refs, not a moving upstream or a future “last 50 commits.”

The original range changes **237 files, +28,927 / -184 lines**. Exclusive groups, computed from `git diff --numstat`:

| Group | Files | Added | Removed |
| --- | ---: | ---: | ---: |
| Tests and `scripts/check-*` runners | 62 | 11,163 | 16 |
| Fixtures and candidate-model fixture code | 17 | 3,407 | 2 |
| Documentation, specs and ideas | 59 | 6,622 | 64 |
| Backend code outside tests | 66 | 6,013 | 26 |
| Frontend/platform code outside tests | 21 | 1,389 | 58 |
| Remaining build/scripts/configuration | 12 | 333 | 18 |

These are changed-file groups, not a count of all modules or an assurance of test quality. Tests/fixtures account for about half the additions. There are currently **54 non-`.test.ts` backend `v2*.ts` files totaling 5,249 lines**, including test-workspace helpers and the obsolete stage helper. The runtime is not 29,000 new lines, but the small deletion count confirms that this mostly added a parallel implementation.

### High-level sequence

| Phase | What happened | Durable value / unfinished outcome |
| --- | --- | --- |
| Baseline audit and multi-source experiment, `5c20a20` through `af22f1c` | Documented old behavior, added black-box/parity fixtures and an opt-in multi-root Node controller | Useful baseline; multi-source UI and external adapters were never completed and are no longer the destination |
| Single-root design/probes/specs, `a6e96f7` through `fd79fa9` | Reconciled literal text, explicit classification, sparse ordering, minimal JSON and cache-local authority; added independent expected fixtures and transport/model probes | Current replacement model; probes are not application/platform acceptance |
| Replacement backend and CLI, `1ed4e8c` through `9e0c016` | Implemented reads, guarded edits, copy/conversion, init/rebuild, capture/status, relationships/order, batch/undo, purge, doctor and friendly CLI | Broad opt-in Linux command path with process recovery; not the default application |
| Engineering browser clients, `f4f1d9a` through `905c65a` | Added read-only reader, modal capture/edit/status/undo and parent editing | Client/retry evidence; the owner rejected this workbench as the daily client |
| Reset and Windows proofs, `e785176` through `f6f9376` | Fixed quadratic cache fingerprints, traced/typed edits, proved narrow NTFS writer families, then exercised native WebView2/SEA | Real bounded Windows evidence; temporary explicit pilot remains |
| Main-client restoration and preparation, `dae036a` through `9beca73` | Restored original inline UI, corrected inherited accessibility, rehearsed disposable migration, isolated QA and proved launcher argv behavior | Preserved UI and safer test tooling; zero owner sessions, no final cutover |

Only one dependency was added in `package.json`: pinned `fractional-indexing@3.2.0`, implementing the specified key algorithm. No need for a new platform/adapter framework was established.

## 2. New capabilities worth retaining

1. **Simpler canonical task state.** `workspace.json` contains schema 2; flat task files contain 13 explicit fields. Literal title/Markdown, category/tags, one closure timestamp and per-task ordering replace title-derived canonical classification, two closure aliases, dense order files and replicated sync metadata. See [model implementation](../src/backend/v2TaskModel.ts) and [accepted contract](../spec/v2/model.md).
2. **One concrete command path for replacement clients.** [Gateway](../src/backend/v2Gateway.ts) dispatches domain effects and filesystem/SQLite boundaries. Ordinary updates cannot replace status/graphs/order/timestamps arbitrarily. [Typed task edits](../src/backend/v2TaskEditRequest.ts) and [decoded results](../src/backend/v2TaskResults.ts) improve one real path without claiming every command is fully typed.
3. **Guarded local authority and explicit uncertainty.** Exact-byte/scope observations, physically bound cache context, immutable request identity, receipt-only no-ops, fixed pending intent and explicit recovery. Lost SQLite authority is refused rather than recreated from a matching title. [Cache](../src/backend/v2QueryCache.ts), [receipts](../src/backend/v2Receipts.ts), [recovery](../src/backend/v2Recovery.ts).
4. **Sparse sibling order with bounded tied-run repair.** Linux reorder/normalize and eligible inverse preserve full scope, hidden/canceled members and selected logical moves even when their own key bytes do not change. [Ordering](../src/backend/v2TaskOrdering.ts), [writer](../src/backend/v2OrderWriter.ts), [undo plans](../src/backend/v2UndoPlan.ts).
5. **Explicit destructive/control paths.** Reference-safe purge, reviewed keep-both/dangling-link doctor, guarded canonical archive/restore and isolated conversion preserve verified original bytes. These are different publication/deletion problems, not interchangeable uses of one generic writer.
6. **A real native subset in the existing interface.** Windows uses the original list, inline composer, filters, themes and focus behavior, backed by one selected SEA session. Supported actions execute normally, without the workbench's mandatory preview/apply ritual. [Main workspace](../src/platform/mainWorkspace.ts), [restoration evidence](restored-main-client.md).
7. **Measured cache correction and stronger engineering evidence.** Fixed-size sibling signatures replace quadratic fingerprints while retaining recovery/receipt authority. Test harnesses isolate roots/profiles and close stale startup sockets. Launch-argument proof identified pnpm separator corruption without weakening path admission. [Cache measurements](cache-growth.md), [QA](unattended-qa.md), [argv proof](windows-launch-argv.md).

### Deliberate changes are not accidental parity failures

The new contract deliberately changes literal-title/classification storage, category/tag display labels, `updatedAt` meaning, dense ordering, purge behavior and write authority. Exact old-format parity is neither possible nor desirable. Preserve the established workflows while explaining these accepted changes:

- Status and reorder no longer advance content-edit time. Completion has `closedAt`; there is no newly approved closure sort.
- Purge refuses surviving links instead of silently reparenting/unlinking them.
- Classification uses lowercase slugs, not a persistent case-label dictionary. Shorthand remains a command input; canonical readers never parse title markers.
- General undo is local retained history, not reconstructable from JSON. Migration does not transfer old versions/receipts/undo.
- Done dependencies **still block**; canceled dependencies do not. This inherited rule was intentionally retained, not corrected during the storage refactor.
- Multi-source routing is outside the replacement contract. Removing its old experimental implementation does not justify dropping core single-root workflows.

## 3. Workflow parity: what is actually available

**Backend** below means replacement implementation and recorded disposable Linux Node evidence. **Windows client** means the explicitly selected original main UI, not the default legacy app or a browser substitute. “Withheld” is an actual routing/capability restriction, not a cosmetic missing button. This matrix combines inspected code with historical engineering evidence; it is not a newly executed native acceptance report.

| Workflow / established baseline | Replacement backend | Selected Windows main client | Remaining gap / decision |
| --- | --- | --- | --- |
| Root capture, inline content/Markdown editing | Create/update with literal or shorthand input, partial updates, preview/no-op/replay | Connected through original C/Enter/inline form; actual Windows capture/edit evidence | Owner usability; drafts remain memory-only |
| Classification and P0–P4 | Explicit category/tags, escaped shorthand, priority-only updates | Connected; literal round-trip and priority-only native evidence | Case-label dictionary deliberately not ported; retain explanatory spec |
| Status, cancellation, single-status undo | All six transitions and eligible inverse; exact historic closure | Connected through Space/Shift+Space/P/Delete/Ctrl+Z; native/process proof | Not broader operation undo; no automatic redo |
| Filters/search/details/context hierarchy | OR statuses, AND tags, category/null, priority, unblocked, substring search, ancestors and date/priority/manual reads | Existing toolbar/list retained; bounded native focus/search/context evidence | No blanket proof of every filter/large collection on every native host |
| Child capture | Create supports parent allocation/validation | Connected on the Linux `--v2-edit` route; refused on Windows by `App` and `backendClient` | Windows proof/integration; browser walk of the Linux route |
| Parent selection/removal and dependency add/remove | Implemented with full prospective graph and sibling checks | Connected through the original pickers on the Linux `--v2-edit` route with pre-send cycle/canceled-target refusal; Windows displays links, writers/pickers withheld | Windows family proof and integration; browser walk of the Linux route |
| Manual sibling reorder and group selection | Reorder/normalize, tied runs, group history and recovery | Reading/selection retained; reorder reports unavailable | Actual Windows multi-file proof and integration; normalization need not become a home-screen feature |
| Multi-task status and grouped undo | Atomic local `transitionMany`, `status.undoMany`, operation inverse | Selected wrappers refuse; no per-task fallback | Scope supported batch behavior explicitly; preserve all-or-refuse semantics |
| Capture/content/relationship/order undo | Eligible affected-field inverses; unreferenced unchanged creation removal is guarded/destructive | `App` retires undo for non-single-status changes | Essential workflow gap; Windows inverse-family proof, then Ctrl+Z integration |
| Actor activity / agent CLI | Local operation history; friendly task/link/control verbs on Linux; advanced JSON-lines controls | Backend profile exposes activity, but main-client activity action refuses | **Friendly replacement CLI does not select the Windows writer profile**; Windows proofs use raw backend JSON-lines |
| Backup/restore | Verified canonical archive/restore; no SQLite/history authority copied | Explicit Windows JSON-lines controls proven to **absent destinations**; no Settings export | Decide portable JSON export and local-history backup requirements; canonical copy is not the old SQLite snapshot API |
| Conflict repair and permanent purge | Linux doctor inspect/plan/apply and reference-safe purge, with raw recovery copies | Doctor/purge UI unavailable; Windows doctor/purge writers withheld | Explicit release requirements, not assumed blanket port or silent compatibility aliases |
| Receiving/sharing setup | Minimal-root file transport direction, explicit archive/restore and doctor | Old receive prepare/abort refuse; receive status returns not waiting | Old Settings receive confirmation is still rendered; misleading for selected path even though execution fails closed. Needs bounded UI treatment or supported replacement flow |
| Native global focus shortcut | Existing native utility still present | `App` suppresses registration; pilot permission omits it; Settings explains limit | Capability/native focus proof if preserving the established shortcut |
| Built-in themes/help/settings/appearance | Built-in palettes reusable; UI preferences use WebView/local storage | Established components retained | Pilot creates a new WebView directory each launch: durable preferences are not proved. Custom filesystem/Omarchy themes are not supplied by selected `listThemes` |
| External CLI refresh and cold reopen | Fresh observation/revision, retained-cache context | Actual Windows external edit, stale draft, close/relaunch and one-sidecar evidence | Stable production root/profile selection and cold-launch preferences still need final-route validation |
| Uncertain request/recovery | Fixed original envelope, explicit CLI resume, no invented intent | Contextual locked retry dialog; exact lost-reply replay tested | Request/draft lost on reload/close; unload protection best-effort. No durable automatic replay guarantee |
| One-time task migration | Strict separate-root converter and process interruption/replay; fresh authority | No Windows/Android conversion capability or selection UI | Choose proved Linux snapshot conversion or a bounded Windows proof; personal-source permission still required |
| Android SAF / macOS / Omarchy replacement app | No replacement Android engine; broad writable gateway restricted to Linux | No selected replacement Android client; Windows pilot only | Choose supported release platforms. A Windows-only release is not permission to silently ship the old Android runtime as a second app |
| Optional multi-source experiment | Replacement gateway deliberately has no source refs/registry | Not a supported original first-party UI workflow | Retire old controller at cutover; do not create an adapter system to preserve an abandoned experiment |

### Code anchors for the most important gaps

- [Gateway](../src/backend/v2Gateway.ts): Linux has the broad task/control allowlist; Windows requires `windows-task-proof`, with only create/update/six statuses/status undo/archive/restore/resume plus queries/activity. The selected profile advertises **18 commands**, not full target support.
- [Action wrappers](../src/platform/backendClient.ts): child create and relationship actions route to `MainWorkspace` only when it supports relationships (the Linux route); otherwise they refuse. Other unsupported actions go through a legacy command path which refuses while a selected workspace exists. [Routing tests](../scripts/mainClientRouting.test.mjs) assert all 12 withheld wrappers never fall through.
- [App](../src/App.tsx): child capture and relationship pickers refuse on the Windows route; non-single-status operations lose the undo entry. [TaskList](../src/components/TaskList.tsx) refuses selected-workspace reorder.
- [Friendly CLI](../src/backend/v2HumanCli.ts): `dispatch` calls the gateway without a Windows writer profile. Its implementation exists, but Windows friendly writes are not enabled by the raw SEA proofs.
- [Settings](../src/components/SettingsDialog.tsx): export/purge disabled and global-shortcut limit disclosed; the inherited receive confirmation still offers a backup/empty-folder promise that the selected action cannot fulfill. Static finding only; no Settings scene was executed in this audit.

### Evidence boundaries

The recorded original corpus is **101/112**, separate from regression counts. [Conformance](../spec/v2/conformance.md) preserves milestone accounting; this audit did not independently execute/recount all 112 original actions. `23b` remains held for a declared release/profile audit, not a mandate to chase a score.

Actual Windows process groups are update **38**, capture **64**, status/eligible inverse **156**, and absent-destination copy **182**, with retained family reruns. [Native pilot](windows-native-pilot.md) and [restored client](restored-main-client.md) establish bounded actual WebView2 use. [Unattended QA](unattended-qa.md) records **1,670 passing regressions/two skips** at its own commit. Its full original-client browser regression uses the **legacy backend**, so hierarchy/order/general undo passing there is not replacement native parity.

The optional Syncthing runner imports the **candidate model**, not the production gateway: [transport test](../scripts/taskdbV2Transport.test.mjs). Keep its useful transport evidence but do not call it full replacement-application sharing acceptance. No hardware power-loss, hostile-filesystem, distributed CAS, signing/installer, personal migration or owner usability claim follows from these totals.

## 4. Current runtime and target boundaries

Today there are three distinct execution arrangements:

```text
Default App → backendClient → legacy desktop/HTTP/Android transport
Default backend/CLI → commands → legacy workspace/database/task engine

Explicit Windows selection → V2App confirmation → original App + MainWorkspace
                         → reader/editor → one JsonLineSession → gateway

Explicit Linux browser --v2-edit → V2App confirmation → original App + MainWorkspace
                                → dev HTTP allowlist → same gateway
Explicit Linux browser read-only → V2App → V2ReaderView → dev HTTP queries
Explicit Linux CLI → friendly protocol-2 preparation → same gateway
```

[CLI](../src/backend/cli.ts), [friendly entry](../src/backend/tasks-cli.ts), [dev bridge](../src/backend/devServer.ts), [main entry](../src/main.tsx), [selection component](../src/V2App.tsx) and [transport](../src/platform/backendTransport.ts) still carry dual routing. Building one binary that contains both paths is not consolidation.

Target responsibility map, **not a mandated new folder architecture**:

| Responsibility | Retain/adapt | Remove when its replacement is ready |
| --- | --- | --- |
| Main product UI | `App`, `TaskList`, `TaskRow`, `TaskComposer`, existing pickers, help/settings, themes, navigation/focus | Experimental reader/editor as shipped routes; legacy-vs-selected branches |
| Selection and client actions | Native path validation, explicit safe selection, `MainWorkspace`, immutable prepared request/result checks, single JSON-lines session | Pilot-only env flags/profile names/config overlay, old `BackendSession` wrapper and fallback transport after callers are migrated |
| Task presentation | Literal-content-safe `taskView` / `inlineTaskText` behavior | Coupling to legacy `TaskRecord`, `descriptionMarkdown` and completed/canceled aliases when presentation consumers can use current names directly |
| Domain rules | Canonical model, input normalization, states/relationships/order, undo eligibility | Old task/domain implementation, not useful current safety rules |
| Application boundary | Gateway, concrete dispatch, decoded task edits/results, CLI preparation | Legacy command catalog as a runtime import; default version switch and old friendly parser |
| Storage | Strict reader/JSON, authority cache, receipts, root lock, operation-family journals and recovery | Old canonical writer/cache schema/watcher/receive runtime; stage-only helper |
| Conversion | Strict legacy descriptor/task/order reading, exact mapping/hashes, current guarded copy publication/recovery | Legacy engine import/startup, registry, old history authority, reverse-conversion facade |
| Shared UI/native support | Built-in palettes, semantic tokens, branding, concrete paths/errors, shell/session framing | Only obsolete behavior, not files merely because the old app also imports them |
| Validation | Independent expectations, production fault/replay tests, native runners, harness isolation | Prototype-only checks once their unique invariants have a retained owner; historical paths remain identifiable |

### Imports that prevent blind deletion

- `v2Protocol.ts` imports **runtime `COMMAND_NAMES` from `protocol.ts`**. Rebuild the current supported/known command vocabulary rather than removing that module underneath the decoder. Model/client/theme imports also use its types; move still-needed task/actor/theme shapes to their actual owners.
- `v2MigrationSource.ts` / `v2V1Conversion.ts` import legacy canonical shapes **type-only**, not the old engine. Extract just those shapes into isolated conversion. `contentHash` from `requestHash.ts` plus `canonicalJson.ts`, and legacy token recognition from `taskText.ts`, are still real conversion dependencies. `canonicalJson.ts` is also a runtime receipt-identity dependency (`v2Receipts.ts:3,12`) and must stay byte-identical through any move or rename.
- `MainWorkspace` uses `V2WorkspaceReader` and `V2EditorClient`; both remain necessary for the native original UI. `V2App` contains the native confirmation/shared-session route. Deleting every `V2*` UI/client file would break the real replacement client.
- `v2Recovery.ts`, pending parsing, control-root reading and copy journals know about migration intent. A separate converter entrypoint requires tracing recovery ownership too, not just moving the mapping function.
- Android's `androidCanonicalWorkspace.ts` still writes format 1/order files and derives projected versions from `sync.revision`. Its separate engine cannot be relabeled as current-model support. Its removal or port depends on explicit platform scope.

Production naming can become `CanonicalTask`, `TaskEditRequest`, `WorkspaceReader`, `PreparedTaskRequest` and responsibility-named files. Remove the **product-version distinction**, not schema/protocol numbers. Do not rename persisted tables, journal tags or profile locations just to erase a string: they describe stored contracts and may need a safe transition. Intentional “legacy/schema-1” terminology remains legitimate inside the converter and its runbook.

## 5. Pruning map

| Candidate | Finding / concrete callers | Proposed disposition and gate |
| --- | --- | --- |
| `v2CopyStage.ts` and its two tests | `rg` finds only `v2CopyStage.test.ts` / `v2CopyStageFaults.test.ts` callers. Public gateway uses `v2CopyWriter` / `v2CopyJournal` instead. **330 lines** total | **First independent deletion candidate.** Compare byte/conflict/destination/pending/fault invariants with `v2CopyWriter.test.ts` and `v2CopyRecovery.test.ts`; retain any unique assertion there. Update live README/spec links; historical hash manifests are evidence, not callers. Do not remove shared `v2CopyFiles` |
| `V2ReaderView` (`V2TaskEditor` retired) | The established-client Linux slice routed `--v2-edit` to `App` and removed `V2TaskEditor` plus its Chromium runner; client/bridge retry coverage moved to `mainClientRouting.test.mjs`. The read-only reader remains for query-only inspection | Retire the remaining reader at cutover. Keep/rehome useful client/retry tests against the original UI before deleting their runners; do not delete shared reader/editor clients or native confirmation with them |
| `sourceController.ts`, `sourceRegistry.ts` | Old `commands.ts`/`cli.ts` route into them; replacement gateway does not | Remove with legacy routing at cutover. Retire `--source-key`, registry environment dispatch, `spec/sources.md` and superseded proposal links together. No replacement adapters |
| Legacy engine (`commands`, `tasks`, `database`, `canonicalWorkspace`, `workspace`, `receiveWorkspace` and neighbors) | Still owns default desktop/CLI/web and supports old tests; some shapes/hash/text helpers are used by conversion/current UI | Not safe to delete now. Replace entrypoints, move needed current types/conversion helpers, satisfy agreed essentials, then remove old runtime and obsolete tests in a verified cut |
| Candidate model and candidate/rekey tests | Only three test suites import `scripts/fixtures/taskdb-v2-candidate.mjs`; transport depends on it. Real ordering/recovery suites now exist | Compare unique vectors/race demonstrations before retirement. Prefer retained independent expected data and a production transport test if sharing is in scope; neither duplicate code nor total test count alone proves deletion safe |
| `v2*Writer` / `*Journal` repetition | Create, replacement, batch/undo, purge, doctor and copy share plumbing but have distinct no-clobber/absence/ownership/cleanup invariants | Retain concrete families. Simplify measured readability problems one neighborhood at a time; no generic writer engine. Three superficially similar transaction wrappers are not three equivalent publication algorithms |
| Generic envelopes / compressed control code | Updates have concrete decoded inputs/results; broader requests/results remain string/unknown records. Doctor/copy/batch code has compressed guard/cleanup sequences | Rename/simplify where a reviewed follow-up needs it, preserving fault injection anchors. Do not authorize a wholesale typed-API rewrite from this audit |
| Native proof launchers/overlays | Exact selection and command-set handshakes actively protect current proof | Keep until one default native route is proved. Remove pilot entrypoints/names after replacement, not permission checks or original-request safety |
| Milestone prose and proof artifacts | `spec/v2/conformance.md` mixes current support with many dated milestones; `.json` reports include hashes of historical files | Reduce live guidance to supported behavior and one evidence index. Historical reports may move to a clearly historical location or Git with a reproducible reference; never rewrite them as final-app evidence |

Retained safety checkpoints for later consolidation, with filenames updated alongside their owners:

- Authority and uncertainty: `v2QueryCache.test.ts`, `v2TaskEditRequest.test.ts`, `v2UpdateRecovery.test.ts`, `v2LifecycleRecovery.test.ts`, `v2HumanRecovery.test.ts`.
- Operation-specific publication/inverse: task/relationship/order/undo/purge/doctor recovery suites, including `v2OrderRecovery.test.ts` and `v2UndoRecovery.test.ts`. Do not replace these with a generic happy-path writer test.
- Conversion: `v2MigrationWriter.test.ts`, `v2MigrationRecovery.test.ts`, `v2MigrationSourceFaults.test.ts`, `v2MigrationRehearsal.test.ts`, plus independent golden expectations; rehome the direct `taskText` tests from `src/backend/tasks.test.ts` (≈`:60-80`) before deleting the legacy suite.
- Actual client routing/retry and native selection: `mainClientRouting.test.mjs`, `v2AppReader.test.mjs`, Windows writer runners and original-client keyboard/mouse checks against the final backend. Keeping a legacy browser pass alone is insufficient.

A code-quality target is one understandable request, clear ownership and no unused production paths. “Perfect” is not a runnable acceptance criterion. Explicit deletion/caller checks plus retained regression/native evidence are.

## 6. Task migration and operational transition

### Minimum isolated converter

Keep the verified mapping/publication, not an application compatibility layer:

```text
Explicit converter entrypoint
  → strict legacy source shapes + hashes + legacy token recognition
  → validated current task fields + pinned sibling-key allocation
  → guarded current copy publication / raw original archive / explicit recovery
```

Concrete owners: [source reader](../src/backend/v2MigrationSource.ts), [mapping](../src/backend/v2V1Conversion.ts), [writer](../src/backend/v2MigrationWriter.ts), [migration journal](../src/backend/v2MigrationJournal.ts), [copy journal](../src/backend/v2CopyJournal.ts), and [rehearsal/runbook](migration-rehearsal.md). The default application must not initialize or dispatch the old engine; isolated converter code is the intentional exception to forgetting the old format.

The disposable eight-task rehearsal independently verifies IDs, all statuses/priorities, exact Markdown, title-only classification, timestamp instants, nested graph/full order, unchanged source/independent backup/old cache, raw recovery archive, restart/replay and a fresh target with no imported undo/history authority. Source and bundled runbook checks are Linux/WSL2, **not native Windows conversion**.

Choose one route before personal conversion: explicitly approved frozen personal snapshot on the proved Linux filesystem, or a separately bounded actual Windows conversion/recovery proof. Neither is permission to infer/read a personal default. Never convert a live shared folder in place. A rollback restores the old snapshot with a historical binary, not later replacement edits; keep both roots and independent backups.

### Transition risks to resolve before the clean cut

| State / artifact | Current fact | Required safe treatment |
| --- | --- | --- |
| Canonical root | Explicit physical selection; no replicated collection ID | Preserve exact task files and original root. Confirm target rather than infer from legacy cache/env |
| Old SQLite cache | Old database schema is refused by replacement cache admission | Keep an independent old backup; use a fresh target cache after conversion. Do not reinterpret old schema numbers |
| Existing replacement cache | Context binds root path/identity **and cache path/file identity**; rebinding clears receipts/history/claims/plans | Do not move/copy it and promise replay. Preserve original selection until uncertainty is resolved; any deliberate fresh-authority switch must be explicit |
| Root lock/journal profile | `v2LocalDomain` uses app data plus `taskdb-v2/roots/<hash(root path, identity)>`; pending intents embed paths/bindings | Keep the historical storage spelling if needed or design a narrowly tested transition. A source-module rename need not change its stored location. Never strand pending work |
| Persisted local formats | `v2_*` SQLite table names, journal tags/version fields and prepared requests exist | Treat as storage/wire contracts, not product branding. Preserve or explicitly migrate with retained-context/fault tests; do not bulk replace strings |
| Uncertain UI action / unsaved draft | Full request/draft is memory-only | Preserve original envelope and paths before closing/reloading/cutover. Cleanup is not authorization for durable auto-replay or new success ledger |
| Preferences | Legacy theme selection has backend settings; selected themes and other UI preferences use local storage; pilot storage is launch-isolated | Prove stable production WebView profile and decide which appearance/help/font/filter/shortcut settings to carry. Tasks conversion intentionally does not import settings |
| Copy / migration evidence | Raw recovery copies and active journals are outside canonical root | Preserve unresolved evidence and independent backups. Do not clear caches/profiles to hide errors or omit archives from cleanup |
| CLI / native entrypoints | Default executables still route legacy; pilot uses exact eight-argument SEA path and one inline permission | Update UI, backend, friendly CLI, dev/build scripts and Tauri capability as one reviewed route. No same-binary permission ambiguity, arbitrary shell launch or silent fallback. `check-native-launch-argv.mjs` pins the exact launcher source line, package script and capability shape, so change it in the same commit. |
| Cross-device data | Old clients cannot write schema 2; old sharing setup is not a current-format adapter | Pause writers/sharing, convert once, inspect, explicitly select, then resume only with supported clients. Do not ship permanent dual-write/coexistence |

## 7. Spec reconciliation, not spec duplication

The source-backed contracts are substantial, but their status/navigation are stale:

- Root overview still calls the old model the only implemented reference; `spec/v2/*` all start “accepted target, not implemented” while recording numerous implementations.
- Later current native use is not reflected consistently in earlier overview/UI paragraphs. `docs/usage-guide.md` still says `m1p` remains open in an earlier reader section, despite its later completed native section.
- **A test pins the stale wording:** `scripts/taskdbV2Spec.test.mjs:72–76` requires every target page to contain “Status: accepted target, not implemented”. Correcting status and moving specs requires updating that assertion while keeping corpus IDs/rule anchors/error checks, not disabling fixture integrity.
- `spec/v2/protocol.md` inherits read/CLI contracts by linking to legacy root pages. Deleting the root baseline before spelling out those retained rules would delete part of the current contract.
- Production query/model validation is strong, but the original main client's restored projection, single-status-only undo, supported command set, recovery dialog and withheld Settings flows are mostly described in evidence/usage docs rather than one current UI/support contract.

### Proposed final `spec/` shape

One set of responsibility-named pages, promoted when they describe the sole-default application:

| Page | Content / source owners |
| --- | --- |
| `overview.md` | Product boundary, supported platforms/capabilities, artifact/version distinctions, navigation; no parallel product versions |
| `model.md` | Current 13 fields, exact encoding/text/classification/time/graph rules from current model and validators |
| `protocol.md` | Envelopes, commands, errors, original authority/replay, result shapes; separate known from supported commands |
| `queries.md` | Full filters, paging, tie/manual/context behavior from `v2Queries`, not a link into removed legacy semantics |
| `mutations.md` | Effective fields, no-op/status/relationship/undo/time rules, with explicit platform support |
| `ordering.md` | Pinned keys, scope, tied-run repair, normalization and inverse postconditions |
| `storage.md` | Canonical versus local state, root identity, observation, publication/deletion families, explicit recovery, archive/restore and external-writer limits |
| `cli.md` | Actual final friendly verbs, JSON/stdout/stderr/exit rules, retry preparation, selected-root/profile behavior |
| `migration.md` | The intentional isolated legacy-reading exception, verified mapping/refusals, separate-root procedure and limitations |
| `ui/*.md` | Original keyboard/mouse/focus contract plus current integration and truthful unavailable actions; selection/retry/preferences/global-focus/Settings rules |
| `conformance.md` | Short capability/evidence index with original case applicability, tests and platform limits, not a chronological project diary |

Before promotion, correct current support/status and link to this audit without implying cutover occurred. At cutover, update fixture/test paths and normative anchors together, remove `spec/v2/` and legacy current-state pages, and retire `spec/sources.md` if the experiment is dropped. Do not rename protocol/schema 2 to 1 or relabel the unrelated legacy task-export version 2 as canonical data.

Extract missing supported behavior from code/tests, compare with accepted decisions, and explicitly flag contradictions. A discovered bug is a defect proposal, not a new MUST. Developer instructions, packaging recipes, historical proofs and future platform requirements do not all belong in the normative spec.

## 8. `ideas/`: file-by-file disposition

All eight existing files were read. **None needs to remain a competing current contract.** Deletion is justified by promotion/supersession, not by a claim that all proposed functionality has shipped.

| File | Proposed disposition | Preserve elsewhere first |
| --- | --- | --- |
| `task-model-v2.md` | Delete after spec reconciliation | Literal-title choice, label loss/mapping and strict refusal behavior already belong in model/migration |
| `task-behavior-v2.md` | Delete after spec reconciliation | Timestamp/readiness/undo decisions; document unchanged done-blocker behavior clearly |
| `protocol-v2.md` | Delete after spec reconciliation | Cache-local receipt direction, no authority refresh for uncertain retries, input/artifact distinctions; current spec, not duplicate API prose |
| `collection-lifecycle-v2.md` | Promote useful operational rationale, then delete | Nominated repair device, quiescing/sharing and local evidence loss; transport trials remain historical bounded evidence |
| `syncthing-sync-ordering.md` | Preserve a short rationale/evidence reference, then delete | Why sparse keys/tied-run repair instead of CRDT/jitter/log; known final-read/rename race and candidate-transport limits. Do not lose this by removing proposal tests first |
| `taskdb-2.0-roadmap.md` | Delete as superseded | Git contains original stages and controller experiment. Do not carry an external-adapter/multi-source roadmap into current app docs |
| `multi-source-v0-contract.md` | Delete with abandoned experiment or once no live docs depend on it | Explicitly decide that old opt-in registry is not a release requirement; history is in Git |
| `overview.md` | Remove/rewrite after the above | If no active proposals remain, remove the directory rather than leave an empty historical index. New future ideas need a real purpose |

This audit does not manufacture new future-feature pages to keep `ideas/` populated.

## 9. Proposed next tasks and review decisions

**Proposals only.** No implementation tasks are created by this report; `q6z` stops for review. Keep existing `hzv`, `dvs` and `xz2`, rather than duplicate them with another generic consolidation umbrella.

### Independent work that does not need manual dogfood

1. **Remove obsolete copy staging.** Delete the three stage-only files after public-copy invariant comparison; update live references. Exit: retained archive/restore/recovery suites, full regression, types/lint, no gateway/native/data change. Scope is at most the identified 330 lines plus necessary assertion/link moves.
2. **Reconcile current support documentation and integrity assertions.** Correct status/native/CLI claims, remove contradictory “not implemented” blanket assertions, give current support one entry point. No premature sole-default spec promotion. Exit: fixture-integrity/link checks plus source-backed support tables. The older docs should not send a fresh session back into completed workbench milestones.
3. **Make selected Settings receive guidance truthful.** Keep the original Settings design, but do not offer a backup/empty-folder flow on a route that refuses it. Exit: selected/default supported UI/refusal tests and no receive/capability expansion. Decide whether the unsupported affordance should be withheld or explain the limit before confirmation.

### Native essentials to approve one family at a time

| Proposed bounded task | Existing reusable assets | Proof / integration exit |
| --- | --- | --- |
| Parent move first | Existing relationship effect and update journal, original `TaskPicker`, browser parent tests | Actual Windows Node/SEA parent move/remove/no-op/cycle/stale/interruption/replay; then original picker and immutable request integration. Dependency writes not implied |
| Child capture and dependency edits | Current create input/relationship effects and original UI | Separately bound parent allocation and dependency add/remove/canceled/cycle scenes, expected versions/recovery and no legacy fallback. Can split into two tasks |
| Manual reorder | Production scope/key plan, order journal/history and original list selection/move controls | Actual Windows selected/incidental/tied/hidden/scope-divergence/multi-file prefixes; original keyboard/mouse integration. No automatic normalization feature |
| General undo, then batches if essential | Current affected-field inverse/history/batch journal, original Ctrl+Z/selection paths | Scope inverse families explicitly; preserve unrelated edits/full graph/scope/creation removal. Multi-task status is a separate atomic-family decision, not per-task looping |
| Final native/CLI/profile route | Existing SEA/framing/path admission and launcher argv proof | Friendly Windows writes need proved profile selection; one normal native launch, stable preferences, global focus if required, exact process/capability boundaries and no fallback |

These are not automatically approved because they appear in this table. The original workflows remain the baseline; any intentional loss needs owner agreement. Avoid a blanket “enable Windows” change to bypass proof.

### Gate decisions before `dvs`

- **Release platforms:** Windows first only, or also current-model Linux/Android? Do not preserve a legacy Android product by default or advertise a port that does not exist.
- **Essentials:** confirm whether relationships, reorder, broader undo, batches, global focus, portable export and custom themes must survive. Record explicit changes/losses, not an inferred reduced product.
- **Conversion host:** proved Linux frozen-snapshot route or a bounded Windows converter proof. Personal read/convert/select permission remains separate either way.
- **Local-state transition:** preserve stored names/locations where safe, versus a justified explicit migration. Removing source prefixes is not a reason to reset receipts/history or profiles.

After approved prerequisites and actual owner dogfood, `dvs` removes legacy runtime/version dispatch, workbench routes and product-version names; isolates conversion; promotes one current spec; and prunes reconciled ideas. Validate the new default UI/CLI/native/restart/recovery route, not only renamed imports. Then `xz2` reviews publication scope. No squashing/history rewrite is needed to accomplish this; Git is the intended archive.

## 10. Audit validation and limits

Inspected entrypoints/action wrappers, domain/query/undo/order rules, writer/recovery/cache/migration boundaries, native selection/permissions, relevant test assertions, all current spec subjects and all eight ideas pages. Searched concrete callers for deletion candidates and pinned commit/line statistics. This is a bounded consolidation audit, not an exhaustive security review of every journal transition or a new platform acceptance run.

Validation for this documentation-only audit:

- `pnpm check` and `pnpm lint`: pass.
- `pnpm test`: **1,673 passed, zero failures, two existing skips**. Run with a fresh temporary app-data profile and inherited workspace/database/registry settings removed. This reruns regressions, not the full native/corpus acceptance matrix.
- All 41 inventory links resolve locally; code fences and `git diff --check` pass. Clean-code review confirms only the report and its plan checkpoint changed; no speculative runtime abstraction or deletion was introduced.

Completion/evidence is recorded with SQ `q6z`. No owner's Windows process/source copy or personal workspace was opened or altered. Historical counts above remain historical; automation still records zero owner sessions. Review checkpoint: choose the first bounded follow-up and resolve essentials/platform scope, rather than immediately executing the entire proposed sequence.
