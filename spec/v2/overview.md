# TaskDB v2 target

**Status: accepted target, not implemented.** Accepted for the bounded single-directory implementation gate (2026-10-01). Acceptance specifies intended behavior; it is not a passing writer, migration, native-platform or public-standard claim. The [root specification](../overview.md) remains implemented v1. No live directory is upgraded merely by installing a newer client.

MUST/MUST NOT are requirements. MAY is optional behavior that cannot weaken a MUST. A client claiming a capability MUST pass its applicable cases and declare unsupported operations rather than approximate them.

## Contract owners

- [Model](model.md): exact canonical fields, text, classification, timestamps and graphs.
- [Protocol](protocol.md): input grammar, envelope, public commands/results, errors, queries and friendly CLI deltas.
- [Mutations](mutations.md): effects, transition matrix, edit/closure times, local activity and undo.
- [Ordering](ordering.md): exact algorithm, comparison, tied-run maintenance and normalization.
- [Storage](storage.md): root, observation, guarded journals, conflict repair and physical deletion.
- [Migration](migration.md): verified v1 field mapping, staging, publication and rollback.
- [Conformance](conformance.md): declarative corpus, capability profiles and measured-evidence boundaries.

Only the manifest and flat task files are synced TaskDB state. No task type, workspace ID, sync block, writer identity, local version, context, receipt, activity or repair ledger is added to canonical files. Successful retry receipts stay in SQLite. Complete cache loss invalidates local write authority and requires reconciliation, not a new replicated history system.

## Version and compatibility boundaries

Canonical schema **2**, command protocol **2**, internal cache schema and fixture format are independent numbers. `tasks.tasks-export` version 2 is a legacy export, NOT this canonical schema. Protocol 1 on schema 1 remains v1; protocol-2 task commands on schema 1 fail `UNSUPPORTED_SCHEMA`; protocol 1 cannot write schema 2. Existing old binaries may report their existing `INVALID_CANONICAL` refusal. Explicit init or separate-root migration is required.

Deliberate v1 differences: literal `title` plus explicit category/tags and optional shorthand `text`; flat string classification projections without case labels; `description`/`closedAt` replace aliases; `updatedAt` excludes lifecycle/order-only actions; per-task sparse keys replace dense order files; referenced purges reject rather than reparent/unlink; local context binds numeric versions and cache-only retries; stricter Unicode/JSON/timestamp validation and whole-graph undo checks. Migration preserves the old `updatedAt` instant rather than inventing an edit history.

Status/readiness remain unchanged, including done dependencies counting as blockers until canceled/unlinked. There is no new closure sort, source registry, adapter, combined-source UI or automatic semantic sync repair in this target. The default UI remains [v1](../ui/overview.md). A separate [explicit read-only browser reader](conformance.md#explicit-read-only-app-reader) now provides a partial client adaptation; UI writes/retries, migration controls, native desktop launch and Android integration remain withheld.

## Delivery gate

The corpus is [scripts/fixtures/taskdb-v2/](../../scripts/fixtures/taskdb-v2/README.md). Its integrity checks are not execution of protocol 2. First implement a bounded recoverable Node slice on disposable roots; advertise only supported commands. Prove full conversion/rollback before offering migration or changing personal data. Exercise Android/providers independently or explicitly withhold writable capabilities. Native M1 remains open regardless of this target acceptance.
