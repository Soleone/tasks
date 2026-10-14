# Tasks: one-application roadmap

**Current roadmap: 2026-10-14** (daily-use scope agreed; Linux backend + `pnpm dev:web` focus). Continues the 2026-10-04 clean-cut decision, not a new architecture. This file is the single source of direction, work order and acceptance gates. The previous detailed milestone diary is preserved at `86e3c1b:PLAN.md`; the original reset baseline remains `905c65a`.

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
| Dated reports and handoffs | Historical evidence, never competing current execution instructions |

Current facts:

- Unflagged app/backend/CLI still use the legacy model. The opt-in Linux backend implements the broader replacement command subset.
- Explicit Windows selection connects the established main UI to the smaller proven SEA profile. Child/relationship/order/batch/general-undo and some control actions remain withheld. Friendly Windows CLI writes and durable final-route preferences are unproved. See the support index, not historical milestone wording.
- Native technical proofs exist, but the latest owned Windows launches stopped before an observed main Tasks WebView. **Automated Windows diagnosis `100` is owner-deferred**, not passed or executable merely because SQ lists it ready. The source copy on D: was synced to `0b18727`; later documentation did not deploy new code.
- Disposable migration/recovery/fresh-authority rehearsal is complete on Linux/WSL2 only. Personal data, Windows/Android conversion and actual selection remain unapproved.
- Owner dogfood `hzv` is deferred: **zero owner sessions**. Default cutover `dvs` and publication `xz2` remain gated.
- `pnpm dev:web` ([launcher](scripts/dev-web.mjs), [options](scripts/dev-web-options.mjs)) builds the backend, starts the dev HTTP bridge plus Vite. Unflagged it renders the established `App` on the **legacy** model. With `--v2-root`/`--database --v2-edit`, [`V2App`](src/V2App.tsx) confirms root/cache/profile and opens the established `App` through [`MainWorkspace`](src/platform/mainWorkspace.ts) over the bridge, like the Windows native route. The native editor keeps a nine-command list (create/update, six statuses, eligible `task.status.undo`). The Linux bridge advertises those nine plus `task.move`, `task.dependency.add/remove` (which also covers child capture) and `task.reorder`. Without `--v2-edit` the query-only reader (`V2ReaderView`) is retained; the former preview/apply workbench editor was retired.
- Android schema-2 read-only inspection stopped as an evidenced no-op on tooling/provider blockers (no commit; worker record outside the repository).

Completed work is not the queue: cache fix `fwk`; bounded Windows process/native proofs and update trace (`fcf`, `dh1`, `mg8`, `7hr`, `byy`, `gxm`, `m1p`); original-client restoration `4t6`; list accessibility `26a`; migration rehearsal `y9b`; unattended QA/argv checks `3et`/`3rp`; inventory `q6z`; copy-stage pruning `wf3`; support reconciliation `pa1`; selected receive guidance `8v8`; contrast fix `asy`; candidate invariant audit `8x1`. Historical commits/counts/limits remain in their reports and SQ records.

Latest audit validation at `86e3c1b`: types/lint pass, **1,662 regressions passed/two existing skips**, 313 focused checks passed/one optional transport skip. Recorded original corpus execution remains **101/112**, not the regression count or an instruction to implement every remaining target.

## Agreed daily-use scope and Linux/web focus (2026-10-14)

The owner agreed each item individually. This is **scope approval**: the replacement engine must keep these workflows in the established UI. It is not implementation, native acceptance, owner dogfood, cutover or release approval.

| Keep in the new engine | Recorded detail |
| --- | --- |
| Capture/edit/complete/delete and their keyboard shortcuts | Current [usage guide](docs/usage-guide.md) contract |
| Classifications and priorities | Accepted literal/slug model; old case-label dictionary stays deliberately dropped |
| Filters and search | Current toolbar/search behavior |
| Parent/child tasks and dependency blocking | Current rules; done dependencies still block, canceled do not |
| Manual ordering | Persistent across reopen |
| Bulk actions | Preserve all-or-refuse batch semantics; no per-task fallback loop |
| Undo | About the last **50** actions, retained across close/reopen **on the same client**. Client-local durable history is sufficient; shared/cross-client undo is not required and may be unavailable after another client changes data. Reuse existing receipt/history/inverse machinery; a command pattern is a suggestion, not a mandated rewrite. Conflict/recovery safeguards stay |
| Backup and restore | Covers the existing backup/import/export overlap. **No new sharing feature** |
| Global focus shortcut | Native desktop only; cannot be accepted in a browser |
| Settings, themes and preferences | Saved across restarts |

