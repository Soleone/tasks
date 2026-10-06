# Unattended client QA (`3et`)

The owner explicitly asked for productive work and agent-run testing without participation. This pass validates existing behavior and reduces the later review to concrete workflow choices. **It records zero owner sessions and does not authorize personal data, new Windows capabilities or default cutover.**

## What passed

| Check | Actual evidence | Boundary |
| --- | --- | --- |
| Established client browser regression | `pnpm test:ui`: full keyboard/mouse capture/editing, Markdown, status/priority/filter/search, focus, help/settings/themes, hierarchy/context rows, manual order/group selection, undo/conflicts/retry, persistence, responsiveness, external CLI refresh and scoped axe checks passed | Real Linux Chromium and default legacy backend on synthetic scratch data. This is UI regression, not new-format Windows writer or native acceptance |
| Bundled runtime | Both actual Linux SEA executables ran with minimal PATH: backend FTS5 probe and friendly CLI workspace JSON passed | Linux runtime/process packaging, not Windows installer/signing or native lifecycle |
| Selected-native boundary | 42 focused tests across `uiHarness`, `mainClientRouting` and `v2NativeClient` passed | Native client tests compile actual code but inject transport/window fixtures; they do not launch Windows/WebView2 |
| Full regression | 1,670 passed, two known skips, zero failures (1,672 total); types/lint pass | The skips remain optional Syncthing transport and the deliberately withheld-doctor corpus profile |

The native-boundary audit now checks all 12 withheld action wrappers: status batches, grouped status undo, general undo, reparenting, reordering, add/remove dependency, purge, activity UI, export and receive prepare/abort. Each refuses through the selected workspace without invoking a supported action or falling through to legacy transport. Child capture remains separately refused; supported inline save/priority/status/eligible-status-undo routing remains tested. No allowlist changed.

Logs: `/tmp/tasks-3et-{ui,ui-fixed,sidecar,sidecar-fixed,sidecar-build,focused,full,check,lint}.log`. Original failing evidence is retained in `ui.log`, not overwritten. Browser/test subprocesses are closed by their runners; no owner's native window/source copy was opened, modified or stopped.

## Concrete defect fixed

The first browser run failed at the initial harness `task.list` POST with `UND_ERR_SOCKET`; there were no browser errors and the backend was still running. This was the same early socket failure previously recorded during `26a`.

The startup health fetch retained a keep-alive connection. Synchronous `agent-browser` subprocess calls blocked Node's event loop past the server idle timeout, leaving a remotely closed pooled socket available for the next POST. A standalone two-process reproduction using the real five-second Node HTTP idle timeout proved **keep-alive → `UND_ERR_SOCKET`; explicit startup close → success**. See `/tmp/tasks-3et-real-timeout-repro.{mjs,log}`. An earlier reproducer without an event-loop yield did not reproduce the error; adding that yield allowed the response to enter the idle pool before blocking, matching the suite's startup sequence.

The smallest fix closes both startup probe connections. Command handling still sends each original request once, with no retry, timeout relaxation or weakened assertion. A bounded regression test independently expires the startup connection while a synchronous subprocess blocks the caller. It and the readiness/isolated-environment tests passed in three additional repeated runs; the complete corrected browser suite passed.

Both test runners also now explicitly select scratch canonical roots, blank source registries, caches and app-data profiles. The UI server and its external CLI use the same environment. Inherited `TASKS_SYNC_ROOT`/registry/app-data values could otherwise redirect a test outside its scratch database. Before this fix, this pass explicitly cleared those values and selected disposable profiles. Regression checks evaluate the actual runner environment objects against hostile inherited paths; they do not touch those paths.

Changed code is limited to `scripts/check-ui.mjs`, `scripts/check-sidecar.mjs`, their new harness regression tests and expanded native routing assertions. No product UI, command model, writer, launcher permission or dependency changed.

## Native workflow inventory for the later owner review

This is a **factual draft**, not the owner's keep/replace/drop decision. Established UI/workflows remain the baseline. Actual Windows evidence is recorded in [restored-main-client](restored-main-client.md) and [native pilot](windows-native-pilot.md); this pass did not rerun native scenes. The concrete boundaries are [backendClient](../src/platform/backendClient.ts), [MainWorkspace](../src/platform/mainWorkspace.ts) and [native selection](../src/platform/v2NativeSelection.ts).

| Workflow | Explicitly selected Windows main client today | Remaining decision/work |
| --- | --- | --- |
| Capture/edit Markdown | Original C/Enter/inline form, keyboard/mouse; root capture and content edits use the proven path | Review daily usability. Unsaved drafts are memory-only |
| Classification and priority | Existing shorthand/pickers and P0–P4; literal content round-trips; priority-only change does not rewrite title | No label dictionaries ported. Review whether existing behavior suffices |
| Filters/search/details | Existing compact toolbar, category/tag/status/priority/unblocked/search, details toggle and date/priority/manual reading | Browser regression passes; earlier native focus/search evidence remains bounded |
| Relationships | Existing canonical links are displayed; parent/dependency mutation and child capture are withheld | If essential, approve one bounded writer proof/integration task. Do not rebuild the UI or drop relationships by inference |
| Manual sibling order | Persisted order can be read; reorder controls report native unavailability | If essential, approve a bounded Windows ordering proof/integration task |
| Group operations | Multi-selection UI is retained; batch status/undo/reorder writes are withheld | Decide required group workflows; no silent per-task loop substituted for atomic batches |
| Undo | Eligible latest local single-status inverse only; general capture/content/relationship/order undo is unavailable | Review which broader inverses are essential; no history inferred from canonical files |
| Backup/restore | Proven explicit CLI archive/restore to absent destinations; Settings export is unavailable on this selected path | Decide whether CLI-only is adequate for the release. Keep independent backups |
| Recovery and uncertain writes | Immutable original-request retry dialog; explicit CLI recovery/reconciliation; writes pause after preservation acknowledgment | Requests are memory-only across reload/close. No automatic recovery or durable draft guarantee |
| Help/themes/settings | Established components and built-in themes retained | Disposable launcher isolates WebView storage per cold launch; do not infer durable cross-launch preferences from legacy browser persistence |
| Global focus shortcut | Native selected path withholds registration | Decide whether this established shortcut is essential; separate capability evidence is needed |
| Activity/purge/share setup | Some backend activity is proven, but these main-client actions remain unavailable | Not automatically release requirements. No sharing/provider claim or purge/receive port |
| Migration | Verified separate-root Linux converter/runbook; no native migration capability | Personal reading/conversion/selection needs approval; Windows conversion needs its own bounded proof if required |

The largest potential daily-use gaps are **relationships, manual-order changes and broader undo**. They can be investigated and validated by agents in separately bounded tasks; owner participation is needed to agree essentials and any deliberate workflow loss, not to execute every regression check. None was implemented by this QA task.

## What can proceed without owner participation

- Run supported disposable browser/backend/SEA regressions and inspect failures.
- Add missing safety/negative-path assertions and fix demonstrated defects without changing product scope.
- Recheck supported native scenes on an available actual Windows host using a newly declared disposable selection, without attaching to the owner's session.
- Prepare a narrowly scoped proof/integration plan for an identified missing workflow. A plan is not permission to enable withheld writers.

What automation cannot supply: genuine owner sessions, preference/essential-workflow approval, permission to read personal tasks, platform guarantees from browser substitutes, or permission to make the replacement the sole default. `hzv` stays deferred, not passed. `dvs` remains gated.
