# Tasks: one-application roadmap

**Current roadmap: 2026-10-08.** Continues the 2026-10-04 clean-cut decision, not a new architecture. This file is the single source of direction, work order and acceptance gates. The previous detailed milestone diary is preserved at `86e3c1b:PLAN.md`; the original reset baseline remains `905c65a`.

## Direction and destination

Tasks is a local-first, keyboard-first app for one person working alongside external agents:

> capture quickly → clarify → choose work → complete it → understand what changed

Deliver **one elegant application**, not permanent v1/v2 coexistence:

- One task model and command path shared by UI, CLI and agents, with concrete TypeScript, Node, SQLite and native boundaries. Tauri 2/React plus bundled Node remain the desktop direction; license stays MIT.
- Preserve `App`, `TaskList`, `TaskComposer`, pickers, compact toolbar, themes, help/settings and established keyboard/mouse/focus behavior. The engineering workbench is not the daily client. No frontend rewrite.
- One default runtime with responsibility-based production names, no legacy fallback or product-version routing. Keep meaningful persisted schema/protocol versions.
- One current specification at cutover, plus a small isolated one-time converter and preserved backups. No compatibility facade, dual-write engine, strangler framework, generic writer engine, plugin/adapter system or public-standard requirement.

Every client must remain minimal, calm and visually coherent. Keep the task list primary; disclose secondary technical details in settings/help or at the point of need. Necessary confirmations and actionable safety warnings stay visible. Technical tests alone do not establish usability or authorize workflow losses.

## Authority and present state

**Read this plan first, not the latest handoff or the highest-priority ready SQ item.**

| Record | Purpose |
| --- | --- |
| `PLAN.md` | The only roadmap: next action, later sequence, approval and stop/go gates |
| SQ | Execution status/evidence for individually scoped tasks; not another roadmap |
| [Current support](docs/support.md) | What actually runs, exposed commands, platform/client limits |
| [Guidelines](GUIDELINES.md), [usage guide](docs/usage-guide.md) | Product principles and established interaction contract |
| [Refactor inventory](docs/refactor-inventory.md) | Audited assets, gaps, deletion candidates and spec/ideas dispositions; supporting evidence, not permission to execute every proposal |
| [Root specs](spec/overview.md), [replacement targets](spec/v2/overview.md) | Temporary implemented-legacy/accepted-target split, reconciled at cutover |
| Dated reports, handoffs and [ideas](ideas/overview.md) | Historical evidence or rationale, never competing current execution instructions |

Current facts:

- Unflagged app/backend/CLI still use the legacy model. The opt-in Linux backend implements the broader replacement command subset.
- Explicit Windows selection connects the established main UI to the smaller proven SEA profile. Child/relationship/order/batch/general-undo and some control actions remain withheld. Friendly Windows CLI writes and durable final-route preferences are unproved. See the support index, not historical milestone wording.
- Native technical proofs exist, but the latest owned Windows launches stopped before an observed main Tasks WebView. **Automated Windows diagnosis `100` is owner-deferred**, not passed or executable merely because SQ lists it ready. The source copy on D: was synced to `0b18727`; later documentation did not deploy new code.
- Disposable migration/recovery/fresh-authority rehearsal is complete on Linux/WSL2 only. Personal data, Windows/Android conversion and actual selection remain unapproved.
- Owner dogfood `hzv` is deferred: **zero owner sessions**. Default cutover `dvs` and publication `xz2` remain gated.

Completed work is not the queue: cache fix `fwk`; bounded Windows process/native proofs and update trace (`fcf`, `dh1`, `mg8`, `7hr`, `byy`, `gxm`, `m1p`); original-client restoration `4t6`; list accessibility `26a`; migration rehearsal `y9b`; unattended QA/argv checks `3et`/`3rp`; inventory `q6z`; copy-stage pruning `wf3`; support reconciliation `pa1`; selected receive guidance `8v8`; contrast fix `asy`; candidate invariant audit `8x1`. Historical commits/counts/limits remain in their reports and SQ records.

Latest audit validation at `86e3c1b`: types/lint pass, **1,662 regressions passed/two existing skips**, 313 focused checks passed/one optional transport skip. Recorded original corpus execution remains **101/112**, not the regression count or an instruction to implement every remaining target.

## Owner-approved desktop capture simplification

Separate from the frozen candidate/prune queue: Node V2 `task.create` now uses one initial snapshot, a hidden sibling stage and native rename, with selected parent/destination and physical-binding rechecks only. New creates emit no pending/progress evidence; orphan stages are never adopted. The owner accepts canonical publication before SQLite receipt/history commit and possible duplicate creation on retry. Committed receipts still replay; explicit old pending-create recovery remains intact. See the [design and future local-SAF decision](ideas/task-create-simplification.md).

