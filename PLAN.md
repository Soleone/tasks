# Tasks: one-application roadmap

**Current roadmap: 2026-10-14** (Linux backend + `pnpm dev:web` slice implemented; owner-reported browser smoke success; full refactor gates remain open). Continues the 2026-10-04 clean-cut decision, not a new architecture. This file is the single source of direction, work order and acceptance gates. The previous detailed milestone diary is preserved at `86e3c1b:PLAN.md`; the original reset baseline remains `905c65a`.

## Documentation cleanup checkpoint (2026-10-15)

Owner-approved documentation-only consolidation: current guides remain at the top of `docs/`; [retained reports](docs/evidence/README.md) now live under `docs/evidence/`. Obsolete v1 workspace/Syncthing guides, the old safety audit/reset narrative and prototype setup recipes are retired to Git at `f762b50`. The migration runbook and original proof counts/limits remain; machine-readable evidence is unchanged. The legacy receive help link is pinned to its historical guide while that runtime remains active. No runtime cutover, spec promotion, native acceptance, personal access or change to the remaining work order is authorized by this cleanup. Validation: types/lint and four specification/corpus-integrity checks pass; 546 local Markdown links/anchors resolve, and all moved JSON reports are byte-identical. No native or browser interaction run was needed for this documentation-only change.

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
| [Guidelines](GUIDELINES.md), [client spec](spec/client/README.md) | Product principles and established interaction contract |
| [Refactor inventory](docs/evidence/refactor-inventory.md) | Audited assets, gaps, deletion candidates and spec/ideas dispositions; supporting evidence, not permission to execute every proposal |
| [Spec](spec/README.md) | One current spec: backend, ecosystem, client |
| Dated reports and handoffs | Historical evidence, never competing current execution instructions |

Current facts:

