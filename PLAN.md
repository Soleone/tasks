# Tasks: clean-cut delivery plan

**Reset: 2026-10-04. Baseline: `905c65a`.** Keep the useful new model, canonical files and recovery tests. Fix the measured defect, prove daily use, then replace the old application rather than maintain a parallel successor.

## Direction and destination

Tasks is a local-first, keyboard-first task app for one person working alongside external agents:

> capture quickly → clarify → choose work → complete it → understand what changed

**The owner wants one elegant, publishable codebase, not permanent v1/v2 coexistence.** There are no external installations requiring a long compatibility window. The owner's existing tasks need a verified one-time conversion, not a permanent legacy runtime or strangler framework.

The destination is:

- One task model and application command path shared by UI, CLI and agents.
- One default app, with concrete Node, SQLite and native boundaries. Reuse useful existing UI instead of maintaining a second product workbench.
- Responsibility-based module names, without `v2` prefixes or legacy/new routing. Format/protocol version numbers remain where they describe data; they do not justify two application architectures.
- One current specification for supported behavior, with future ideas and historical evidence clearly separate.
- A small, isolated migration tool plus preserved backups. Old binaries can be retrieved from Git if needed; they do not have to ship inside the replacement app.

**Every client must remain elegant, minimal and calm, including experimental readers, native pilots and manual-test builds.** A technically working client is not enough. Preserve the previous app's restrained visual identity and keyboard-first interaction quality; reuse its useful UI rather than expose a developer workbench. The task list is the main surface, not a place for implementation/version labels, raw paths, permanent capability disclaimers or unsolicited instructions. Put secondary details in help, settings or progressive disclosure. Show necessary selection confirmation and actionable safety/error guidance at the point of use; never hide a real risk merely to look cleaner. Visual and interaction quality are acceptance requirements before owner dogfood, not polish deferred until cutover.

**Generic means reusable by clients, not configurable for every task system.** No new adapter framework, plugin model, metadata bag, compatibility facade or public-standard claim is needed. Publishing the app does not require proving an independently implemented public standard.

### Owner correction: preserve the main client (2026-10-06)

The owner rejects the experimental reader/editor workbench as a replacement client and refuses dogfood of it. **Reuse `src/App.tsx`, `TaskList`, `TaskComposer`, the compact toolbar, themes, help/settings and their established interaction design. Adapt the concrete data/command integration to the new model; do not recreate the UI or ask the owner to rebuild it.** A backend replacement does not authorize a frontend rewrite. The experimental workbench is engineering evidence only, not the daily-use candidate.

`4t6` reconnects the established client to the explicitly selected native workspace, with actual Windows inline capture/edit/priority/status/undo, external-refresh/stale-draft and immutable lost-reply retry evidence. The owner's baseline-matching `D:\src\wsl\tasks` source copy is updated and running the restored main client against the owner's declared disposable root. [Implementation, evidence and limits](docs/restored-main-client.md). Unsupported native writers remain withheld without legacy fallback. Owner dogfood `hzv` can now use this client, not the workbench; zero owner sessions have been counted. Migration/cutover still wait for owner-reviewed use and essentials. `26a` now corrects the inherited row semantics and filtered-summary separator; native collapsed/expanded/filtered/context/minimum-window checks have zero axe findings. This bounded evidence does not replace owner review or blanket assistive-technology acceptance. Do not construe engineering automation as owner approval.

### Owner sequencing correction: testing later (2026-10-06)

The owner wants more outstanding work completed before manual testing. The bounded inherited accessibility fix `26a` and disposable converter rehearsal `y9b` are complete. [Rehearsal and runbook](docs/migration-rehearsal.md) verify preservation, fresh authority and interrupted recovery on WSL2 Linux Node, not native Windows migration. No withheld commands were enabled. The next gate is owner dogfood `hzv`, still deferred with zero owner sessions; no further implementation is authorized merely to fill that wait. These pre-test tasks were independent of owner usability approval; the old `hzv` dependencies were sequencing choices, not technical requirements.