No deliberate workflow losses were agreed. Platform and host decisions:

- **Current execution focus:** Linux Node backend driven through the existing `pnpm dev:web` frontend, reusing `App` and its components. No standalone browser storage engine, no second client and no new workbench features; the browser only calls the selected Linux backend gateway. This supersedes Windows-first as the *execution priority*, not any platform validation claim.
- **Windows** remains the first release platform. Launch/integration checks are **deferred to the owner's Windows machine**; `100` stays paused. Linux/browser evidence never closes a Windows gate.
- **Android** is maintained and will be migrated to the new format, not dropped. Work is deferred on tooling/provider blockers and does not block a Windows release.
- **Conversion host:** the rehearsed Linux/WSL2 route (`y9b`) initially; no Windows converter proof is a prerequisite. Reading, converting or selecting personal data still needs separate explicit permission.

## Owner-approved desktop capture simplification

Separate from the frozen candidate/prune queue: Node V2 `task.create` now uses one initial snapshot, a hidden sibling stage and native rename, with selected parent/destination and physical-binding rechecks only. New creates emit no pending/progress evidence; orphan stages are never adopted. The owner accepts canonical publication before SQLite receipt/history commit and possible duplicate creation on retry. Committed receipts still replay; explicit old pending-create recovery remains available. Owner-approved F10 now refuses and preserves an already-present stage without a durably bound identity, so a legacy stage-write-before-binding crash requires manual inspection instead of adoption. See the [accepted design](spec/v2/storage.md#task-creation); the future local-SAF decision remains gated below.

Android V2 writes remain gated pending end-to-end native integration; arbitrary SAF/cloud providers are not in scope. Historical Windows journaled-process evidence does not accept this new route: the updated [Windows harness/report boundary](docs/windows-create-proof.md#simplified-route-proof-pending) awaits actual Windows Node/SEA execution. Linux/WSL2 checks do not close that gate or resume deferred Windows diagnosis. Stop after this scoped implementation checkpoint; no prune-queue or later work is authorized.

## Owner-approved pnpm launch simplification

The native launch entry point is `pnpm dev:native`, with project `shellEmulator: true` preserving Windows path arguments. Alternative launch recipes/checker routes were removed; strict path and separator refusals remain. `pnpm test:native:argv` passed six actual-Windows launch-preparation/refusal scenes on disposable paths; see [argv evidence](docs/windows-launch-argv.md). This is not a new app launch, owner session, native acceptance or resumption of `100`. Stop at this scoped checkpoint; the frozen retrospective queue remains separate.

## Work order

The destination is approved. **Listing later work does not approve its implementation.** Execute one bounded task, validate, commit and stop at its checkpoint. The old autonomous next-ready-task loop is not the current execution policy.

| Order | Work | Exit / gate |
| --- | --- | --- |
| **1. Implemented** | Production ordering coverage retained in `55f330a` | Test-only additions; see completion reference below. No native acceptance implied |
| 2 | Retire redundant local candidate tests | First retain remaining unique fault-position/property checks and design/limitation evidence from `8x1`; remove only proven redundant suites/dead helpers. Keep transport dependencies. Separately approve this scope |
| **3. Agreed 2026-10-14** | Daily-use and release scope | Recorded above. Scope approval only |
| 4 | Close agreed workflow gaps, **Linux backend + `pnpm dev:web` first** | One bounded slice at a time, after the [implemented established-client slice](#implemented-slice-established-client-on-the-linux-backend); reuse existing UI/backend. Proof depth is set per slice; the recovery-proof text in `spec/v2/conformance.md` governs conformance claims, not per-slice integration gates. Linux/web slices need no Windows launch. **Windows integration** of each family still starts with a basic manual Windows launch reaching the main Tasks WebView on the owner's machine; do not enable unproved Windows writers. Native acceptance waits for the deferred checks below |
| 5 | Owner acceptance and migration readiness | Entry: a basic manual Windows launch reaches the main Tasks WebView (see Owner and native gates). `hzv`: actual owner sessions/checklist. Conversion uses the proved Linux/WSL2 `y9b` route. Personal access/conversion/selection needs explicit separate permission |
| 6 | Make the clean cut (`dvs`) | Agreed essentials, owner acceptance, verified rehearsal and required native evidence precede one default app/runtime/spec. Preserve data and local recovery authority |
| 7 | Publication review (`xz2`) | Review the consolidated default route against the explicitly chosen release platforms; record remaining blockers, no blanket release claim |

Stages 1–2 are finite preparation, not an invitation to keep finding cleanup projects while acceptance waits. Stages 3–5 may feed back a named prerequisite, but must not expand into full target implementation or recreate a second client. Stop for an unresolved owner/platform decision instead.

Stage 2 remains separately gated. The owner-approved bounded spec-authoritative test cleanup (`dbc47ca`) corrected one misleading candidate test; it did not retire the candidate suites.

## Implemented slice: established client on the Linux backend

**Implemented 2026-10-14** (commit recorded in the worker completion). Reader decision: the read-only `--v2-root` reader is **retained** unchanged for query-only inspection; the `--v2-edit` workbench editor (`V2TaskEditor` and its Chromium runner) was retired because `App` replaces it. Checks 1–6 are covered at client/bridge level by `scripts/mainClientRouting.test.mjs` and `scripts/v2AppEditor.test.mjs`; the Chromium walk in check 7 was **not run** because `agent-browser`/Chromium are not installed on the worker host, so browser focus/refresh/retry-dialog behavior on this route remains unwalked. Original scope, for reference: every agreed workflow needs the established `App` running on the replacement engine before it can be closed on Linux/web. The slice routes an explicit `pnpm dev:web --v2-root R --database C --v2-edit` selection to `App` via `MainWorkspace`, exactly as the Windows route does, and exposes no new workflow family.

Reuse: `V2App` confirmation screen, `MainWorkspace`, `V2WorkspaceReader`/`V2EditorClient` HTTP connections, `selectMainWorkspace` and the withheld-action wrappers in `backendClient`, the dev bridge allowlist/selection token, and the main client's retry dialog. Bring the bridge's editor command list in line with the native editor list (add eligible single-task `task.status.undo`) so the established Ctrl+Z works; add nothing else.

Acceptance checks, on disposable data:

1. Unflagged `pnpm dev:web` still renders the legacy `App` unchanged. The read-only `--v2-root` reader is untouched or explicitly retired in this slice; decide one, not both.
2. With `--v2-edit`, confirmation shows root/cache/profile before any query, then the established `App` renders with the [home focus contract](docs/usage-guide.md#home-screen-contract) (list or empty shell focused, never New task).
3. C/Enter capture and inline edit, shorthand classification round-trip, 0–4 priority, Space/Shift+Space/P/Delete statuses and Ctrl+Z eligible status undo persist through the Linux backend and are present after reload and re-confirmation (selection is not saved).
4. Filters, search and an external `tasks-cli --v2-root … --database …` edit refresh the visible list without stealing focus or draft content.
5. Child capture, parent/dependency, reorder, batch and general undo are still refused visibly by the existing wrappers, with no legacy transport fallback (extend `scripts/mainClientRouting.test.mjs` for the HTTP connection).
6. A lost bridge reply locks the original request in the existing retry dialog; Retry same request reuses its envelope.
7. `pnpm check`, `pnpm lint` and focused routing/editor tests pass; a disposable Chromium walk of items 2–6 is recorded or its tooling blocker is stated. No native, Windows or Android claim.

Afterwards, each agreed family is a separate slice through the same route, reusing the Linux backend that already implements it: child capture with parent/dependency edits ([implemented](#implemented-slice-child-capture-and-parentdependency-edits-on-the-linux-route)), manual reorder ([implemented](#implemented-slice-manual-reorder-on-the-linux-route)), general undo with ~50 durable same-client entries, bulk status, backup/restore from Settings, then preferences persistence. Global focus waits for a native desktop slice.

## Implemented slice: child capture and parent/dependency edits on the Linux route

**Implemented 2026-10-14** (commit recorded in the worker completion). Applies only to the explicit Linux `pnpm dev:web --v2-root R --database C --v2-edit` route. The bridge and HTTP editor client share an ordered twelve-command list: the nine native commands followed by `task.move` and `task.dependency.add/remove`. The prior nine-command HTTP handshake is refused. The Windows native selection still requires its nine-command list, so `MainWorkspace.supportsRelationships` is false there and the existing wrappers keep refusing relationship actions before any request.

- **Reuse.** The original Shift+C child capture, the M move picker (including Remove parent) and the B blocker picker call `backendClient`, which routes to `MainWorkspace.createChild`/`relationship`. These use the same write/retry path, envelope checks and expected-version conflict check as status edits. The Linux gateway writers and their done-blocks/canceled-does-not rule are unchanged.
- **Pre-send refusal.** Writer refusals lock the original request like an uncertain reply (deliberate, unchanged). So `MainWorkspace` walks the target's parent or dependency chain via `task.get` and refuses parent cycles, dependency cycles and canceled targets before sending. The blocker picker does not filter dependency cycles itself.
- **Unchanged.** Ctrl+Z still covers only eligible single-task status changes; relationship and capture operations retire the undo entry. Reorder, batch, general undo, purge, activity, export and receive stay withheld. The read-only reader and unflagged launch are untouched.
- **Evidence.** `scripts/mainClientRouting.test.mjs` persists child capture, move to top level and dependency add/remove through the real bridge, both via the `backendClient` wrappers and directly. It checks that a done dependency still blocks and a canceled one does not, refuses cycle/canceled-target/stale edits without a write, and retries a lost dependency-edit reply with an identical envelope. Handshake tests were updated in `v2AppEditor`/`v2NativeClient`. **No browser walk:** `agent-browser`/Chromium are still absent, so picker focus, announcements and refresh on this route are unwalked. No Windows, Android or Linux desktop claim.

## Implemented slice: manual reorder on the Linux route

**Implemented 2026-10-14** (commit recorded in the worker completion). Applies only to the explicit Linux `--v2-edit` route, whose ordered list is now thirteen commands: the twelve above followed by `task.reorder`. The prior twelve-command HTTP handshake is refused; `task.order.normalize` stays refused. The Windows native list is unchanged, so `MainWorkspace.supportsOrdering` is false there and `TaskList`/`backendClient` keep refusing reorder before any request.

- **Reuse.** The original Ctrl/⌘+↑/↓/Home/End controls, their filter preconditions and their switch to Manual order are unchanged. `reorderTasks` routes to `MainWorkspace.reorder`, which shares the write/retry/reconciliation path with the other edits. The [ordering writer](spec/v2/ordering.md#placement) owns placement against the complete scope, tie repair and all-or-refuse journaled writes.
- **Pre-send refusal.** As for relationships, `MainWorkspace.reorder` rereads the selected tasks and anchor and refuses stale versions, mixed scopes, out-of-order selections and selected or out-of-scope anchors before sending.
- **Unchanged.** Order changes retire the Ctrl+Z entry. Batch, general undo, purge, activity, export and receive stay withheld.
- **Evidence.** `scripts/mainClientRouting.test.mjs` reorders through the `backendClient` wrapper and directly through the real bridge. It shows an end-gap move rewrites only the selected file, a no-op returns no operation, and the manual order survives a bridge restart with a fresh cache and reconfirmation. Pre-send refusals send no write; a lost reorder reply retries with an identical envelope. **No browser walk:** tooling is still absent, so focus, announcements and refresh after a move are unwalked.

## Implemented: production ordering coverage

Commit `55f330a` retained three literal public-command allocations and **419 mixed-tie placements** with independently spliced expectations in `src/backend/v2OrderWriter.test.ts`, plus literal prefix/case ordering in `src/backend/v2CanonicalReader.test.ts`. The existing 424 tied/distinct variants and exact-ID tie-break remain. Keep independent expectations, canonical-field constraints and corpus accounting intact.

This is an implementation reference, not a claim that validation was rerun or native acceptance obtained. Stage 2 still requires separate scope approval; no candidate/helper/transport deletion is authorized by this completion marker.

Supporting comparison for the candidate-retirement checkpoint: `$DATA/plans/2026-10-07-tasks-candidate-fixture-retirement-review.md` and SQ `sq show 8x1`. If unavailable, stop before retirement rather than inventing its remaining findings.

### Candidate retirement checkpoint

Before stage 2, use the complete `8x1` comparison to preserve remaining pre-intent selected/boundary/partial-JSON/UTF-8 faults, shrinking-gap/compact-key properties, useful grammar literals and the concurrency/entropy/final-read race rationale. These are not all covered at identical positions by existing production tests.

The two local candidate suites total 376 lines/26 tests. The optional Syncthing probe still uses the candidate planner and transitive batch recovery/UTF-8 helpers: **do not delete all four files or the fractional-indexing runtime dependency.** Preserve independent expected fixtures and operation-family recovery tests. A transport rewrite/retirement requires its own scope. Treat the final-read/rename race as a documented best-effort limit, never a lossless-CAS guarantee or a required overwrite behavior.

## Owner and native gates

The keep/replace/drop checklist is [agreed](#agreed-daily-use-scope-and-linuxweb-focus-2026-10-14): keep every listed workflow, no new sharing feature. The [inventory](docs/refactor-inventory.md#3-workflow-parity-what-is-actually-available) and [unattended QA](docs/unattended-qa.md) already identify the gaps; do not repeat discovery or ask the owner to rebuild the chosen interface.

- Windows 11 remains the first release platform; its launch/integration checks are deferred to the owner's machine. Android is maintained and its migration deferred on tooling; this does not authorize shipping a separate legacy Android product. Broad Windows `82r`, Android `erd`, wider matrix `gex` and independent interoperability `zaq` are not automatic work.
- Deferred platform checks, still required before native acceptance: manual Windows launch to the main WebView, sidecar/permission route, close/relaunch, durable preferences, global focus shortcut, original-request/recovery on Windows; Windows simplified-create Node/SEA proof; Android schema-2 read/write/migration on the standard picker. Linux desktop (Tauri) acceptance is likewise not established by browser checks.
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
5. Reconcile the temporary specs into one current contract. Owner-approved SP-1/SP-2 moved accepted rationale into spec and retired the nine obsolete ideas pages into Git history before cutover; physical `spec/v2/` promotion still waits for `dvs`. Preserve dated evidence with its original counts/limits, not rewritten final-app claims.
6. Explicitly handle final root/cache/profile/preferences selection. Never strand pending work or discard receipts/history/original-request authority for a rename. Prove the default UI/CLI/native restart/recovery route on disposable data.

`xz2` then reviews publication scope, actual declared-platform evidence and remaining packaging/signing/release blockers. A technical test count, unsupported target MUST, Linux pilot or dependency completion is not release acceptance. Personal migration is not implicitly authorized by either task.

## Safety and working protocol

- Canonical JSON owns task state; SQLite also owns local receipts/history/undo authority. It is not wholly disposable. Preserve original root/cache/profile bindings, pending journals, raw recovery copies and immutable retry envelopes. Canonical backup alone does not preserve old retry authority.
- Keep accepted literal title/classification, sparse order, timestamp/status rules and inherited done-dependency blocking unless a deliberate contract decision changes them. Distinct creation/replacement/deletion/copy/inverse safety families are not interchangeable generic writers.
- Use separate-root migration and independent backups. No personal-root inference, implicit live upgrade, original-source mutation or permission inferred from a handoff.
- Check `git status`, this plan, current user scope and relevant `sq show ID` before work. SQ readiness only describes dependencies; it does not approve owner gates or deferred `100`.
- Mark one SQ task in progress. Keep metadata under `pi_tasks`; use disposable data and one writer per cwd. Delegation needs explicit authorization.
- Apply clean-code and its review checklist; run lint and proportionate checks for the approved scope. Set per-family proof depth when approving that family, not exhaustive proof by default; required native-platform checks and native launch gates remain in force. Record failures/skips and actual platform limits. Update the completed task, current next action and support index only where behavior changed, not every historical report.
- Commit validated scoped repository changes and **stop at the approved task's checkpoint**. Do not select another task or restart Windows diagnosis automatically. Preserve evidence/diff and report any unresolved host, contract, tooling or permission blocker.

## Next-session boundary

Read this file and AGENTS.md. Stage 1 is implemented and stage 3 is agreed. The [established-client Linux slice](#implemented-slice-established-client-on-the-linux-backend), the [child capture with parent/dependency edits slice](#implemented-slice-child-capture-and-parentdependency-edits-on-the-linux-route) and the [manual reorder slice](#implemented-slice-manual-reorder-on-the-linux-route) are implemented. **Next action:** the next agreed family through the same route (general undo with ~50 durable same-client entries), once queued; stop at its checkpoint. Stage 2 candidate retirement awaits separate scope approval. No Windows/Android work, personal data, cutover or release is authorized by this roadmap update. Ignore older autonomous-loop instructions.

[README](README.md) and [development](docs/development.md) own commands and host setup; this roadmap does not authorize platform expansion or personal selection.