- Unflagged app/backend/CLI still use the legacy model. The opt-in Linux backend implements the broader replacement command subset.
- Explicit Windows selection connects the established main UI to the smaller proven SEA profile. Child/relationship/order/batch/general-undo and some control actions remain withheld. Friendly Windows CLI writes and durable final-route preferences are unproved. See the support index, not historical milestone wording.
- Native technical proofs exist, but the latest owned Windows launches stopped before an observed main Tasks WebView. **Automated Windows diagnosis `100` is owner-deferred**, not passed or executable merely because SQ lists it ready. The source copy on D: was synced to `0b18727`; later documentation did not deploy new code.
- Disposable migration/recovery/fresh-authority rehearsal is complete on Linux/WSL2 only. Personal data, Windows/Android conversion and actual selection remain unapproved.
- Owner browser smoke is recorded [below](#linuxweb-checkpoint-and-remaining-checklist); no qualifying `hzv` session record is established by those brief replies. Native owner dogfood remains deferred. Default cutover `dvs` and publication `xz2` remain gated.
- `pnpm dev:web` ([launcher](scripts/dev-web.mjs), [options](scripts/dev-web-options.mjs)) builds the backend, starts the dev HTTP bridge plus Vite. Unflagged it renders the established `App` on the **legacy** model. With `--v2-root`/`--database --v2-edit`, [`V2App`](src/V2App.tsx) confirms root/cache/profile and opens the established `App` through [`MainWorkspace`](src/platform/mainWorkspace.ts) over the bridge, like the Windows native route. The native editor keeps a nine-command list (create/update, six statuses, eligible `task.status.undo`). The Linux bridge advertises those nine plus `task.move`, `task.dependency.add/remove` (which also covers child capture), `task.reorder`, `operation.undo` (Ctrl+Z walks back through this client's ~50 most recent own operations, kept across reopen of the same root/cache/profile) and `task.transitionMany` (multi-select status batches), plus `workspace.archive/restore` from Settings to new disjoint destinations without switching selection. Without `--v2-edit` the query-only reader (`V2ReaderView`) is retained; the former preview/apply workbench editor was retired.
- Android schema-2 read-only inspection stopped as an evidenced no-op on tooling/provider blockers (no commit; worker record outside the repository).

Completed work is not the queue: cache fix `fwk`; bounded Windows process/native proofs and update trace (`fcf`, `dh1`, `mg8`, `7hr`, `byy`, `gxm`, `m1p`); original-client restoration `4t6`; list accessibility `26a`; migration rehearsal `y9b`; unattended QA/argv checks `3et`/`3rp`; inventory `q6z`; copy-stage pruning `wf3`; support reconciliation `pa1`; selected receive guidance `8v8`; contrast fix `asy`; candidate invariant audit `8x1`. Historical commits/counts/limits remain in their reports and SQ records.

Latest audit validation at `86e3c1b`: types/lint pass, **1,662 regressions passed/two existing skips**, 313 focused checks passed/one optional transport skip. Recorded original corpus execution remains **101/112**, not the regression count or an instruction to implement every remaining target.

## Agreed daily-use scope and Linux/web focus (2026-10-14)

The owner agreed each item individually. This is **scope approval**: the replacement engine must keep these workflows in the established UI. It is not implementation, native acceptance, owner dogfood, cutover or release approval.

| Keep in the new engine | Recorded detail |
| --- | --- |
| Capture/edit/complete/delete and their keyboard shortcuts | Current [client spec](spec/client/README.md) contract |
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

Separate from the frozen candidate/prune queue: Node V2 `task.create` now uses one initial snapshot, a hidden sibling stage and native rename, with selected parent/destination and physical-binding rechecks only. New creates emit no pending/progress evidence; orphan stages are never adopted. The owner accepts canonical publication before SQLite receipt/history commit and possible duplicate creation on retry. Committed receipts still replay; explicit old pending-create recovery remains available. Owner-approved F10 now refuses and preserves an already-present stage without a durably bound identity, so a legacy stage-write-before-binding crash requires manual inspection instead of adoption. See the [accepted design](spec/backend/safety.md#creating-a-task); the future local-SAF decision remains gated below.

Android V2 writes remain gated pending end-to-end native integration; arbitrary SAF/cloud providers are not in scope. Historical Windows journaled-process evidence does not accept this new route: the updated [Windows harness/report boundary](docs/evidence/windows-create-proof.md#simplified-route-proof-pending) awaits actual Windows Node/SEA execution. Linux/WSL2 checks do not close that gate or resume deferred Windows diagnosis. Stop after this scoped implementation checkpoint; no prune-queue or later work is authorized.

## Owner-approved pnpm launch simplification

The native launch entry point is `pnpm dev:native`, with project `shellEmulator: true` preserving Windows path arguments. Alternative launch recipes/checker routes were removed; strict path and separator refusals remain. `pnpm test:native:argv` passed six actual-Windows launch-preparation/refusal scenes on disposable paths; see [argv evidence](docs/evidence/windows-launch-argv.md). This is not a new app launch, owner session, native acceptance or resumption of `100`. Stop at this scoped checkpoint; the frozen retrospective queue remains separate.

## Work order

The destination is approved. **Listing later work does not approve its implementation.** Execute one bounded task, validate, commit and stop at its checkpoint. The old autonomous next-ready-task loop is not the current execution policy.

| Order | Work | Exit / gate |
| --- | --- | --- |
| **1. Implemented** | Production ordering coverage retained in `55f330a` | Test-only additions; see completion reference below. No native acceptance implied |
| 2 | Retire redundant local candidate tests | First retain remaining unique fault-position/property checks and design/limitation evidence from `8x1`; remove only proven redundant suites/dead helpers. Keep transport dependencies. Separately approve this scope |
| **3. Agreed 2026-10-14** | Daily-use and release scope | Recorded above. Scope approval only |
| **4. Linux/web implemented** | Close agreed workflow gaps, **Linux backend + `pnpm dev:web` first**; remaining evidence/platform work is enumerated [below](#linuxweb-checkpoint-and-remaining-checklist) | One bounded slice at a time, after the [implemented established-client slice](#implemented-slice-established-client-on-the-linux-backend); reuse existing UI/backend. Proof depth is set per slice; the recovery-proof text in `docs/evidence/conformance-history.md` governs conformance claims, not per-slice integration gates. Linux/web slices need no Windows launch. **Windows integration** of each family still starts with a basic manual Windows launch reaching the main Tasks WebView on the owner's machine; do not enable unproved Windows writers. Native acceptance waits for the deferred checks below |
| 5 | Owner acceptance and migration readiness | Entry: a basic manual Windows launch reaches the main Tasks WebView (see Owner and native gates). `hzv`: actual owner sessions/checklist. Conversion uses the proved Linux/WSL2 `y9b` route. Personal access/conversion/selection needs explicit separate permission |
| 6 | Make the clean cut (`dvs`) | Agreed essentials, owner acceptance, verified rehearsal and required native evidence precede one default app/runtime/spec. Preserve data and local recovery authority |
| 7 | Publication review (`xz2`) | Review the consolidated default route against the explicitly chosen release platforms; record remaining blockers, no blanket release claim |

Stages 1–2 are finite preparation, not an invitation to keep finding cleanup projects while acceptance waits. Stages 3–5 may feed back a named prerequisite, but must not expand into full target implementation or recreate a second client. Stop for an unresolved owner/platform decision instead.

Stage 2 remains separately gated. The owner-approved bounded spec-authoritative test cleanup (`dbc47ca`) corrected one misleading candidate test; it did not retire the candidate suites.

## Linux/web checkpoint and remaining checklist

**Reconciled through `02cc8d5`, 2026-10-14.** The agreed non-native daily-use slice is implemented in the existing dev:web frontend: established-client routing (`9b50a67`), relationships (`f255c97`), reorder (`68b1194`), general undo (`e92059e`), durable ~50-action same-client undo (`aa5f75b`), bulk status (`da025ee`), Settings backup/restore (`38e0ecf`) and existing preference coverage (`9713eaa`). Plain-HTTP secure UUID generation was corrected in `02cc8d5`. No remaining Linux/web workflow implementation defect is identified by this reconciliation. Global focus is native-only, not a missing browser feature. This closes the implementation queue for this agreed Linux/web slice, **not the whole roadmap**.

### Owner-reported browser evidence

The owner used the hosted new-engine Linux dev:web client at `http://validator.home:3000` with disposable fixture data. Initial load failed on `crypto.randomUUID`; after `02cc8d5` the owner explicitly said it works. After a proposed capture → edit → complete → undo flow, the owner said it works. After relationships/manual ordering/bulk actions/backup-restore/persistence were listed together, the owner again replied that it works, without individual case details.

Record this as **owner-reported high-level smoke success**, not an instrumented or per-case pass. It supersedes blanket claims that no owner browser use occurred, but does not establish keyboard/mouse/focus details, external-refresh draft preservation, refusal/retry-dialog behavior, exact copy bytes or repeated undo/reopen coverage. Settings/theme controls were not individually reported. Earlier slice paragraphs record tooling/evidence at their own checkpoints; their “no browser walk” statements mean no agent-run instrumented walk, not absence of this later owner smoke. No native acceptance, qualifying multi-day `hzv` record, personal migration, cutover or release follows.

### Exact remaining checklist (ordered by gate)

The list distinguishes evidence, platform integration and consolidation; it is not blanket authorization. Do not fill withheld UI surfaces merely because the backend implements them.

1. **Actionable Linux/web evidence follow-up (recommended next bounded task, not yet authorized):** record a disposable, case-level walkthrough on the existing selected route against the [original checks 2–6](#implemented-slice-established-client-on-the-linux-backend), with their historical withholding superseded by the later implemented families, and the [usage contract](spec/client/README.md). Cover list/empty focus; capture/edit/classification/priority/status; filters/search and external CLI refresh without losing draft/focus; child/parent/blocker edits; manual order across reopen; repeated own undo and one batch undo across reopen; Settings backup/restore review with unchanged source/selection and inspected output; same-origin preferences after reload; and one controlled lost-reply/identical-request retry scene. Reuse existing real-bridge tests for fault/byte checks; no new browser engine, broad test framework or exhaustive recovery rerun. Record actual steps/results and any tooling blocker; fix only demonstrated defects under an approved scope. This improves browser interaction evidence, not native acceptance. There is no reported browser defect requiring a speculative implementation task.
2. **Deferred Linux native/global shortcut:** separately approve a bounded Tauri route/host check and the native-only global focus integration. Prove main-window launch, supported process/permissions, close/relaunch, stable preferences and shortcut focus on the actual intended Linux desktop. Linux Node/browser success supplies none of that native proof. This is not a prerequisite for the completed web slice or automatically a Windows-release gate; do not reopen native diagnosis here.
3. **Deferred Windows, owner's machine (`100` paused):** owner manually reaches the main Tasks WebView first. Then separately scope the supported sidecar/permission, close/relaunch, stable profile/preferences and original-request/recovery checks in [Owner and native gates](#owner-and-native-gates). Prove the simplified-create Node/SEA route ([pending proof](docs/evidence/windows-create-proof.md#simplified-route-proof-pending)). Integrate/prove the still-withheld essentials individually: child/parent/dependency, reorder, ~50-action same-client general undo, atomic bulk status, Settings backup/restore and global focus; resolve friendly CLI writer-profile selection for the final route. See the [live gap matrix](docs/support.md#main-client-gaps-that-remain). No silent allowlist expansion or automated startup investigation. Actual host availability/owner deferral is the blocker, not a Linux test count.
4. **Deferred Android/native/provider acceptance:** resolve tooling/provider blockers before bounded schema-2 standard-picker read/write/migration work; preserve the maintained-Android decision. Emulator/standard picker, physical device and third-party providers are distinct evidence scopes ([AGENTS.md](AGENTS.md#android-emulator), [conformance](docs/evidence/conformance-history.md#profiles-and-evidence)). Android does not block the Windows-first release; do not ship a permanent legacy Android second product. Provider/power-loss/interoperability claims stay unaccepted unless explicitly included and proved; they are not a mandate for arbitrary cloud-provider work.
5. **Owner acceptance and migration readiness (`hzv`):** after the Windows entry gate, record at least three actual owner sessions over two days on realistic disposable data, with the workflow/friction checklist in [Owner and native gates](#owner-and-native-gates). The brief web smoke replies do not establish that cadence or coverage. Reuse the completed Linux/WSL2 `y9b` [rehearsal/runbook](docs/migration-rehearsal.md); no converter rewrite or repeat rehearsal is needed without a reason. Personal source reading, conversion and selection each remain separately permissioned, not prerequisites to documenting readiness.
6. **Clean cut (`dvs`), only after required essentials/owner/native gates:** execute all six [clean-cut exits](#clean-cut-and-publication-exits): sole default UI/CLI/native command path; obsolete runtime/prototype removal with retained invariants; responsibility-based production names; isolated converter and preserved backups; one current spec; final selection/preferences and retained-authority restart/recovery validation. The current opt-in route is not this cutover. Resolve pending requests before any authority/path transition; canonical copies do not carry receipts/history.
7. **Publication review (`xz2`):** choose the declared release-platform matrix and audit its actual default-route conformance, packaging/signing/installer and remaining blockers. Windows stays first; Android stays deferred/maintained. Audit original-case applicability (`23b`/recorded 101/112), rather than requiring an invented 112/112 or treating regression totals as release evidence. Broader platform/matrix/interoperability tasks are not automatic requirements. No publication or personal migration is authorized here.

**Separate optional preparation:** stage 2 candidate-test retirement still needs scope approval and the retained `8x1` comparison. It is not a demonstrated functional blocker or a reason to delay acceptance with open-ended cleanup. No other inventory proposal is automatically queued.

**Bounded pre-native follow-up:** the owner's subsequent resourceful Linux/web readiness pass reran types/build/lint and 201 focused bridge/client/function checks successfully. A task-local Playwright/Chromium attempt stopped before page launch on missing `libglib-2.0.so.0`; no system libraries were provisioned, no preview data changed and no case-level browser/native acceptance was added. See [evidence and handoff](docs/support.md#bounded-pre-native-follow-up-2026-10-14). The implementation queue remains closed; this is not approval to resume native diagnosis or cutover.

**Checkpoint / next decision:** reconciliation and the bounded pre-native follow-up are complete. Recommended next is item 1, a bounded case-level Linux/web evidence pass, if the owner wants stronger interaction evidence while native work stays deferred. If the owner considers the high-level smoke sufficient for the web checkpoint, record that decision and wait for the manual Windows gate instead; do not invent another feature task or resume native diagnosis.

## Implemented slice: established client on the Linux backend

**Implemented 2026-10-14** (commit recorded in the worker completion). Reader decision: the read-only `--v2-root` reader is **retained** unchanged for query-only inspection; the `--v2-edit` workbench editor (`V2TaskEditor` and its Chromium runner) was retired because `App` replaces it. Checks 1–6 are covered at client/bridge level by `scripts/mainClientRouting.test.mjs` and `scripts/v2AppEditor.test.mjs`; the Chromium walk in check 7 was **not run** because `agent-browser`/Chromium are not installed on the worker host, so browser focus/refresh/retry-dialog behavior on this route remains unwalked. Original scope, for reference: every agreed workflow needs the established `App` running on the replacement engine before it can be closed on Linux/web. The slice routes an explicit `pnpm dev:web --v2-root R --database C --v2-edit` selection to `App` via `MainWorkspace`, exactly as the Windows route does, and exposes no new workflow family.

Reuse: `V2App` confirmation screen, `MainWorkspace`, `V2WorkspaceReader`/`V2EditorClient` HTTP connections, `selectMainWorkspace` and the withheld-action wrappers in `backendClient`, the dev bridge allowlist/selection token, and the main client's retry dialog. Bring the bridge's editor command list in line with the native editor list (add eligible single-task `task.status.undo`) so the established Ctrl+Z works; add nothing else.

Acceptance checks, on disposable data:

1. Unflagged `pnpm dev:web` still renders the legacy `App` unchanged. The read-only `--v2-root` reader is untouched or explicitly retired in this slice; decide one, not both.
2. With `--v2-edit`, confirmation shows root/cache/profile before any query, then the established `App` renders with the [home focus contract](spec/client/home.md) (list or empty shell focused, never New task).
3. C/Enter capture and inline edit, shorthand classification round-trip, 0–4 priority, Space/Shift+Space/P/Delete statuses and Ctrl+Z eligible status undo persist through the Linux backend and are present after reload and re-confirmation (selection is not saved).
4. Filters, search and an external `tasks-cli --v2-root … --database …` edit refresh the visible list without stealing focus or draft content.
5. Child capture, parent/dependency, reorder, batch and general undo are still refused visibly by the existing wrappers, with no legacy transport fallback (extend `scripts/mainClientRouting.test.mjs` for the HTTP connection).
6. A lost bridge reply locks the original request in the existing retry dialog; Retry same request reuses its envelope.
7. `pnpm check`, `pnpm lint` and focused routing/editor tests pass; a disposable Chromium walk of items 2–6 is recorded or its tooling blocker is stated. No native, Windows or Android claim.

Afterwards, each agreed family is a separate slice through the same route, reusing the Linux backend that already implements it: child capture with parent/dependency edits ([implemented](#implemented-slice-child-capture-and-parentdependency-edits-on-the-linux-route)), manual reorder ([implemented](#implemented-slice-manual-reorder-on-the-linux-route)), general undo (one-step [implemented](#implemented-slice-one-step-general-undo-on-the-linux-route), then [durable ~50-entry same-client history](#implemented-slice-durable-same-client-undo-history-on-the-linux-route)), bulk status ([implemented](#implemented-slice-bulk-status-actions-on-the-linux-route)), backup/restore from Settings ([implemented](#implemented-slice-backuprestore-from-settings-on-the-linux-route)), then [preferences persistence (verified existing integration)](#verified-slice-preferences-persistence-on-the-linux-route). Global focus waits for a native desktop slice.

## Implemented slice: child capture and parent/dependency edits on the Linux route

**Implemented 2026-10-14** (commit recorded in the worker completion). Applies only to the explicit Linux `pnpm dev:web --v2-root R --database C --v2-edit` route. The bridge and HTTP editor client share an ordered twelve-command list: the nine native commands followed by `task.move` and `task.dependency.add/remove`. The prior nine-command HTTP handshake is refused. The Windows native selection still requires its nine-command list, so `MainWorkspace.supportsRelationships` is false there and the existing wrappers keep refusing relationship actions before any request.

- **Reuse.** The original Shift+C child capture, the M move picker (including Remove parent) and the B blocker picker call `backendClient`, which routes to `MainWorkspace.createChild`/`relationship`. These use the same write/retry path, envelope checks and expected-version conflict check as status edits. The Linux gateway writers and their done-blocks/canceled-does-not rule are unchanged.
- **Pre-send refusal.** Writer refusals lock the original request like an uncertain reply (deliberate, unchanged). So `MainWorkspace` walks the target's parent or dependency chain via `task.get` and refuses parent cycles, dependency cycles and canceled targets before sending. The blocker picker does not filter dependency cycles itself.
- **Unchanged.** Ctrl+Z still covers only eligible single-task status changes; relationship and capture operations retire the undo entry. Reorder, batch, general undo, purge, activity, export and receive stay withheld. The read-only reader and unflagged launch are untouched.
- **Evidence.** `scripts/mainClientRouting.test.mjs` persists child capture, move to top level and dependency add/remove through the real bridge, both via the `backendClient` wrappers and directly. It checks that a done dependency still blocks and a canceled one does not, refuses cycle/canceled-target/stale edits without a write, and retries a lost dependency-edit reply with an identical envelope. Handshake tests were updated in `v2AppEditor`/`v2NativeClient`. **No browser walk:** `agent-browser`/Chromium are still absent, so picker focus, announcements and refresh on this route are unwalked. No Windows, Android or Linux desktop claim.

## Implemented slice: manual reorder on the Linux route

**Implemented 2026-10-14** (commit recorded in the worker completion). Applies only to the explicit Linux `--v2-edit` route, whose ordered list is now thirteen commands: the twelve above followed by `task.reorder`. The prior twelve-command HTTP handshake is refused; `task.order.normalize` stays refused. The Windows native list is unchanged, so `MainWorkspace.supportsOrdering` is false there and `TaskList`/`backendClient` keep refusing reorder before any request.

- **Reuse.** The original Ctrl/⌘+↑/↓/Home/End controls, their filter preconditions and their switch to Manual order are unchanged. `reorderTasks` routes to `MainWorkspace.reorder`, which shares the write/retry/reconciliation path with the other edits. The [ordering writer](spec/backend/rules.md#order) owns placement against the complete scope, tie repair and all-or-refuse journaled writes.
- **Pre-send refusal.** As for relationships, `MainWorkspace.reorder` rereads the selected tasks and anchor and refuses stale versions, mixed scopes, out-of-order selections and selected or out-of-scope anchors before sending.
- **Unchanged.** Order changes retire the Ctrl+Z entry. Batch, general undo, purge, activity, export and receive stay withheld.
- **Evidence.** `scripts/mainClientRouting.test.mjs` reorders through the `backendClient` wrapper and directly through the real bridge. It shows an end-gap move rewrites only the selected file, a no-op returns no operation, and the manual order survives a bridge restart with a fresh cache and reconfirmation. Pre-send refusals send no write; a lost reorder reply retries with an identical envelope. **No browser walk:** tooling is still absent, so focus, announcements and refresh after a move are unwalked.

## Implemented slice: one-step general undo on the Linux route

**Implemented 2026-10-14** (commit recorded in the worker completion). This is the first bounded undo step. It applies only to the explicit Linux `--v2-edit` route, whose ordered list is now fourteen commands: the thirteen above followed by `operation.undo`. The prior thirteen-command HTTP handshake is refused. The Windows native list is unchanged, so `MainWorkspace.supportsOperationUndo` is false there and `App` still retires non-status entries.

- **Reuse.** The existing single Ctrl+Z entry in `App` is kept. A single-task status change still uses `task.status.undo`. The latest capture (including child capture), content/priority, parent/dependency or reorder operation now sends `operation.undo` through `backendClient.undoOperation` → `MainWorkspace.undo`. That method shares the write/retry/reconciliation path with the other edits. The [undo writer](spec/backend/rules.md#undo) owns eligibility, postconditions, unrelated-field preservation, scope and graph checks, and guarded creation removal; none of that policy changed.
- **Pre-send refusal.** Writer refusals lock the original request, so `MainWorkspace.undo` first sends the gateway's own non-consuming `operation.undo` preview. Consumed, superseded or cycle-creating history is refused before the executing request and retires the Ctrl+Z entry. This uses the gateway's rules instead of copying them into the client.
- **Superseded.** The one-entry page memory was replaced by the [durable history slice](#implemented-slice-durable-same-client-undo-history-on-the-linux-route). There is still no redo or undo-of-undo. Batches, purge, activity, export and receive stay withheld.
- **Evidence.** `scripts/mainClientRouting.test.mjs` undoes a content edit, a child capture (removing the unchanged file), a parent move and a reorder through the real bridge. Through the `backendClient` wrapper it undoes a reorder. It refuses consumed and superseded undo without an executing request, and retries a lost undo reply with an identical envelope. **No browser walk:** tooling is still absent, so the Ctrl+Z announcements, focus and refresh after an undo are unwalked.

## Implemented slice: durable same-client undo history on the Linux route

**Implemented 2026-10-14** (commit recorded in the worker completion). Applies only to the explicit Linux `--v2-edit` route; the fourteen-command list, the Windows native list and native selection are unchanged.

- **Storage.** The cache's local SQLite operation history already retains every operation and owns eligibility, but it has no per-client index, and adding a query would extend the protocol. So [`v2UndoHistory.ts`](src/platform/v2UndoHistory.ts) keeps the client's own operation IDs, newest last, bounded to 50, in client-local storage (the existing browser `localStorage` facility used for display preferences). Entries are scoped to the confirmed root, cache, profile and the cache's write context; at most ten such scopes are retained. Only operation IDs returned to this client are ever recorded, so other clients' operations are never offered. A rebuilt or rebound cache has a new write context and therefore an empty history. Unusable storage falls back to page memory for the session.
- **Reuse.** `MainWorkspace.undoHistory()` resolves the scope with the existing `operation` baseline query after confirmation. `App` records each own operation, shows the newest entry, and after an undo or a gateway refusal moves to the next older one. Every step uses the existing `MainWorkspace.undo` preview-then-execute path, immutable envelope, retry dialog and reconciliation. On this route single-task status changes are also recorded and undone through `operation.undo`, because `task.status.undo` only accepts a task's latest operation with a fresh version and so cannot walk back; announcements and toasts are unchanged. Windows keeps its single in-memory `task.status.undo` entry.
- **Gateway answers.** The client infers no eligibility. Entries refused by the preview (`OPERATION_UNAVAILABLE` and the existing retire codes) are removed with the existing "changed elsewhere" announcement; the next Ctrl+Z tries the next older entry. Other failures keep the entry. Accepted rules still apply: a capture whose task was later edited cannot be removed even after that edit is undone (the undo changes `updatedAt`).
- **Evidence.** `scripts/mainClientRouting.test.mjs` records an edit, a status change, a reorder and an edit superseded by another writer; reopens the same root/cache/profile; shows the superseded entry refused with no executing request; walks back the reorder and status change; reopens again and undoes the first edit. It shows another profile, another cache and another root see no entries, and checks the 50-entry bound plus corrupt and unusable storage. **No browser walk:** tooling is absent, so repeated Ctrl+Z announcements, focus and the reload behaviour of the real page are unwalked.

## Implemented slice: bulk status actions on the Linux route

**Implemented 2026-10-14** (commit recorded in the worker completion). Applies only to the explicit Linux `--v2-edit` route, whose ordered list is now fifteen commands: the fourteen above followed by `task.transitionMany`. The prior fourteen-command HTTP handshake is refused. `task.status.undoMany` stays refused: the accepted spec does not require it for this route, and one batch is undone through `operation.undo`. The Windows native list is unchanged, so `MainWorkspace.supportsStatusBatch` is false there and `transitionTasks` refuses before any request.

- **Reuse.** The existing multi-select Space/Shift+Space/P/Delete actions in `TaskList` already build one versioned batch and keep a stable idempotency key per batch; `transitionTasks` now routes to `MainWorkspace.transitionMany`, which shares the write/retry/reconciliation path. `App` already recorded batch operation IDs; on this route they enter the durable history, so one Ctrl+Z undoes the whole batch. The existing UI rule that multi-select pause skips done/canceled tasks is unchanged.
- **Gateway answers.** Like undo, `MainWorkspace.transitionMany` first sends the gateway's own non-consuming preview, so full-batch validation (invalid transition, stale version, missing task) refuses every item before the locked executing request, with no partial effects. The client adds no eligibility rule. Stale-version refusals on this route now get the existing "changed elsewhere; refresh" handling in `TaskList`.
- **Evidence.** `scripts/mainClientRouting.test.mjs` sends a batch through the `backendClient` wrapper and directly; refuses an invalid transition, a stale version and a missing task with no executing request and unchanged bytes; returns a receipt-only no-op without an operation ID; retries a lost batch reply with an identical envelope; preserves a lost batch for reconciliation and then refuses later writes without a request; and undoes a three-task batch with one `operation.undo` after reopening, restoring each status and exact closure. **No browser walk:** tooling is absent, so batch announcements, toasts, focus and the real Ctrl+Z after a batch are unwalked.

## Implemented slice: backup/restore from Settings on the Linux route

**Implemented 2026-10-14** (commit recorded in the worker completion). Only the explicit Linux `--v2-edit` route adds `workspace.archive` and `workspace.restore`, bringing its ordered list to seventeen commands. The Windows nine-command editor list, query-only reader and unflagged route are unchanged.

- **Reuse.** Settings → Data offers canonical backup and a separately confirmed restore to a new destination. Labeled absolute Linux backend paths lead to source/destination review and confirmation, then `MainWorkspace.copyWorkspace` uses the gateway's own non-consuming preview and existing immutable execution/retry/reconciliation path. Source validation, physical disjointness, absent/empty destination checks, staged publication and receipts remain gateway-owned. No overwrite, automatic selection, sharing setup, legacy snapshot import or recovery action is added.
- **Authority.** Copies include canonical files and known conflict originals, not SQLite/cache/receipts/history. The original cache and request evidence remain necessary for old retries. A restored folder requires explicit later selection and fresh local authority. Copy operation IDs never enter or clear task undo history.
- **Evidence.** Disposable real-bridge regressions compare exact source/archive/restore bytes including a raw conflict original, prove selection/history isolation and fresh restore context, refuse occupied/overlap/alias/invalid-source destinations before execution, and retry lost archive and restore replies with identical envelopes. Preserved reconciliation pauses later writes; decoder tests refuse malformed copy results/flags. Types/lint, focused routing/editor/native guard regressions and backend copy/recovery checks are recorded in the completion. **No browser walk:** browser tooling is absent, so Settings confirmation/focus and retry-dialog layering remain unverified. No native, Windows or Android claim.

## Verified slice: preferences persistence on the Linux route

**Verified 2026-10-14** (commit recorded in the worker completion). The existing Linux `--v2-edit` integration already persists built-in theme selection, help mode, font size, Details, filters/search and sort through the established browser `localStorage` facilities. No production change, second preference architecture or command-list extension was needed.

- **Lifetime.** Preferences belong to the browser profile and exact origin (scheme/host/port), not the backend profile, task root or cache. Reopen at the same origin with the same browser storage to retain them. They do not select a root, import data, preserve an unresolved request or grant write/undo authority. Custom filesystem/Omarchy themes remain unavailable on the selected route.
- **Evidence.** Disposable real-bridge routing tests retain a selected built-in theme across bridge restart and explicit reconfirmation, without canonical writes or changes to the own undo entry. A theme change during an uncertain capture leaves its frozen envelope and lock intact; retry reuses the identical request. Preference-function tests execute the existing App read/write callbacks and appearance facilities with inert state/DOM boundaries: help, Details, font and cached palette reopen; filter/sort readers, malformed values and display-storage defaults are covered. These are not rendered UI tests. Browser tooling remains absent, so Settings/theme controls, real reload, paint and focus are unverified. No native/Windows/Android acceptance.
- **Checkpoint.** Stop here. Global focus is the remaining agreed workflow family, but it requires a separately queued native desktop slice and reopened deferred host gates; a browser cannot validate it. No further native work is authorized by this completion.

## Implemented: production ordering coverage

Commit `55f330a` retained three literal public-command allocations and **419 mixed-tie placements** with independently spliced expectations in `src/backend/v2OrderWriter.test.ts`, plus literal prefix/case ordering in `src/backend/v2CanonicalReader.test.ts`. The existing 424 tied/distinct variants and exact-ID tie-break remain. Keep independent expectations, canonical-field constraints and corpus accounting intact.

This is an implementation reference, not a claim that validation was rerun or native acceptance obtained. Stage 2 still requires separate scope approval; no candidate/helper/transport deletion is authorized by this completion marker.

Supporting comparison for the candidate-retirement checkpoint: `$DATA/plans/2026-10-07-tasks-candidate-fixture-retirement-review.md` and SQ `sq show 8x1`. If unavailable, stop before retirement rather than inventing its remaining findings.

### Candidate retirement checkpoint

Before stage 2, use the complete `8x1` comparison to preserve remaining pre-intent selected/boundary/partial-JSON/UTF-8 faults, shrinking-gap/compact-key properties, useful grammar literals and the concurrency/entropy/final-read race rationale. These are not all covered at identical positions by existing production tests.

The two local candidate suites total 376 lines/26 tests. The optional Syncthing probe still uses the candidate planner and transitive batch recovery/UTF-8 helpers: **do not delete all four files or the fractional-indexing runtime dependency.** Preserve independent expected fixtures and operation-family recovery tests. A transport rewrite/retirement requires its own scope. Treat the final-read/rename race as a documented best-effort limit, never a lossless-CAS guarantee or a required overwrite behavior.

## Owner and native gates

The keep/replace/drop checklist is [agreed](#agreed-daily-use-scope-and-linuxweb-focus-2026-10-14): keep every listed workflow, no new sharing feature. The [inventory](docs/evidence/refactor-inventory.md#3-workflow-parity-what-is-actually-available) and [unattended QA](docs/evidence/unattended-qa.md) already identify the gaps; do not repeat discovery or ask the owner to rebuild the chosen interface.

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

Read this file and AGENTS.md. Stage 1 is implemented and stage 3 is agreed. The [established-client Linux slice](#implemented-slice-established-client-on-the-linux-backend), the [child capture with parent/dependency edits slice](#implemented-slice-child-capture-and-parentdependency-edits-on-the-linux-route), the [manual reorder slice](#implemented-slice-manual-reorder-on-the-linux-route), [one-step general undo](#implemented-slice-one-step-general-undo-on-the-linux-route), the [durable ~50-entry same-client undo history](#implemented-slice-durable-same-client-undo-history-on-the-linux-route) and [bulk status actions](#implemented-slice-bulk-status-actions-on-the-linux-route), plus [Settings backup/restore](#implemented-slice-backuprestore-from-settings-on-the-linux-route), are implemented. [Preferences persistence](#verified-slice-preferences-persistence-on-the-linux-route) is verified at the existing integration/function boundary, with no production change needed. **Checkpoint:** the agreed Linux/web slice is implemented and has owner-reported high-level smoke success, not case-level interaction or native acceptance. Follow the [remaining checklist and next decision](#linuxweb-checkpoint-and-remaining-checklist); global focus needs a separately approved native slice after host gates reopen. Stage 2 candidate retirement awaits separate scope approval. No Windows/Android work, personal data, cutover or release is authorized by this roadmap update. Ignore older autonomous-loop instructions.

[README](README.md) and [development](docs/development.md) own commands and host setup; this roadmap does not authorize platform expansion or personal selection.
