# V2 mutations

**Status: accepted target, not implemented.** [Overview](overview.md). Inputs/results/authority are in protocol; storage owns journals, purge and doctor; ordering owns allocation.

## States and relationships

| Command suffix | Allowed source states | Target |
| --- | --- | --- |
| start | open, in_progress, paused, done | in_progress |
| pause | open, in_progress, paused | paused |
| complete | open, in_progress, paused, done | done |
| reopen | all five | open |
| cancel | open, in_progress, paused, canceled | canceled |
| delete | all five, including done | canceled |

Same-state requests are no-ops; other disallowed transitions fail `INVALID_TRANSITION`. `delete` remains a cancel alias, NOT a purge. No status cascades. Create is open/P2, empty description, null category/parent, empty tags/dependencies unless allowed create input supplies them; initial closure is null and placement first. Caller cannot create arbitrary status/dependency/key/timestamp fields through this command.

New parent/blocker choices MUST exist and not be canceled. Existing canceled references remain removable or restorable from valid undo history. Same parent/removing absent link are no-ops. Changed parent prepends in the new scope; descendants retain their links. Parent/dependency cycles and self-links MUST fail before writes, including batch undo/repair. Preserve the readiness baseline: done dependencies still block; canceled dependencies do not.

The [bounded Linux capture/status implementation](conformance.md#recoverable-capture-and-status) now executes the matrix, fixed creation/default/parent allocation, closure and receipt-only no-ops on disposable roots. Existing relationship edits, ordering, undo and native/provider acceptance remain outside this evidence.

## Time

Use one captured operation UTC instant, not per-file clocks. `createdAt` never changes on ordinary edit/undo. Local activity has operation time independently of task edit time.

| Effective change | updatedAt | closedAt |
| --- | --- | --- |
| create | creation instant | null |
| title/description/priority/category/tags | operation instant | preserve |
| parent/dependency edit | operation instant | preserve |
| status to done/canceled | preserve | operation instant |
| status to active | preserve | null |
| no-op | preserve | preserve |
| reorder, tied-run rekey, normalization | preserve | preserve |
| status-only undo | preserve current edit time | exact historic value |
| content/relationship undo | undo instant | historic value only if closure affected |
| observed import/migration/copied conflict version | validated source value | validated source value |

Thus create A, edit B, complete C means created A/updated B/closed C. Complete again changes nothing. Editing a closed task at D keeps closure C. Reopen clears closure; completing again at E sets E. Status undo restores C exactly, never substitutes “now.” Legacy updated times map unchanged under migration. Date sorts keep their fields; no new closure sort is introduced.

## Effects

Normalize inputs, then compare effective fields/sequence. No-op creates only a success receipt, no canonical write, fresh task version, activity, undo replacement or timestamp change. Reorder no-op is identical final IDs; explicit normalization no-op instead requires all allocated keys to match.

Changed status/content/relationships/order advance local authority independently of updatedAt. For reorder, affected local versions include logically moved selected tasks whose bytes did not change and incidentally rewritten siblings. All canonical non-order fields are preserved for key-only maintenance. Imported byte/derived-order changes MUST invalidate affected stale authority; reissuing an entire affected scope's local tokens is permitted, but cannot create canonical writes or invented actor activity.

Record one grouped local operation with actor, time, operation/request identity and affected before/after fields. Distinguish move intent from incidental maintenance. Remote observation MAY record an observed change without fabricating original actor/action/time. JSON alone cannot rebuild local activity/undo history. A success response MUST follow verified canonical writes and local receipt/history commit. Failure during a file batch is pending/conflicting recovery, not partial success or a promise of cross-device atomicity.

## Undo

- Latest-status undo needs fresh context/task token and eligible latest local status history. An intervening meaningful change makes it unavailable. Missing old status/closure yields `UNDO_UNAVAILABLE`.
- Grouped operation undo checks recorded affected postconditions and fresh byte/scope guards, preserving unrelated fields that changed afterward. It validates the complete prospective graph before writes.
- Reorder/normalize history includes selected logical effects, every rewritten old/new key, and complete relevant sibling sequences. New arrivals, changed membership/order/affected keys make undo unavailable; do not reorder unexpected tasks. Order-only undo preserves current timestamps and advances affected local versions.
- Creation undo can physically remove only an unchanged task with no newer children or dependency links. Archive/guard it as destructive work, never remove from stale cache inference.
- Purge, doctor and migration are not generic undo. Their explicit recovery copies/restore procedure replace that promise. Nonempty destructive operations invalidate unsuitable prior undo; no-ops leave it intact.
- Validate all batch effects before first write; retain one immutable local pending intent for interrupted work. No rollback/resurrection on divergence.

Normative cases: `status-matrix`, `time-complete`, `time-noop`, `time-edit-closed`, `time-status-undo`, `time-parent`, `time-reorder`, `undo-cycle`, `undo-unrelated-edit`, `undo-order-arrival`, `undo-missing-history`, `reorder-selected-unchanged`, `noop-receipt`. Production v1 tests do not prove these new timestamp/effect rules.
