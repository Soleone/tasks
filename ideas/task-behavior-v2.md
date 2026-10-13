# TaskDB v2 domain behavior proposal

**Status:** Selected rules promoted to the [accepted v2 target](../spec/v2/mutations.md) on 2026-10-01, **not implemented**. This document preserves proposal reasoning, earlier reconciliation and bounded evidence; the versioned target is authoritative where details differ. Root [v1 specs](../spec/overview.md) remain shipped behavior. Promotion does not prove migration, doctor, receipts, native providers or interoperability.

## Unchanged domain baseline

Keep the v1 status transition matrix, including same-status no-ops and the deliberate `task.delete` alias exception:

| Action | Allowed starting states | Target |
| --- | --- | --- |
| start | open, in_progress, paused, done | in_progress |
| pause | open, in_progress, paused | paused |
| complete | open, in_progress, paused, done | done |
| reopen | all five states | open |
| cancel | open, in_progress, paused, canceled | canceled |
| delete (legacy cancel alias) | all five states, including done | canceled |

An unsupported transition fails before writing. Cancellation is not physical deletion. No parent/child or dependency status cascades. A new task is open, priority 2, with no dependencies and first in its sibling scope; a new parent must exist and not be canceled. Moving to the current parent is a no-op; moving to another parent enters that scope first and carries descendants without rewriting their parent links.

Parent and dependency graphs stay within one collection. New parent/blocker choices cannot be canceled; existing canceled references remain removable and may be restored from a valid prior undo snapshot. All prospective graph changes, including batch undo and doctor repairs, must reject missing targets, self-links, and cycles before the first write. Restoring history is not permission to recreate a now-invalid graph.

**Readiness is unchanged in this format work:** the v1 implementation counts every dependency except canceled as a blocker, including done dependencies (`taskRecords.ts`/`taskQueries.ts`). Retain that rule rather than silently changing it while migrating storage. If completion should instead unblock dependents, accept it as a separate behavior change with fixtures. Inbox/Today/blocked remain views, not additional statuses.

## Timestamp mutation rules

For v2, `updatedAt` means the last non-lifecycle edit, not the last mutation. Its legacy migration exception is in the model.

| Changed operation | `updatedAt` | `closedAt` |
| --- | --- | --- |
| create | Same creation instant as `createdAt` | null |
| title, description, priority, category or tags | Operation time | Preserve current value |
| parent/dependency edit | Operation time | Preserve current value |
| status-only transition to done/canceled | Preserve | Set to this transition's operation time |
| status-only transition to an active state | Preserve | Clear to null |
| same-status or other effective no-op | Preserve | Preserve |
| manual reorder / incidental tied-run rekey / explicit normalization | Preserve | Preserve |
| status-only undo | Preserve current edit time | Restore exact prior value from undo history |
| undo that changes content/priority/classification/relationships | Undo time, a new edit | Restore prior closure value only if closure is also being undone |
| import, transport observation, migration or copying an existing conflict version | Preserve validated source values | Preserve validated source values |

`createdAt` never changes on ordinary edits or undo. One operation uses one captured UTC time for its changed fields and local activity, not a new time per file. Times need not increase numerically when a device clock moves backward; optimistic guards and file preservation, not timestamps, decide write safety. Repeated successful retries return their existing result and never regenerate time or keys.

Editing a closed task advances `updatedAt` without changing its closure. A done-to-canceled transition through the delete alias records a new closure instant. Reopening clears the current closure; a later completion gets a new closure. Status undo restores the previous closure exactly, never fabricates a replacement timestamp when history is missing.

Use `closedAt` for a closure-time query, not `updatedAt`. The current Updated sort keeps its name but follows the new field meaning; completing a task is visible in activity rather than making it a recently edited task. UI wording/controls remain a separate contract. Existing created/updated/priority/manual queries stay the baseline. The field alone does not approve a new query or UI feature; any later closure-time sort must define null handling and fixtures explicitly.

## Effective changes, versions and activity

