# Current support and evidence

**Reconciled 2026-10-14 through `02cc8d5`: Linux/dev:web implementation and owner-reported smoke checkpoint below.** Earlier support audit `pa1` on `2eefcff`, Settings receive correction `8v8` on `3e12326` and scoped contrast correction `asy` on `16f0ea8` retain their historical evidence. This is the current support index, not a release declaration or permission to enable commands. [PLAN.md](../PLAN.md) owns scope and acceptance. [The inventory](evidence/refactor-inventory.md) maps workflow gaps and consolidation proposals.

## What runs today

The unflagged app, backend and friendly CLI still use the legacy model. Explicit replacement selection uses schema/protocol 2 with bounded platform/client support. These are temporary execution arrangements, not two permanent products. The destination remains one application plus isolated one-time conversion.

| Entry point | Implemented/exposed behavior | Evidence and limits |
| --- | --- | --- |
| Default `pnpm dev:web`, `pnpm dev:tauri`, backend and `tasks-cli` with `--legacy` | Legacy model and established UI/workflows; old Node command path. Android uses a separate legacy engine. | Legacy behavior (old specs in git history). Legacy Chromium regressions do not prove replacement-client parity or native acceptance. |
| Linux Node backend with explicit `--root` and outside-root `--database` | Broad replacement task/control subset: capture/update/status, relationships, order, eligible operation/group undo and batches, purge, doctor, init/rebuild, migration, copy and explicit recovery. | [Gateway](../src/backend/gateway.ts), [conformance](evidence/conformance-history.md). Disposable Linux process/fault evidence, not Linux/Omarchy desktop, Windows or Android acceptance. |
| Friendly `tasks-cli --root ... --database ...` | Replacement queries, Linux task/link/undo/purge and lifecycle verbs with original-request preparation/retry. Ordering, batches and doctor use raw JSON-lines controls. | [CLI preparation](../src/backend/friendlyCli.ts), [argument mapping](../src/backend/friendlyArgs.ts). **Windows friendly writes remain unavailable:** this entry point does not select the Windows proof profile. |
| Explicit Windows backend `--windows-task-proof --local-profile ...` | Exactly the 18 commands below, through the same gateway; absent-destination copy only. | Actual local NTFS Node/SEA process proofs: [update](evidence/windows-update-proof.json), [historical journaled capture](evidence/windows-create-proof.md), [status/eligible inverse](evidence/windows-status-proof.md), [copy](evidence/windows-copy-proof.md). Short dedicated paths, not blanket Windows support. **Simplified capture now uses native rename; its Windows Node/SEA proof is pending.** |
| Explicit Windows native `pnpm dev:native` with root/cache/profile | Existing main UI, one selected SEA session, root capture/content/classification/priority, six single-task statuses, eligible latest-status undo, filters/search and external refresh. | [Launch instructions and limits](evidence/windows-native-pilot.md), [restored main client](evidence/restored-main-client.md), [argv proof](evidence/windows-launch-argv.md). Actual WebView2 lifecycle/lost-reply evidence; no full workflow parity, owner dogfood or release acceptance. |
| Linux `pnpm dev:web --root ... --database ...` | Add for the existing main UI over the dev bridge: root capture/content/classification/priority, six single-task statuses, eligible latest-status undo, child capture, parent move/remove, dependency add/remove, manual reorder, repeated Ctrl+Z undo through this client's durable ~50-entry history of own status/capture/content/relationship/order/status-batch operations (same root/cache/profile), multi-select status batches through `task.transitionMany`, Settings backup and separately confirmed restore to a new destination through `workspace.archive/restore`, filters/search and external refresh. Copies do not change selection or copy cache/receipt/undo authority. Batch status undo (`task.status.undoMany`), redo, order normalization and purge are refused. | [Reader](../spec/client/README.md), [main client](../spec/client/README.md), [bridge](../src/backend/devServer.ts), [routing tests](../scripts/mainClientRouting.test.mjs). Existing browser preferences retain built-in theme selection, help, font size, Details, filters/search and sort at the same origin/browser profile; no new storage or command integration was needed. [Preference-function regressions](../scripts/mainClientPreferences.test.mjs) and real-bridge theme restart/isolation checks pass; actual Settings/theme UI and page reload have no instrumented case-level evidence (worker browser tooling absent); later owner-reported high-level persistence smoke is recorded below. Preferences do not select a root or preserve retry/write authority. Linux browser/client-boundary evidence only, not Linux desktop, Windows or Android acceptance. Global focus still needs a separately queued native slice under PLAN's deferred host gates. |
| Replacement Android, macOS or Omarchy native app | No demonstrated current-model native replacement route. Android's old SAF implementation is not a schema-2 port. | Separately bounded platform scope/proof required. A Linux backend pass is not Omarchy desktop acceptance; Windows-first is not permission to retain a second legacy product. |