The established UI and workflows remain the baseline. Native gaps such as relationships, ordering and broader undo need individually bounded support/integration tasks, not a client rebuild or blanket Windows port. Owner testing is deferred, not passed or waived. Personal-data reading/conversion and final default cutover remain gated; `dvs` still requires owner-reviewed essentials and a verified rehearsal.

## Authority and present state

- **This file owns direction, order and stop/go gates.** SQ tracks execution, not another roadmap. Current owner instructions override older handoffs and completed-task descriptions.
- [Guidelines](GUIDELINES.md) owns project principles. [Usage and interaction](docs/usage-guide.md) records today's keyboard-first UI and experimental subsets. Preserve useful interactions; record deliberate changes rather than silently dropping them.
- [Root specs](spec/overview.md) currently describe implemented legacy behavior. [New-format specs](spec/v2/overview.md) contain accepted targets; [conformance](spec/v2/conformance.md) records bounded evidence. This temporary documentation split must end at cutover, not become a permanent product boundary. Target acceptance is not permission to implement the entire target.
- [Ideas](ideas/overview.md) preserves reasoning and proposals. [Reset inventory](docs/refactor-reset.md) records the audit and decision changes. The previous full plan is preserved at `905c65a:PLAN.md`.

Today the default workspace/CLI still use the old model; explicit native selection connects the existing main UI to the proven new-format subset. The opt-in Linux backend implements a broad new-format task/control subset; its browser workbench supports reading, content, statuses, latest-status undo and parent changes. These are useful implementation assets, not shipped native acceptance. The reset baseline passed types/lint, 1,591 regression checks with two skips and Chromium/axe editor checks. Recorded original corpus coverage is 101/112, not 1,591 cases.

The refactor mostly added a parallel implementation. Do not revert the useful work, but do not extend that delivery pattern. Default Windows/Android new-format writes remain withheld. The explicitly selected Windows create/update/single-status/eligible-status-undo/absent-destination archive/restore/recovery proof has process evidence on short dedicated local NTFS paths; the established main UI now uses the smaller proven task subset. This is not full Windows writer/platform acceptance. Wider native lifecycle/recovery evidence remains open for the replacement app.

**Initial defect, now fixed by `fwk`:** `src/backend/v2QueryCache.ts` repeated a complete sibling-ID sequence inside every task fingerprint, producing quadratic storage/work. Historical disposable WSL2 probes showed 15.7 MiB for 1,000 flat tasks and 361.5 MiB for 5,000; unchanged 5,000-task info calls took about 1.7–2.0 seconds. The fixed-size signature implementation and its regression evidence are complete, not outstanding work.

## Work order

