# TaskDB v2 domain behavior proposal

**Status:** Working proposal, not implemented behavior. Current v1 behavior remains authoritative in the [system specification](../spec/overview.md). The task fields are described in the [v2 data model proposal](task-model-v2.md).

## Scope and boundaries

This note describes domain rules that should hold regardless of whether a task is edited through the UI, CLI, or another client. It does not specify presentation, command envelopes, controller routing, or Node/Android storage mechanics.

- The [v1 mutation catalog](../spec/mutations.md) remains the baseline for supported actions and transitions unless a v2 decision explicitly changes it.
- The [v1 protocol](../spec/protocol.md) remains the baseline for request, version, idempotency, and error behavior.
- User-visible interaction belongs in the [UI specification](../spec/ui/overview.md). Platform and storage mechanics belong in the relevant implementation documentation.
- Syncthing file observation and stale-write checks belong in the [sync and ordering proposal](syncthing-sync-ordering.md); physical deletion preconditions and first join belong in the [collection lifecycle proposal](collection-lifecycle-v2.md).

## Proposed timestamp semantics

For v2, `updatedAt` means the last non-lifecycle task edit, not the last mutation of any kind.

- Changes to task content or relationships advance `updatedAt`.
- Status-only transitions do not advance `updatedAt`, including transitions into `done` or `canceled` and reopening. A changed transition still advances the device-local optimistic task version.
- Order-only changes do not advance `updatedAt`.
- Entering `done` or `canceled` sets `closedAt` to that transition's timestamp. Moving back to a nonterminal state clears `closedAt`. A same-status no-op changes neither timestamp.
- Editing a closed task's content advances `updatedAt` but leaves `closedAt` unchanged.
- Use `closedAt`, not `updatedAt`, when sorting by closure time. A user-facing “recently updated” sort will not treat a status-only transition as an edit; its exact presentation belongs in the UI contract.

This intentionally differs from v1, where a changed status transition advances `updatedAt`. It keeps the pre-close edit time available while `closedAt` records when the task entered its terminal state.

## Open behavior questions

- Confirm whether all current v1 status-transition and undo rules carry over unchanged apart from the timestamp behavior above.
- Define how imports and merges preserve timestamps without treating a missing file as a deletion.
- Specify whether activity/history needs to expose status-only changes when `updatedAt` no longer does.