## Linux/web owner smoke checkpoint (2026-10-14)

The agreed non-native daily-use implementation slice is complete through `02cc8d5`; this is not sole-default cutover or release. The owner used the new-engine Linux dev:web client at `http://validator.home:3000` on disposable fixture data. After the initial `crypto.randomUUID` load failure was fixed in `02cc8d5`, the owner explicitly reported it works; they also reported success after capture → edit → complete → undo was proposed, and after relationships/manual ordering/bulk actions/backup-restore/persistence were listed together. The latter reply has no individual case detail.

This is **owner-reported high-level smoke success**, not an instrumented/per-case acceptance or native validation. No personal data migrated. Detailed focus, keyboard/mouse equivalence, real preference controls/reload, external refresh/draft preservation and retry layering remain without case-level browser evidence. Existing automated bridge/function checks retain their own boundaries. The UUID correction uses secure browser randomness on plain HTTP; it does not turn the development bridge into a production hosting/security boundary.

[PLAN's exact remaining checklist](../PLAN.md#linuxweb-checkpoint-and-remaining-checklist) separates an optional next bounded Linux/web evidence pass from deferred Linux native/global focus, Windows owner-host integration, Android/tooling/provider work, owner sessions, clean cut and publication. No further Linux/web workflow implementation defect was identified by reconciliation. Do not manufacture missing browser features from native-only or withheld non-agreed controls.

### Bounded pre-native follow-up (2026-10-14)

On `a415c04`, `pnpm build` (types/backend/web) and lint passed; Vite retained its existing large-chunk warning. After rebuilding the backend following Vite's output cleanup, the focused `mainClientRouting`, `mainClientPreferences`, `randomUUID`, `workspaceEditor` and `nativeClient` suites passed **201/201, no skips**. These reuse disposable real-bridge checks for durable same-client undo/reopen, batch undo/refusal, relationships, exact backup/restore bytes and lost-reply identical-envelope retries, plus function/client checks for preferences and HTTP UUID compatibility. Native-named suites here are transport/contract tests, not native execution.

The hosted preview returned HTTP 200 with `Host: validator.home:3000`; no preview task commands or data writes were made. No installed browser/`agent-browser` was found. A task-local maintained Playwright install and Chromium download succeeded, but launch stopped before any page opened: missing `libglib-2.0.so.0`. System-library provisioning was not attempted. Thus this pass adds **no rendered browser interaction, reload/focus or native acceptance evidence**; the case-level walkthrough remains blocked on a runnable browser host. Existing owner smoke remains high-level only. Native testing should still begin with the manual Windows main-WebView gate in PLAN, not an automated diagnosis or wider writer allowlist.

## Desktop capture publication boundary

Node V2 creates now use one initial canonical snapshot and one hidden sibling stage/native rename, with no new pending-create intent/progress. Selected parent/destination and physical bindings are rechecked; unrelated workspace files are not rescanned. Interrupted stages stay orphans. Publication before SQLite receipt/history commit can leave a task without history and same-request retry can duplicate it; the owner accepts this window. Committed success receipts replay without resurrection. Old pending-create intents still block new work and retain explicit recovery. Recovery refuses and preserves an already-present stage without a durably bound identity, including matching-byte stages; stage-write-before-binding interruption requires manual inspection. See [design](../spec/backend/safety.md#creating-a-task) and [Windows proof pending](evidence/windows-create-proof.md#simplified-route-proof-pending). No platform capability was enabled.

## Selected Windows command boundary

[Gateway admission](../src/backend/gateway.ts) and [pending-family guards](../src/backend/windowsTaskProof.ts) determine support, not the complete target command vocabulary. The explicit profile advertises:

- Five queries: `workspace.info`, `task.get`, `task.list`, `category.list`, `tag.list`.
- `activity.list`, `task.create`, `task.update`.
- Six statuses: `task.start`, `task.pause`, `task.complete`, `task.reopen`, `task.cancel`, `task.delete`.
- Eligible single-task `task.status.undo`.
- `workspace.archive`, `workspace.restore`, `workspace.recovery.resume`.

Archive/restore require **absent** destinations; existing empty destinations refuse before staging. Recovery admits only the proved original families, including eligible status inverse and absence-only copy, not every structurally valid pending intent. Use the original selected root/cache/profile and retained envelope. Raw backend JSON-lines writes must explicitly select this profile; the friendly CLI does not.

## Main-client gaps that remain

Backend admission, client exposure and actual host proof are separate. [Action wrappers](../src/platform/backendClient.ts), [main workspace](../src/platform/mainWorkspace.ts) and [routing tests](../scripts/mainClientRouting.test.mjs) enforce these distinctions without legacy fallback:

| Workflow | Selected Windows main client today |
| --- | --- |
| Child capture, parent/dependency editing | Refused/unavailable; existing links may be displayed. Connected only on the Linux dev:web route above; the Windows editor list is unchanged. |
| Manual reorder, status batches, grouped/general operation undo | Refused/unavailable; manual reorder, status batches and operation undo are connected only on the Linux dev:web route above. Ctrl+Z restores only eligible latest single-task status, not capture/content/order/relationship changes. |
| Activity and app export/purge/doctor/recovery | Not connected as main-client actions. Backend activity and proved copy/recovery controls remain available separately through the selected JSON-lines backend. |
| Receive/sharing setup | Legacy receive prepare/abort refuse; status reports not waiting. Settings withholds receive actions and confirmation, explaining the limitation in Data → Workspace sync. No backup/empty-folder promise or receive capability is offered on the selected route. |
| Global window-focus shortcut | Not registered on the selected route; permission/native focus proof remains required. |
| Themes and preferences | Built-in palettes and local WebView preferences exist; custom filesystem themes are not supplied. The disposable launcher uses new WebView storage each launch, so durable preferences on the final route are unproved. |
| Backend-answered refusal | Only validated, correlated `INVALID_REQUEST`, `UNSUPPORTED_VERSION` and `UNKNOWN_COMMAND` are ordinary inline errors, and only without prior attempt uncertainty. Selected capture/edit rejects empty literal shorthand titles and competing categories locally. Other executing errors, including `INVALID_ARGUMENT` and `INVALID_STORAGE`, still retain the original request and pause new writes. Client/component checks only; no new Windows/native acceptance. |
| Uncertain request or unsaved draft after reload/close | Memory-only state can be lost. Retry preserves the exact original envelope while retained; neither process restart nor reload authorizes automatic replay, new authority or guessed recovery. |

The existing home/keyboard/mouse design remains the baseline. Unsupported operations are not permission to redesign it or silently drop workflows. Agree deliberate losses and prove each required native family before cutover.

## Deferred Windows host

The owner source copy was synced to `0b18727`, but later owned launch attempts stopped before an observed main Tasks WebView or selected backend query. The startup cause is unresolved. The owner paused further automated Windows control (`100`); do not restart diagnosis from old reports. Native work starts with the owner’s basic manual Windows launch, then separately scoped sidecar/permissions, close/relaunch, persistence and recovery checks.

[Settings and host evidence](evidence/settings-and-windows-host.md) retains the bounded receive/contrast checks and exact Windows observations. Browser component checks do not establish replacement native parity.

## Migration, authority and acceptance

- [Disposable conversion rehearsal](migration-rehearsal.md): full-field/order preservation, raw recovery originals, restart/replay and fresh target authority on Linux/WSL2. **No Windows/Android conversion capability or personal migration approval.** Choose a proved frozen-snapshot host or a separately bounded native proof before personal conversion.
- SQLite retains receipts/history/undo authority as well as query data. Preserve original root/cache/profile bindings and pending journals; deleting, moving or copying cache state does not preserve original retry authority. Canonical copy intentionally excludes it. No cosmetic rename authorizes an authority reset.
- `m1p` technical native loop, `4t6` restored client and `26a` bounded accessibility work are complete. Owner `hzv` remains deferred with **no qualifying session record**; the high-level owner browser smoke above does not establish three sessions over two days or native acceptance. `dvs` default cutover and `xz2` publication gates remain open.
- Recorded original corpus execution is **101/112**, distinct from regression totals. The withheld-doctor profile and optional Syncthing candidate-model probe have separate skip reasons. Integrity checks verify expectations/anchors/goldens, not case execution. Candidate transport evidence is not production gateway sharing acceptance.
- Historical reports retain their original commits, counts and limitations. A later family proof does not retroactively expand an earlier report. Power loss, hostile races, distributed CAS, network/providers, installer/signing and independent interoperability are not established by the local process/native subset.

## Reading the specification

[The spec](../spec/README.md) describes the target app. Gaps on Windows are listed in [client/platforms.md](../spec/client/platforms.md); this page records what each entry point runs today and the evidence behind it. [Conformance history](evidence/conformance-history.md) keeps the per-family evidence ledger.

When support changes, update this index, the platforms table and the concrete evidence together. Do not change model semantics, downgrade expected fixtures or relabel an unsupported case passed to make documentation agree.
