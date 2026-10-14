# TaskDB v2 target

**Status: accepted target; bounded implementation.** [Current support](../../docs/support.md). Accepted for the bounded single-directory implementation gate (2026-10-01). Acceptance specifies intended behavior; it is not a passing writer, migration, native-platform or public-standard claim. The [root specification](../overview.md) remains implemented v1. No live directory is upgraded merely by installing a newer client. The [clean-cut plan](../../PLAN.md) now targets one replacement application and one current specification, not permanent v1/v2 runtimes. Legacy support will be isolated to one-time conversion; schema/protocol version numbers remain meaningful. Current opt-in behavior below is evidence of today's implementation, not a compatibility promise.

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

Status/readiness remain unchanged, including done dependencies counting as blockers until canceled/unlinked. There is no new closure sort, source registry, adapter, combined-source UI or automatic semantic sync repair in this target. The unflagged UI remains [legacy](../ui/overview.md). Explicit Windows native selection now connects the **established main client** to the bounded task-proof profile: root capture (simplified-route Windows proof pending)/content/classification/priority, six single-task statuses, eligible latest-status undo, queries/search and external refresh. [Restored-client evidence and gaps](../../docs/restored-main-client.md). Child/relationship/order/batch/general-undo writers, app recovery/migration and Android replacement integration remain unavailable there; native launch itself is no longer withheld.

The separate Linux browser reader/editor is engineering evidence, not the daily-use candidate. It supports reading plus explicit capture/content and six single-task status preview/apply with fixed memory-held retries, but exposes no status undo, relationship, order, batch or control UI. The [support index](../../docs/support.md) distinguishes backend admission, client exposure and actual platform proof.

## Delivery gate

The corpus is [scripts/fixtures/taskdb-v2/](../../scripts/fixtures/taskdb-v2/README.md). Its integrity checks are not execution of protocol 2. Bounded Linux Node task/control implementation, Linux conversion rehearsal and actual Windows native task-loop evidence exist; they do not complete the target or authorize further scope. Advertise only supported commands. Personal-data conversion/selection still needs explicit approval and a proved host. Exercise Android/providers independently or explicitly withhold writable capabilities. Native M1 remains open regardless of this target acceptance.