One bounded task at a time. `fwk`, the bounded Windows proof `fcf`, and the host/profile/launch decision `dh1` are complete. The owner reproduced all 38 Windows Node/SEA scenes on D: and authorized the decision checkpoint. The [native-route decision](docs/development.md#selected-windows-native-route-dh1-2026-10-04) is recorded. `mg8` completed the [typed update-request trace](docs/update-request-trace.md), full regression and 38 Windows Node/SEA scene groups. `7hr` then passed 64 capture and 38 retained update scene groups in the one private Windows task-proof profile. `byy` then passed 156 status/eligible single-status undo groups plus the retained 64 capture/38 update groups, with full regression and self-review. `gxm` then passed 182 absence-only archive/restore Windows Node/SEA groups plus retained status 156/capture 64/update 38, with full regression and self-review. `m1p` then proved the bounded loop in actual Windows/WebView2 through one SEA session, including original-request lost-reply replay, external CLI refresh, native close/relaunch and separate-root backup/restore. [Native evidence and runnable instructions](docs/windows-native-pilot.md). `4t6` subsequently restored the established main client. With owner testing deferred, `26a` corrected the inherited list semantics and `y9b` completed the [disposable migration rehearsal](docs/migration-rehearsal.md). The next gate is actual owner dogfood `hzv`, not broad Windows porting or default cutover. The owner chose Windows-first because rebooting into Omarchy is impractical.

Completed milestone descriptions below retain their original scope and evidence dates. In particular, the `m1p` workbench's clean native accessibility audit does not apply to the restored main list; `26a` tracks its inherited findings. The table is the current execution sequence.

**Owner override (2026-10-04): run the task → validate/self-review → quick commit → next ready task loop without routine supervision, including continuation after auto-compaction.** This replaces the per-task owner review pauses below, not bounded scope, safety, tests, native acceptance or human/personal-data approval gates. Do not auto-switch providers when usage is exhausted. Use fresh quota/reset evidence and a verified session-only wake if available; no closed-process resumption guarantee. Durable loop state is under `$DATA/handoffs/2026-10-04-tasks-autonomous-loop.md`.

| Order | SQ task | Outcome |
| --- | --- | --- |
| 1 | `fwk` | Remove quadratic fingerprints without adding a cache framework |
| Prerequisite | `fcf` | Complete: actual Windows Node/SEA content-update/recovery proof; review checkpoint |
| 2 | `dh1` | Complete: Windows content-only profile, one inline pilot capability and existing SEA; launch remains unimplemented |
| 3 | `mg8` | Complete: typed single-file update path/results, readable trace, retained receipt validation; Windows 38/38 |
| Windows prerequisite | `7hr` | Complete: Windows Node/SEA capture 64/64 plus update 38/38; short-path profile, already-linked directory reflush |
| Windows prerequisite | `byy` | Complete: Windows Node/SEA 156/156 plus retained capture 64/update 38; single-source inverse/recovery scope and already-applied directory reflush |
| Windows prerequisite | `gxm` | Complete: Windows Node/SEA archive/restore 182 groups plus retained 156/64/38; owner-selected absent destinations only, existing empty directories refuse before staging |
| 4 | `m1p` | Complete: actual Windows native basic loop, lifecycle/lost-reply replay and CLI backup/restore |
| Owner correction | `4t6` | Complete: established main client reconnected; workbench is not the dogfood candidate |
| 5 | `26a` | Complete: valid row/filtered-summary semantics, unchanged design/focus; browser regression and bounded native axe pass |
| 6 | `y9b` | Complete: disposable Linux migration/replay/fresh-authority rehearsal, retained interruption/refusal tests and isolated-dependency runbook; no personal source access |
| Owner gate | `hzv` | Pre-test work complete; still deferred, zero owner sessions; test the restored client and review native essentials |
| 7 | `dvs` | Make the new path the sole default; remove legacy runtime and versioned code names |
| Gate | `xz2` | Review publication readiness and explicitly choose any remaining release scope |

### 1. Fix the measured cache defect (`fwk`)

- Compute one fixed-size signature per complete sibling scope, combined with each task's exact-byte hash. No watcher, second projection store or new performance framework.
- Preserve formatting-change detection, scope invalidation, unchanged-key selected moves, deletion/reappearance, retained context, receipts and rebuild semantics.
- Handle existing schema-5 cache observations explicitly. Prefer the smallest safe transition; do not build a general compatibility layer or discard history/recovery evidence to hide the defect.
- Add structural growth assertions and disposable flat/nested 1k/5k measurements. Record cache size and unchanged info/get/update cost; avoid timing-only regression assertions.
- Exit: focused authority/recovery checks, full tests, types/lint and a short reviewed diff. No canonical format change.

### 2. Establish a real native path (`dh1`)

A read-only feasibility decision, not a platform-port umbrella.

- Identify an actual capable host, native shell/webview, bundled runtime and supported writer profile. Prefer the existing Linux writer for a technical pilot if a capable host exists; Windows 11 remains the primary product target.
- **Owner decision (2026-10-04): Windows-first.** `fcf` is the separately bounded prerequisite: inspect actual Windows filesystem/durability APIs, then prove one existing-task `task.update`, no-op, restart, interrupted publication and original-request retry/recovery on disposable NTFS data with explicit cache/APPDATA. Use actual Windows Node and its SEA binary, not Linux processes against mounted Windows files. Stop on an unsupported durability/contract/tooling boundary; do not merely remove Linux-only gates or introduce another engine. This first proof does not enable capture, status/undo, backup/restore or other unproven Windows controls. Approve the smallest further prerequisite only after its review. The broad `82r` task remains held.
- Inspect the same-binary Tauri permission first-match problem. Prefer one unambiguous fixed backend entrypoint; if a distinct temporary pilot route is necessary, record its removal in `dvs`. No arbitrary shell interface or silent legacy fallback.
- Record allowed commands, root/cache/profile selection, process/retry behavior, filesystem assumptions and native acceptance steps in [development](docs/development.md).
- Decision recorded: local Windows 11/WebView2, actual Windows Node/SEA on local NTFS, and one Windows-only inline capability in an explicitly selected pilot config outside `capabilities/`. Only the content-update/recovery subset has process acceptance. Default capabilities, native launcher and UI remain unchanged; do not run `pnpm dev:tauri` as the replacement pilot. The pending `7hr` → `byy` → `gxm` proofs gate `m1p`; naming these scopes does not authorize execution during `dh1`.
- Exit: a feasible reviewed host/profile/route or an exact blocker. **If no capable host exists, stop and ask.** More browser features are not a substitute.

### 3. Make one request understandable (`mg8`)

**Start with `task.update`, not an API redesign.** Trace client preparation → decoding → domain effect → publication → receipt → retry/recovery.

- Review deletion/simplification opportunities in that neighborhood before extracting anything. `v2CopyStage.ts` is a known superseded candidate, but it belongs in the later cutover unless actually needed here.
- Keep unknown JSON at decoding; give this command concrete decoded inputs/results so invalid internal calls fail compilation. Extend typing only to directly required query/envelope plumbing.
- Make touched update/recovery transitions readable. Explain non-obvious publication, receipt and retirement invariants, not obvious assignments.
- Do not introduce repository/service interfaces, a generic writer engine or a new folder architecture. Creation, replacement and deletion have different safety guarantees. Repetition is preferable to hiding those differences; extract only after three real equivalent call sites justify it.
- Private client/protocol plumbing may change with its callers and tests in the same diff. No legacy aliases are required. Canonical behavior and exact-request retry safety stay intact unless an explicit contract decision changes them.
- Preserve crash coverage, including source-transform fault harnesses affected by readability changes.
- Exit: one human-readable traced request and reviewed diff, not a fully redesigned backend. Broader command typing and doctor/purge/order cleanup need real demand.
- Completed: [request trace and evidence](docs/update-request-trace.md). Types/lint pass; 1,621 passed/two known skips; actual Windows Node/SEA 38/38, source-transform fault coverage intact. Invalid receipt shape preserves bytes/history/pending evidence and retry authority. No new capabilities or native launch.

### 4. Prove a native vertical slice (`m1p`)

Keep the useful browser work, but add no browser mutations to fill a native blocker.

- Adapt useful existing UI through the shared application path. Add only the launch/client changes needed for capture, content editing, single-task status/latest-status undo, search and CLI-visible refresh.
- Require explicit disposable root/cache/profile selection and truthful capability limits; no legacy fallback. This pilot is a temporary validation step, not a permanent second application. `7hr` found Windows SQLite lock-journal long-path refusal: validate supported complete lock-journal/cache/profile lengths before dispatch, or separately prove longer paths; never silently shorten an uncertain selection.
- Exercise keyboard/mouse/focus, external CLI edits without restart, relaunch persistence and a declared interrupted-write/lost-reply recovery scene with original-request replay.
- Prove separate-root backup/restore through existing CLI controls; no new migration/control UI is required.
- Record preview/apply friction, definite refusals versus uncertain writes and memory-only retry loss on reload. Safety rules can be changed deliberately, not bypassed for a demo.
- Exit: actual native evidence and runnable instructions on the declared host/profile. Browser/WSL process tests cannot close this gate; full legacy feature parity is not required.
- Completed: [native walkthrough/evidence](docs/windows-native-pilot.md). One explicit Windows/local/main capability, exact selected argv, shared SEA session, full regression **1,657 passed/two known skips**, 31 native tests on both hosts, actual 1100×760 / 720×500 native window checks, zero native axe/design findings. Byte-identical accepted writer bundle; original fixture bytes/history/authority preserved. Memory-only UI request/reload limitations and preview/refusal friction are explicit. No personal selection, migration, signing or release acceptance. Owner `hzv` is still required.

### Owner testing gate (`hzv`, after `26a` and `y9b`)

The owner has deferred testing. Complete the independently useful accessibility fix and disposable conversion rehearsal first. Do not count automation as owner sessions or proceed to default cutover while this gate is open.

- Before owner testing, ensure the client is elegant, minimal and calm. Remove developer-facing home-screen clutter, preserve the established visual identity and check the normal, empty, editor and error states. A passing technical or accessibility check alone does not establish this quality gate. Keep cleanup bounded; do not redesign the app or rebuild feature parity without approval.
- Use realistic disposable tasks in at least three short native sessions across two days. The owner actually captures, edits, completes, undoes, searches and reopens the app.
- Record defects, unnecessary clicks, technical language, focus and retry/reload friction. Fix only scoped defects in this loop.
- Produce a short **keep / replace / intentionally drop** checklist for daily use: keyboard capture/editing, classification, priorities, filters, search, relationships, manual order, undo and backup/restore. A missing essential capability becomes a named bounded prerequisite to `dvs`; do not automatically rebuild the whole old feature set.
- The owner already selected the established main UI. Identify backend support/integration gaps and superseded engineering prototypes; do not ask the owner to rebuild or renegotiate the client. The owner must agree any deliberate workflow losses before cutover.
- Exit: an owner-reviewed usability report and essential-workflow checklist, including agreement that the client retains the app's elegant, minimal character. Do not expand the model or add speculative frameworks.

### Pre-test migration rehearsal (`y9b`)

**Complete:** [rehearsal, limits, dependency inventory and short runbook](docs/migration-rehearsal.md). Existing converter/publication unchanged; eight-task full-field/nested-order process rehearsal plus 221 focused passing checks, retained real interruption/refusal tests, and source/bundled CLI runbook smoke. Full regression: 1,666 passed/two known skips; types/lint pass. WSL2 Linux Node only; Windows/Android migration remains withheld. No personal source accessed, no owner session counted, no default switched.

This disposable rehearsal now precedes `hzv`. It verifies conversion fidelity and interruption handling independently of the later owner workflow review. It does not authorize personal source access, a native migration capability expansion or a default switch.

The owner is the only existing user. This is a bounded conversion job, not a general rollout/version-compatibility program.

- Inspect the existing converter first. Reuse its verified mapping and publication path; remove unnecessary orchestration only where it does not weaken preservation or interruption safety.
- Plan for one frozen legacy snapshot, an independent backup and a separate destination. Test disposable fixtures first; use a copy of personal tasks only after explicit approval to read that data. Never modify the original source.
- Verify task IDs/counts, Markdown, statuses, priorities, classification, timestamp instants, graph edges and full sibling order. Report actual refusal cases rather than guessing around unsupported records.
- Verify the converted root opens with fresh authority and that an interrupted attempt is recognizable and recoverable. Do not transfer old cache/receipt authority.
- Keep instructions short: back up, pause writers/sharing, convert, inspect, explicitly switch. Returning to the preserved snapshot loses later new-format edits; keep both roots rather than promise reverse conversion.
- Exit: verified disposable rehearsal, minimum isolated converter dependencies and a short one-user runbook. **Actual personal conversion and selection still require explicit owner approval.** No migration wizard, dual-write engine or perpetual old-client support.

### 7. Make the clean cut (`dvs`)

This is a functional consolidation, not a cosmetic prefix-removal project.

- Make the new model/application path the sole default for UI and CLI. Remove old dispatch/fallback modes, opt-in version flags and temporary pilot routes rather than keeping compatibility aliases.
- Reuse the reviewed UI pieces and satisfy the essential-workflow checklist. Delete superseded runtime, unused prototypes and their obsolete tests after checking callers. Do not remove current safety tests merely to lower line count.
- Rename surviving production modules, types and commands/scripts by responsibility without `v2` code names. Update imports, entrypoints and tests together; no facade wrappers pointing to a still-parallel implementation.
- Keep only the minimum legacy-reading code needed by the isolated one-time migration tool. Default app startup must not import or initialize a legacy engine. Old application source and binaries remain recoverable through Git/artifacts, not shipped forever.
- Reconcile documentation into one current model/API/storage/UI contract. Keep schema/protocol numbers and historical fixture names where meaningful, not two competing current specs. Do not bulk-rewrite historical evidence as if it had tested the final app.
- Account for changed cache/profile locations and authority bindings. Never strand pending journals or discard needed receipts/backups for a rename; document an explicit safe transition rather than silently switching locations.
- Exit: one default UI/CLI/native launch path, responsibility-based production names, isolated migration tooling, no legacy application fallback, and disposable workflow/restart/recovery proof. Release only platforms actually validated.

## Publication gate and deferred work

`xz2` reviews the consolidated application, essential workflow, migration rehearsal and native evidence. It records one explicit next release scope or blockers, not an unbounded “finish the target” instruction. A Linux pilot alone does not establish Windows readiness; Windows 11 remains the primary target. New platform or missing-essential work gets a bounded task before implementation.

| Work | Disposition |
| --- | --- |
| Missing daily-use capabilities | Existing UI/workflows remain the baseline; scope native support/integration individually, use `hzv` to confirm essentials and block `dvs` if unresolved |
| Inherited list accessibility (`26a`) | Completed with original visual/keyboard behavior and bounded native evidence; no owner session counted |
| Broad Windows writes (`82r`) / Android SAF port (`erd`) | Held for explicit platform scope; use the same model/rules, not another versioned engine |
| Remaining corpus (`23b`) | Audit applicability to declared support, not implement unrelated features to reach 112/112 |
| Wider native/provider matrix (`gex`) | Validate the replacement app for selected release claims; do not keep a legacy-native gate |
| Independent interoperability (`zaq`) | Needed only for a public-standard claim, not app publication |
| More advanced browser/control features, multi-source/adapters | Off the critical path; retain only if the real product needs them |
| Hosted sync, collaboration, recurrence, reminders, calendars, built-in AI, plugins, MCP | Deferred pending actual use evidence |

The old legacy-only native task `69t` is superseded, not passed. Its still-relevant lifecycle/restore/focus obligations move to `m1p` and replacement-app release validation (`gex`). Closed implementation/evidence tasks remain historical records; do not reopen them to rewrite history.

## Safety and working protocol

- No need for compatibility with unknown external installations. Cleanly change private APIs with their clients and tests. Consequential model/format changes still need an explicit spec decision.
- Compatibility with old code is optional; preserving the owner's data is not. Use separate-root migration and independent backups, no implicit live upgrade or personal-root inference.
- Canonical JSON owns task state. SQLite also retains local receipts/history; deleting it is not a supported rebuild. Preserve active recovery evidence and original-request retry safety.
- TypeScript owns domain rules; Tauri 2/React and bundled Node remain the desktop direction. Keep native/storage details at concrete boundaries. License stays MIT.
- Keep accepted literal-title/classification, sparse order, timestamp/status rules unless a deliberate decision changes them. Do not silently alter inherited readiness behavior such as done dependencies still blocking.

For each task:

1. Read this plan, `sq show ID`, relevant specs and neighboring code. Start from `sq list --ready`; user instructions override queue priority.
2. Mark only that task in progress. Use disposable data and one writer per working directory.
3. Apply clean-code in order: delete → simplify → rename → extract → pattern. Keep one explainable outcome; run the review checklist, types/lint/full tests and relevant process/UI checks.
4. Report the exercised command/client flow, changed lines, failures/skips/native limits and next small step. Update task evidence, not every historical milestone paragraph.
5. Self-review each task, quick commit validated scoped changes and continue while the owner's autonomous loop is active. **Stop or pause for a real blocker**, including missing native guarantees, failing checks, personal-data permission or required owner participation; do not fill the gap with features or declare that gate passed. Preserve in-progress state/diff and a durable handoff at quota/compaction boundaries.
6. SQ is shared local metadata under `.sift/`, outside Git. Keep pi-task fields under `pi_tasks` and dependencies consistent with this plan.

Commands and native setup are in [README](README.md) and [development](docs/development.md). This planning change authorizes the destination and scope, not implemented platform support, personal migration or a release claim.