Android V2 writes remain gated pending end-to-end native integration; arbitrary SAF/cloud providers are not in scope. Historical Windows journaled-process evidence does not accept this new route: the updated [Windows harness/report boundary](docs/windows-create-proof.md#simplified-route-proof-pending) awaits actual Windows Node/SEA execution. Linux/WSL2 checks do not close that gate or resume deferred Windows diagnosis. Stop after this scoped implementation checkpoint; no prune-queue or later work is authorized.

## Owner-approved pnpm launch simplification

The native launch entry point is `pnpm dev:native`, with project `shellEmulator: true` preserving Windows path arguments. Alternative launch recipes/checker routes were removed; strict path and separator refusals remain. `pnpm test:native:argv` passed six actual-Windows launch-preparation/refusal scenes on disposable paths; see [argv evidence](docs/windows-launch-argv.md). This is not a new app launch, owner session, native acceptance or resumption of `100`. Stop at this scoped checkpoint; the frozen retrospective queue remains separate.

## Work order

The destination is approved. **Listing later work does not approve its implementation.** Execute one bounded task, validate, commit and stop at its checkpoint. The old autonomous next-ready-task loop is not the current execution policy.

| Order | Work | Exit / gate |
| --- | --- | --- |
| **1. Implemented** | Production ordering coverage retained in `55f330a` | Test-only additions; see completion reference below. No native acceptance implied |
| 2 | Retire redundant local candidate tests | First retain remaining unique fault-position/property checks and design/limitation evidence from `8x1`; remove only proven redundant suites/dead helpers. Keep transport dependencies. Separately approve this scope |
| 3 | Agree the remaining daily-use and release scope | Use the existing workflow inventory, not another open-ended audit. Owner confirms essentials, deliberate losses, release platforms and conversion host. Existing UI/workflows remain the baseline |
| 4 | Close only agreed workflow/native-route gaps | Approve/prove one concrete family at a time; reuse existing UI/backend. Do not enable unproved Windows writers. Native acceptance waits for the separately resumed checks below |
| 5 | Owner acceptance and migration readiness | `hzv`: actual owner sessions/checklist. Retain `y9b` rehearsal; choose its proved Linux route or approve a native converter proof. Personal access/conversion/selection needs explicit separate permission |
| 6 | Make the clean cut (`dvs`) | Agreed essentials, owner acceptance, verified rehearsal and required native evidence precede one default app/runtime/spec. Preserve data and local recovery authority |
| 7 | Publication review (`xz2`) | Review the consolidated default route against the explicitly chosen release platforms; record remaining blockers, no blanket release claim |

Stages 1–2 are finite preparation, not an invitation to keep finding cleanup projects while acceptance waits. Stages 3–5 may feed back a named prerequisite, but must not expand into full target implementation or recreate a second client. Stop for an unresolved owner/platform decision instead.

## Implemented: production ordering coverage

Commit `55f330a` retained three literal public-command allocations and **419 mixed-tie placements** with independently spliced expectations in `src/backend/v2OrderWriter.test.ts`, plus literal prefix/case ordering in `src/backend/v2CanonicalReader.test.ts`. The existing 424 tied/distinct variants and exact-ID tie-break remain. Keep independent expectations, canonical-field constraints and corpus accounting intact.

This is an implementation reference, not a claim that validation was rerun or native acceptance obtained. Stage 2 still requires separate scope approval; no candidate/helper/transport deletion is authorized by this completion marker.

Supporting comparison for the candidate-retirement checkpoint: `$DATA/plans/2026-10-07-tasks-candidate-fixture-retirement-review.md` and SQ `sq show 8x1`. If unavailable, stop before retirement rather than inventing its remaining findings.

### Candidate retirement checkpoint

Before stage 2, use the complete `8x1` comparison to preserve remaining pre-intent selected/boundary/partial-JSON/UTF-8 faults, shrinking-gap/compact-key properties, useful grammar literals and the concurrency/entropy/final-read race rationale. These are not all covered at identical positions by existing production tests.

The two local candidate suites total 376 lines/26 tests. The optional Syncthing probe still uses the candidate planner and transitive batch recovery/UTF-8 helpers: **do not delete all four files or the fractional-indexing runtime dependency.** Preserve independent expected fixtures and operation-family recovery tests. A transport rewrite/retirement requires its own scope. Treat the final-read/rename race as a documented best-effort limit, never a lossless-CAS guarantee or a required overwrite behavior.

## Owner and native gates

Before closing gaps, agree a short **keep / replace / intentionally drop** checklist for capture/editing, classification/priorities, filters/search, child/parent/dependency work, manual order, undo/batches, backup/restore, global focus, preferences/themes and sharing/export. The [inventory](docs/refactor-inventory.md#3-workflow-parity-what-is-actually-available) and [unattended QA](docs/unattended-qa.md) already identify the gaps; do not repeat discovery or ask the owner to rebuild the chosen interface.

- Windows 11 remains the primary target. Confirm any additional release platforms; Windows-first does not authorize shipping a separate legacy Android product. Broad Windows `82r`, Android `erd`, wider matrix `gex` and independent interoperability `zaq` are not automatic work.
- Browser/shared-UI and backend tests may support appropriate approved tasks. Legacy browser regressions do not prove replacement native parity. Linux process management does not prove Windows readiness.
- **Keep `100` paused.** Later native work begins with a basic manual Windows launch, then the supported sidecar/permission route, close/relaunch, persistence and original-request/recovery checks. Further automated startup investigation needs separate bounded owner approval. Never attach to/stop existing owner sessions, inspect personal windows/data, change security/permissions or install/repair runtimes without permission.
- Missing native essentials get individually approved support/integration tasks, such as parent move/remove, child capture, reorder or a particular inverse family. No blanket platform port, silent fallback or browser mutations to bypass a native blocker.
- `hzv` requires at least three short actual owner sessions across two days on realistic disposable data, using the restored main client. Capture/edit/complete/undo/search/refresh/reopen, keyboard/mouse/focus/retry friction and elegance must be owner-reviewed. Automation counts as zero sessions; scoped defect fixes do not waive the gate.
- `y9b` already proves disposable frozen-source/backup/full-field/order/restart/recovery/fresh-authority conversion on Linux/WSL2. Reuse its [runbook](docs/migration-rehearsal.md), do not build a wizard or redo the rehearsal without a reason. Choose the proved host or separately prove Windows conversion. Personal source reading, conversion and selection are separate permissions, not consequences of this roadmap.

## Clean-cut and publication exits

`dvs` is functional consolidation after the gates above, not a cosmetic prefix-removal project:

1. Make the new model/command path the sole default across the agreed UI/CLI/native platforms. Remove legacy dispatch/fallback flags and temporary pilot/workbench product routes together.
2. Reuse established UI and satisfy the agreed essentials. Delete obsolete runtime/prototypes/tests only after caller and invariant checks; do not discard useful recovery or client/retry evidence to reduce line count.
3. Rename surviving production code by responsibility and update imports, entrypoints/scripts/tests together. No versioned runtime hidden behind aliases. Meaningful stored format/wire versions remain.
4. Isolate the minimum legacy reader/converter without importing/initializing the legacy engine during normal startup. Keep original roots, independent backups and historical binaries recoverable; no perpetual coexistence or reverse-conversion promise.
5. Reconcile the temporary specs into one current contract, and retire/reconcile superseded ideas by the inventory's dispositions. Preserve dated evidence with its original counts/limits, not rewritten final-app claims.
6. Explicitly handle final root/cache/profile/preferences selection. Never strand pending work or discard receipts/history/original-request authority for a rename. Prove the default UI/CLI/native restart/recovery route on disposable data.

`xz2` then reviews publication scope, actual declared-platform evidence and remaining packaging/signing/release blockers. A technical test count, unsupported target MUST, Linux pilot or dependency completion is not release acceptance. Personal migration is not implicitly authorized by either task.

## Safety and working protocol

- Canonical JSON owns task state; SQLite also owns local receipts/history/undo authority. It is not wholly disposable. Preserve original root/cache/profile bindings, pending journals, raw recovery copies and immutable retry envelopes. Canonical backup alone does not preserve old retry authority.
- Keep accepted literal title/classification, sparse order, timestamp/status rules and inherited done-dependency blocking unless a deliberate contract decision changes them. Distinct creation/replacement/deletion/copy/inverse safety families are not interchangeable generic writers.
- Use separate-root migration and independent backups. No personal-root inference, implicit live upgrade, original-source mutation or permission inferred from a handoff.
- Check `git status`, this plan, current user scope and relevant `sq show ID` before work. SQ readiness only describes dependencies; it does not approve owner gates or deferred `100`.
- Mark one SQ task in progress. Keep metadata under `pi_tasks`; use disposable data and one writer per cwd. Delegation needs explicit authorization.
- Apply clean-code and its review checklist; run types/lint/full regressions and relevant scoped checks. Record failures/skips and actual platform limits. Update the completed task, current next action and support index only where behavior changed, not every historical report.
- Commit validated scoped repository changes and **stop at the approved task's checkpoint**. Do not select another task or restart Windows diagnosis automatically. Preserve evidence/diff and report any unresolved host, contract, tooling or permission blocker.

## Next-session boundary

Read this file and AGENTS.md. Production ordering coverage is already implemented; do not repeat stage 1. Stage 2 candidate retirement awaits separate scope approval and the checkpoint above. No later work, Windows investigation, capability expansion, personal data or cutover is authorized by this roadmap update. Ignore older autonomous-loop instructions.

[README](README.md) and [development](docs/development.md) own commands and host setup; this roadmap does not authorize platform expansion or personal selection.
