# Restored main client (2026-10-06, `4t6`)

## Owner decision

The experimental reader/editor is an engineering workbench, not a replacement for the established Tasks interface. The owner rejected dogfood of that surface. Native testing must reuse `App`, `TaskList`, the compact toolbar and inline `TaskComposer`, with their existing visual identity, keyboard/mouse interactions, help/settings and themes. No owner session was counted by this implementation work.

## Implementation

- Native selection opens the established `App` after explicit root/cache/profile confirmation. Browser reader/editor routes remain engineering fixtures until cutover, not the owner-testing client.
- The existing frontend action functions call the concrete selected workspace through protocol 2. They do not translate protocol-1 envelopes or start a legacy engine. Native launch forbids the legacy transport even before connection registration or after development module reloads. Registration is restored before list-query effects after HMR.
- `taskView` is presentation data for the existing components, not another canonical model or persisted compatibility format. Display/search/copy preserve literal title and Markdown. The inline input escapes literal markers outside protected code and prefixes classification so even unclosed code fences round-trip. Priority-only changes send only priority.
- Save and status shortcuts execute directly. Removing the workbench's mandatory preview/apply step does not remove version/context/receipt checks. Existing-task preparation must match the originally selected version; it cannot silently update a stale draft's version.
- A sent request is immutable. Unverified success opens a contextual retry dialog and holds the original action pending, so the inline fields remain locked. Retry uses the same serialized envelope; another write is refused. Copy includes request and paths. Acknowledged external reconciliation pauses subsequent writes until the workspace is reopened after reconciliation.
- Built-in themes use the existing palette/UI, with selection in local WebView preferences rather than inventing backend theme commands. The current disposable launcher still isolates WebView storage per launch.
- Windows relationship/child/order/batch changes, general operation undo, purge, app export/recovery and global window-focus registration remain withheld. Relevant controls refuse or explain the limit at the point of use; they never fall back to the old backend. Existing implementations are retained, not approved for deletion or recreation.
- Direct `node .\scripts\dev-native.mjs` succeeds in the owner's actual source copy, bypassing the earlier package-script path-validation failure. That failure's exact argument-handling cause is not established. Sidecar freshness now reads actual source/build-input timestamps, including nested directory changes, instead of requiring `.git` in a source copy.

## Actual Windows evidence

The first native run used the owned disposable checkout `C:\Users\soleone\AppData\Local\Temp\Tasks-m1p-checkout-9922d8d1`, selected `.tmp\e\r`, cache `.tmp\e\c.db`, dedicated profile `.tmp\e\p`. No personal tasks were selected. Before confirmation there was no cache. Actual Windows/WebView2 opened the original Gilt-themed main client, not a browser substitute.

- `C`, the original title/priority/description field navigation, and Ctrl+Enter captured `Native main UI Ω @alice #literal`, category `work`, tag `native`, P1 and literal Markdown through the normal inline form.
- Enter reopened the original inline editor with escaped shorthand. Saving unchanged content round-tripped without changing canonical content. `0` changed only priority. Space and Ctrl+Z exercised a single status change and eligible status undo. Existing search/mouse toolbar paths remained available.
- One app/shared sidecar was observed: app PID 15812, initial sidecar PID 16652, exact selected eight-argument SEA route. External Windows SEA changes were read without an app restart. During inline editing the draft/focus survived; saving against the changed version refused before mutation, leaving an editable draft and no recovery dialog. The edited task's canonical title is intentionally not visible while its row is replaced by the inline editor.
- A disposable debug SEA used the existing declared `m1p` cut: after canonical replacement, receipt/history commit and intent retirement, before the reply. Actual exit 87 opened the main client's retry dialog, retained the complete original envelope, locked the inline title and refused Escape dismissal. GUI retry and two independent actual Windows SEA replays acknowledged the same committed effect with unchanged receipt/operation counts and exact task bytes.
- The normal executable was restored and hash-verified after that cut. No production fault hook or writer change was added. The four original fixture tasks and workspace descriptor stayed byte-exact.
- Actual native WM_CLOSE ended the app and left zero owned sidecars. Only the exact owned development launcher tree was stopped afterward.

Artifacts: the owned checkout's `.tmp/main-client-{evidence.json,evidence.mjs,original-wrapper.json,normal.exe,cli-change.mjs}`; Linux `/tmp/tasks-restored-main-native-{home,inline,loop,lost-reply,home-final}.png`, native axe artifacts and `/tmp/tasks-main-client-*.log`. These are synthetic proof artifacts, not public runtime hooks.

A final cold launch also succeeded from the owner's actual `D:\src\wsl\tasks` source copy, using the owner's declared synthetic `C:\Users\soleone\AppData\Local\Temp\Tasks-native-82d93f5e\{r,c.db,p}` selection. Path confirmation led to the original home with listbox focus and no browser errors. App PID 31624 and one sidecar PID 34260 are observed, with the exact eight selected arguments; screenshot `/tmp/tasks-restored-main-owner-ready.png`. No GUI mutations were performed on that selection. This is automated engineering verification, not an owner session.

The owner's non-Git Windows source copy `D:\src\wsl\tasks` was updated only after each touched existing source matched a known baseline hash and each new path was absent. Originals are retained under `.tmp/main-client-before-20261006`; no task data/dependencies were replaced. Actual Windows types/lint, 39 focused tests and the source-copy sidecar freshness check pass there. The accepted writer bundle remains byte-identical, SHA-256 `537687cb288209ff2c30164d2f8f2a720ce5c9d8c586c6e90c9da67cccce5f12`.

## Validation and truthful limits

- Full regression: **1,665 passed, two known skips, zero failures** (1,667 total). Types/lint/diff pass. 39 focused native/routing/freshness checks pass on Linux and actual Windows.
- The existing main-client browser suite passes, including its original capture/editing/filter/hierarchy/ordering/undo/settings/theme/focus/persistence assertions. Separate engineering reader/editor browser suites pass. These do not extend Windows writer acceptance.
- Native home axe exposed two inherited main-list findings: `aria-expanded` on listbox options and nested category controls inside options. They are not a clean accessibility pass; SQ `26a` records the bounded publication blocker, preserving the original visual and focus contract. The first retry-dialog audit also found insufficient destructive-text contrast under Gilt; the new dialog now uses the normal Alert palette and suppresses composer help while saving. Do not claim zero native axe findings from the older workbench's report.
- Drafts and original UI requests remain memory-only. Native close/reload/dev reload may lose them; unload protection is best-effort. Preserve request/path evidence before reconciliation or source reload. No cold-launch automatic replay/recovery was added.
- This is restoration of the existing client with the proven Windows task subset, not full feature/platform acceptance, publication, personal migration or permission to remove established interactions. Owner testing starts from the restored client; missing native essentials get individually bounded prerequisites, not a request to rebuild the UI.
