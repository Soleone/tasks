# Ideas and proposals

This directory contains proposals and historical roadmap material, not current behavior or implementation commitments. For the implemented system, start at [the current specification](../spec/overview.md). The [current plan](../PLAN.md) prioritizes a portable **single-directory** TaskDB contract; the older combined-source roadmap is not the next-work queue.

## Contract symmetry

Use the same subject boundaries on both sides. A proposal explains choices and open questions; an accepted, versioned contract moves to `spec/v2/` before implementation. Root `spec/` pages remain the implemented v1 reference. Do not copy every v1 page into ideas or assert a rule in both places; link to the unchanged baseline. A proposal's presence does not imply acceptance.

| Contract subject | Current v1 authority | V2 proposal, if one exists |
| --- | --- | --- |
| Canonical task model | [model](../spec/model.md) | [data model](task-model-v2.md) |
| Domain mutations and lifecycle | [mutations](../spec/mutations.md) | [behavior](task-behavior-v2.md) |
| Collection lifecycle, file layout, and sync | [storage](../spec/storage.md) | [collection lifecycle and migration](collection-lifecycle-v2.md), [sync and ordering](syncthing-sync-ordering.md) |
| Queries and sorting | [queries](../spec/queries.md) | Baseline filters/sorts retained; new projection/input boundary in [commands](protocol-v2.md), order in [sync and ordering](syncthing-sync-ordering.md) |
| Command envelope and errors | [protocol](../spec/protocol.md) | [command boundary](protocol-v2.md), selected reconciliation; v1 still governs shipped clients |
| CLI and first-party UI | [CLI](../spec/cli.md), [UI](../spec/ui/overview.md) | CLI negotiation/input deltas in [commands](protocol-v2.md); first-party UI contract stays the baseline until adapted |
| Optional multi-source routing | [sources](../spec/sources.md) | [historical combined-source v0 contract](multi-source-v0-contract.md), not on the single-root critical path |

The UI calls application actions; controllers route and adapt those calls but do not own domain rules. Node and Android adapters may differ internally, but should implement the same domain and action contracts unless a documented capability difference is intentional. Keep implementation architecture in development/architecture docs rather than treating controller internals as user-facing requirements.

## Selected reconciliation

The model, behavior, command and lifecycle proposals now describe one matching **target direction**, not shipped v2:

- Minimal synced data: schema-2 manifest plus flat task files; no synced versions, contexts, receipts, history or repair ledger.
- Protocol 2 keeps v1 clients/roots separate. Literal JSON title/classification fields and an explicit inline shorthand input share the command path.
- Retry receipts stay in SQLite. Ordinary restart/rebuild with retained state can replay; complete cache loss invalidates the local write context and requires manual reconciliation.
- Keep the existing status/readiness baseline; change edit-versus-closure timestamp meaning explicitly. Grouped rekeys/undo use complete guards, not timestamp merge winners.
- One nominated device performs reviewed conflict/link repairs with fixed plan IDs, original-byte recovery copies, and no cross-device exactly-once claim.
- Convert verified v1 data only into a separate staged root; preserve the old root and report transformations/refusals. Rollback returns to the old snapshot, not a reverse conversion of subsequent v2 edits.

Next promote reviewed decisions and black-box fixtures to `spec/v2/` as **accepted targets**, before implementation. Full migration/doctor/cache-loss/native/provider conformance remains open; closing a proposal task does not close those gates.

## Current proposals

- [TaskDB v2 data model](task-model-v2.md): candidate manifest and task fields.
- [TaskDB v2 domain behavior](task-behavior-v2.md): lifecycle and timestamp rules.
- [TaskDB v2 command boundary](protocol-v2.md): literal-title/shorthand inputs, API/CLI negotiation, local versions/context, cache-only retries, and explicit recovery/repair controls.
- [Collection lifecycle and migration](collection-lifecycle-v2.md): first join, ID collisions, physical deletion, staged conversion, and proof still required.
- [Syncthing sync and ordering direction](syncthing-sync-ordering.md): local file observation, conflict risks, and sparse ordering.
- [TaskDB 2.0 pivot roadmap](taskdb-2.0-roadmap.md): the earlier multi-source-led plan, retained as historical context.
- [Combined-source v0 contract](multi-source-v0-contract.md): the broader design draft; implemented behavior is separated into the current [source specification](../spec/sources.md).
