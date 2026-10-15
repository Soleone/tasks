# Windows single-task status and latest-status inverse proof

`byy`, 2026-10-04. Bounded backend process evidence, not native application acceptance. The owner-authorized autonomous loop replaces the routine task-end review pause, not safety/native/personal-data gates.

## Selection and supported subset

One shared gateway and existing writers, one explicitly selected private profile:

```text
--stdio --v2-root ABSOLUTE_LOCAL_ROOT --database ABSOLUTE_OUTSIDE_ROOT_CACHE
--windows-task-proof --local-profile ABSOLUTE_OUTSIDE_ROOT_PROFILE
```

Info advertises exactly 16 commands: five queries, activity, creation, content update, the six single-task statuses (`task.start`, `task.pause`, `task.complete`, `task.reopen`, `task.cancel`, `task.delete`), `task.status.undo`, and matching explicit recovery. Delete is status cancellation, not physical deletion. Unflagged Windows writes remain withheld. Native permissions, UI and launch are unchanged.

A Windows single-status inverse requires one retained single-task status source, not `task.transitionMany` history or arbitrary inverses. Recovery checks both application and receipt-based evidence retirement. A valid inverse must select/affect/change exactly the requested task, have one matching source claim and no removals. Unchanged canonical files in its full-snapshot journal are guards, not permission for extra effects. Batches, grouped/operation/content/creation/deletion inverses, relationship/order and workspace controls remain unsupported.

Recognized already-applied batch effects now reflush their task directory before history, claims, receipts or retirement. An open/flush refusal is never ignored. Linux behavior retains the same guarded engine; no second writer or generic framework was added.

## Actual host and artifacts

- Windows 11 **10.0.26200**, x64, fixed local **NTFS** C:; Windows Node **24.19.0**, libuv **1.52.1**.
- Isolated checkout: `C:\Users\soleone\AppData\Local\Temp\Tasks-fcf-checkout-addd29aeed9544cc8b94f6a0f3bf4ae2`. Current bundle/checkers were transferred from WSL; older checkout source files are not complete source provenance. Owner D: checkout and personal tasks were untouched.
- Current `dist/sidecar/cli.cjs`: **513,681 bytes**, SHA-256 `809f5ca77c9d57ede481a1634aed3d1cfaa3fc796572a768bd5e71a2411607df`, verified against the transferred bundle.
- Normal status SEA: **93,465,600 bytes**, SHA-256 `609b174bd9b07e60a44a94969286a7bca2c97d3683c91993d41795a0cfc7eb6d`.
- [Status report](windows-status-proof.json) retains runtime, source bundle, 14 SEA artifacts and **156 groups**, 78 each through Windows Node and the embedded-runtime SEA.
- Same bundle also passed [64 retained creation groups](windows-status-retained-create-proof.json) and [38 retained content-update groups](windows-status-retained-update-proof.json). The update report retains binary hashes rather than a source-bundle field; bundle selection was independently verified. Original milestone reports remain historical, not overwritten. Their family-specific limitation strings do not deny the separately proven status extension.

## Evidence

- All six commands from every state: valid transitions, invalid transitions, no-ops, read-only/dry-run previews; cancellation alias semantics.
- Exact content, Markdown, edit/creation time, ordering and graph fields retained; other canonical files untouched. Closure times match retained operation time. Eligible inverses restore prior status/closure time exactly and claim the original source once.
- Retained request/actor/key/expected-version/flags identity, restarted exact replay and historical replay after target absence without resurrection.
- Missing/malformed/grouped/consumed history, no history, local/imported intervening edits, stale version, missing target and cache-loss refusals without consuming inverse keys/evidence. Missing this fixture's parent task invalidates its graph, so that scene explicitly expects `INVALID_CANONICAL`, not a fabricated task-not-found acknowledgment.
- Actual process cuts at intent, stage, replacement, verification, before/after SQLite commit and lost reply, separately for status replacement and single-status inverse. Post-effect cuts assert that the actual target equals intended bytes. Explicit resume retains original fixed bytes/time/identity/history and one-time claims.
- Missing/divergent/formatted target, membership arrival, other/copied caches, valid unsupported relationship intents, a valid two-task inverse and disguised grouped source refuse while retaining canonical/pending/history evidence.
- Already-applied inverse directory flush refusal preserves target/pending bytes with no new inverse history/claim/receipt; the same resume then succeeds.
- Recovery's own lost reply replays durable acknowledgment. A historical recovery receipt cannot retire subsequently unsupported-family pending evidence.

Self-review kept the production diff at the concrete status-source/recovery and directory-flush boundaries, with no new dependency or speculative hook. Deliberate clean-code exception: standalone Windows checker transport/selection scaffolding remains repeated across three writer-family proofs. Extracting that harness would rework previously validated family-specific fault/ownership diagnostics during a bounded scope extension; no shared generic writer framework was introduced.

Full regression: **1,624 passed, two known skips, zero failures** (1,626 total). Backend/web types, lint and clean diff pass. Original corpus coverage remains **101/112**, separate from process-group/test counts.

## Reproduce and boundaries

In a local Windows NTFS checkout with dependencies installed:

```powershell
pnpm build:backend:bundle
node scripts/check-windows-status.mjs
node scripts/check-windows-create.mjs
node scripts/check-windows-update.mjs
```

Allow at least 900 seconds for the status checker. Its initial 600-second parent window expired while Windows processes survived; the parent waited for their exit and did not count that interrupted output channel as a pass. The final rerun exited successfully and writes `.tmp/windows-status-proof.json` before stdout. Successful synthetic scenes/binaries are removed; incomplete scenes are retained. Fault transforms validate unique functions/statements and preserve conditional ownership. The verified inverse cut is after `applyV2BatchJournal`, not before the commit helper which contains publication.

The retained update checker now uses an unsupported relationship intent instead of the newly supported status intent, preserving refusal coverage and the 38-group count. Longer diagnostic scene names hit the already-known Windows SQLite path boundary before the cut; numeric disposable directories keep this short-path proof bounded, not a long-path fix. Native `m1p` must validate supported complete selected paths or separately prove longer paths.

Unsigned postject signature warnings and its repeated-injection listener warnings remain packaging limitations. No production listener/durability suppression. One local host and process interruption do not prove hardware power loss, hostile reparse/hardlink races, network/provider storage, installer/signing, native lifecycle, independent interoperability, personal rollout or release readiness. Disjoint archive/restore (`gxm`) is the next bounded prerequisite; native launch remains gated.
