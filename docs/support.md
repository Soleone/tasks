# Current support and evidence

**Checked 2026-10-07: support audit `pa1` on `2eefcff`; Settings receive correction `8v8` on `3e12326`.** This is the current support index, not a release declaration or permission to enable commands. [PLAN.md](../PLAN.md) owns scope and acceptance. [The inventory](refactor-inventory.md) maps workflow gaps and consolidation proposals.

## What runs today

The unflagged app, backend and friendly CLI still use the legacy model. Explicit replacement selection uses schema/protocol 2 with bounded platform/client support. These are temporary execution arrangements, not two permanent products. The destination remains one application plus isolated one-time conversion.

| Entry point | Implemented/exposed behavior | Evidence and limits |
| --- | --- | --- |
| Default `pnpm dev:web`, `pnpm dev:tauri`, backend and `tasks-cli` without `--v2-root` | Legacy model and established UI/workflows; old Node command path. Android uses a separate legacy engine. | [Root specs](../spec/overview.md) and [legacy conformance](../spec/conformance.md). Legacy Chromium regressions do not prove replacement-client parity or native acceptance. |
| Linux Node backend with explicit `--v2-root` and outside-root `--database` | Broad replacement task/control subset: capture/update/status, relationships, order, eligible operation/group undo and batches, purge, doctor, init/rebuild, migration, copy and explicit recovery. | [Gateway](../src/backend/v2Gateway.ts), [conformance](../spec/v2/conformance.md). Disposable Linux process/fault evidence, not Linux/Omarchy desktop, Windows or Android acceptance. |
| Friendly `tasks-cli --v2-root ... --database ...` | Replacement queries, Linux task/link/undo/purge and lifecycle verbs with original-request preparation/retry. Ordering, batches and doctor use raw JSON-lines controls. | [CLI preparation](../src/backend/v2HumanCli.ts), [argument mapping](../src/backend/v2HumanArgs.ts). **Windows friendly writes remain unavailable:** this entry point does not select the Windows proof profile. |
| Explicit Windows backend `--windows-task-proof --local-profile ...` | Exactly the 18 commands below, through the same gateway; absent-destination copy only. | Actual local NTFS Node/SEA process proofs: [update](windows-update-proof.json), [capture](windows-create-proof.md), [status/eligible inverse](windows-status-proof.md), [copy](windows-copy-proof.md). Short dedicated paths, not blanket Windows support. |
| Explicit Windows native `node .\scripts\dev-native.mjs` with root/cache/profile | Existing main UI, one selected SEA session, root capture/content/classification/priority, six single-task statuses, eligible latest-status undo, filters/search and external refresh. | [Launch instructions and limits](windows-native-pilot.md), [restored main client](restored-main-client.md), [argv proof](windows-launch-argv.md). Actual WebView2 lifecycle/lost-reply evidence; no full workflow parity, owner dogfood or release acceptance. |
| Linux `pnpm dev:web --v2-root ... --database ...` | Explicit query-only browser reader. Add `--v2-edit` for capture/content, six statuses, eligible latest-status undo and parent move. | [Usage subsets](usage-guide.md#experimental-v2-browser-reader), [bridge](../src/backend/devServer.ts). Engineering workbench with preview/apply, not the daily-use candidate or native validation. No browser capability expansion is planned by this document. |
| Replacement Android, macOS or Omarchy native app | No demonstrated current-model native replacement route. Android's old SAF implementation is not a schema-2 port. | Separately bounded platform scope/proof required. A Linux backend pass is not Omarchy desktop acceptance; Windows-first is not permission to retain a second legacy product. |

## Selected Windows command boundary

[Gateway admission](../src/backend/v2Gateway.ts) and [pending-family guards](../src/backend/v2WindowsTaskProof.ts) determine support, not the complete target command vocabulary. The explicit profile advertises:

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
| Child capture, parent/dependency editing | Refused/unavailable; existing links may be displayed. Original UI assets and broader Linux implementation are retained. |
| Manual reorder, status batches, grouped/general operation undo | Refused/unavailable. Ctrl+Z restores only eligible latest single-task status, not capture/content/order/relationship changes. |
| Activity and app export/purge/doctor/recovery | Not connected as main-client actions. Backend activity and proved copy/recovery controls remain available separately through the selected JSON-lines backend. |
| Receive/sharing setup | Legacy receive prepare/abort refuse; status reports not waiting. Settings withholds receive actions and confirmation, explaining the limitation in Data → Workspace sync. No backup/empty-folder promise or receive capability is offered on the selected route. |
| Global window-focus shortcut | Not registered on the selected route; permission/native focus proof remains required. |
| Themes and preferences | Built-in palettes and local WebView preferences exist; custom filesystem themes are not supplied. The disposable launcher uses new WebView storage each launch, so durable preferences on the final route are unproved. |
| Uncertain request or unsaved draft after reload/close | Memory-only state can be lost. Retry preserves the exact original envelope while retained; neither process restart nor reload authorizes automatic replay, new authority or guessed recovery. |

The existing home/keyboard/mouse design remains the baseline. Unsupported operations are not permission to redesign it or silently drop workflows. Agree deliberate losses and prove each required native family before cutover.

## Scoped Settings receive evidence (`8v8`)

[Settings](../src/components/SettingsDialog.tsx) retains its layout and default desktop/Android branches. Only the selected workspace's unsupported receive affordance and confirmation are withheld. [Routing checks](../scripts/mainClientRouting.test.mjs) retain prepare/abort refusal and now assert not-waiting status without selected command calls.

Run `node scripts/check-settings-ui.mjs` for the [real-render fixture](../scripts/check-settings-ui.mjs). Actual Settings/Base UI components and production CSS use disposable workspace/runtime stubs, not a backend or native window. Checks cover selected guidance/no receive controls or callback, disabled export/Tab loop, Escape/final focus/reopen, default desktop confirmation/cancel/reset/callback, and Android choose/change/forget. Selected Gilt renders at 1100×760, 720×500, 390×844 and 550×380 have zero axe findings and no horizontal overflow; the last size is a reflow check, not an actual browser-zoom proof. The changed sync section also has zero findings in Catppuccin Latte. Types/lint, 1,662 regressions/two existing skips and the full legacy Chromium UI suite pass; the mechanical UI detector reports no findings.

**Inherited findings remain:** Catppuccin Latte's inactive Settings tabs measure 2.61:1 contrast; the default desktop Gilt confirmation/cleanup destructive buttons measure 3.7:1. Re-rendering unchanged `3e12326` Settings with identical CSS reproduces both. The fixture reports these exact locations and rejects other findings; it does not declare the whole Settings surface accessible. Theme fixes need a separate bounded scope. No new Windows WebView2/Android device proof, owner sessions, receive implementation, capabilities, personal selection or cutover is implied.

## Migration, authority and acceptance

- [Disposable conversion rehearsal](migration-rehearsal.md): full-field/order preservation, raw recovery originals, restart/replay and fresh target authority on Linux/WSL2. **No Windows/Android conversion capability or personal migration approval.** Choose a proved frozen-snapshot host or a separately bounded native proof before personal conversion.
- SQLite retains receipts/history/undo authority as well as query data. Preserve original root/cache/profile bindings and pending journals; deleting, moving or copying cache state does not preserve original retry authority. Canonical copy intentionally excludes it. No cosmetic rename authorizes an authority reset.
- `m1p` technical native loop, `4t6` restored client and `26a` bounded accessibility work are complete. Owner `hzv` remains deferred with **zero owner sessions**; `dvs` default cutover and `xz2` publication gates remain open.
- Recorded original corpus execution is **101/112**, distinct from regression totals. The withheld-doctor profile and optional Syncthing candidate-model probe have separate skip reasons. Integrity checks verify expectations/anchors/goldens, not case execution. Candidate transport evidence is not production gateway sharing acceptance.
- Historical reports retain their original commits, counts and limitations. A later family proof does not retroactively expand an earlier report. Power loss, hostile races, distributed CAS, network/providers, installer/signing and independent interoperability are not established by the local process/native subset.

## Reading the specifications

[Root spec pages](../spec/overview.md) describe the legacy defaults; [replacement contracts](../spec/v2/overview.md) are accepted requirements with bounded implementation. A target MUST is not a statement that every client/platform implements it. [Conformance](../spec/v2/conformance.md) records case/family and historical evidence. This temporary spec split is reconciled into one current contract at approved cutover, not by declaring all target behavior shipped now.

When support changes, update this index, affected contract status and the concrete evidence together. Do not change model semantics, downgrade expected fixtures or relabel an unsupported case passed to make documentation agree.