Normalize command input before comparing effective values. A title-only literal edit does not clear classification; shorthand replacement explicitly replaces it. Reordering identical IDs, setting the same priority/category/tags, removing an absent dependency, or selecting the same status is a no-op. Explicit normalization is the exception to the identical-sequence reorder shortcut: it maintains keys without changing the sequence and is a no-op only when every key already matches the pinned full-scope allocation. No-ops record a successful local retry receipt but do not write canonical files, change task versions/timestamps, add activity, or replace undo history.

A changed status, content, relationship or order action advances local optimistic authority even when `updatedAt` does not change. Exact token/context rules are owned by commands. For a changed reorder, advance selected tasks' local versions even if a selected key's bytes stay unchanged; also advance versions for incidentally rewritten siblings. Outside neighbors are scope guards, not incidental canonical writes.

Record status-only changes, reorders/rekeys, meaningful edits, undo and explicit recovery outcomes in local activity with actor, operation time, request/operation identity, and relevant before/after fields. A tied-run move is one grouped operation: distinguish the requested move from incidental order maintenance, not a set of fake content edits. Never claim that deleting/rebuilding from canonical JSON reconstructs activity or historic undo. An observed remote difference may be reported as an imported change without inventing its original actor/action/time.

## Undo safety

Preserve the v1 distinction between latest-status undo and grouped, affected-field-aware operation undo:

- Status undo requires a fresh task token and eligible local history for its latest status change. An intervening meaningful task change makes that shortcut unavailable. Missing prior status/closure data fails `UNDO_UNAVAILABLE`, not “restore done at now.”
- Operation undo restores only recorded affected fields, allowing unrelated content changes when the affected postconditions still match. It verifies the prospective complete graph; it never restores a graph cycle because a remote edit occurred after the original action.
- Reorder/normalization undo records old/new keys for every rewritten task, selected logical moves, and the complete relevant sibling sequence. It refuses changed membership/order/affected keys, including newer arrivals; never “best-effort” reorders unrelated new tasks. Preserve timestamps for order-only undo and advance fresh local versions for affected tasks.
- Undoing creation is allowed only while the created task is unchanged and has no newer children or dependency relationships. Its physical removal uses the same recovery/archive rules as other explicit deletion, not cache-driven disappearance.
- Purge, migration, and doctor repair are not generic undo operations. They supply recovery artifacts and explicit restore procedures. A nonempty destructive operation invalidates inappropriate prior undo; a no-op leaves it intact.
- A grouped operation validates all effects before writes, uses one local journal, and never reports success for a conflicting partially applied operation. SAF/file transport may expose intermediate files; local recovery semantics do not imply cross-device atomicity.

## Behavioral examples for target fixtures

Let creation be A, content edit B, completion C, reopen D, and undo E, each a distinct instant.

| Sequence | Required outcome |
| --- | --- |
| create at A, edit at B, complete at C | created A, updated B, closed C, done |
| complete again after C | No timestamp/version/activity change |
| edit the done task at D | updated D, closed C |
| reopen at D, undo at E with eligible history | done, closed C restored, latest content-edit time unchanged |
| reopen at D, complete at E | closed E; do not retain C as current closure |
| delete alias on done at D | canceled, closed D; normal cancel on done is rejected |
| move to another parent at D | updated D; a pure reorder at D leaves updated unchanged |
| move between tied keys; only a neighbor's key bytes change | selected task still gets a fresh local token and grouped move activity |
| undo title edit at E | Old title/classification restored, updated E; no invented actor/history from canonical data |
| undo a relationship after a remote change would cause a cycle | Reject the entire undo before writes |
| task depends on a done task | Still blocked under the unchanged v1 readiness rule |

These examples are target design, not tests of shipped v2. They are covered by the accepted [v2 mutations spec](../spec/v2/mutations.md) and [materialized conformance corpus](../spec/v2/conformance.md). Real Node/Android timestamp, receipt and undo behavior remains implementation work.
