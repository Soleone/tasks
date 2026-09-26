# Canonical v1 workspace

**Current v1.** This document describes the existing file contract, not a new TaskDB 2.0 format. Preserve it while making the command implementation easier to reuse. Full worked records and recovery details are also in the [canonical workspace guide](../docs/canonical-workspace.md); conformance fixtures will pin language-independent encodings in Stage 2.

```text
sync/
  workspace.json             immutable identity, tasks.workspace v1
  tasks/<task-id>.json       complete current task, tasks.task v1
  order/root.json           root sibling order, tasks.sibling-order v1
  order/<parent-id>.json    child sibling order, tasks.sibling-order v1
```

The default root is `sync/` beside `tasks.db`; `TASKS_SYNC_ROOT` can override it in the Node path. A root with tasks/order files but no `workspace.json` is an **incomplete transfer**, not permission to invent a new workspace identity. `workspace.json` contains `format`, `formatVersion: 1`, `workspaceId` and `schemaVersion: 1`; it is the identity for this root. A local cache tied to another workspace ID must not silently adopt it.

Each task file contains `format: "tasks.task"`, `formatVersion: 1`, `workspaceId`, `id`, `title`, `descriptionMarkdown`, `status`, `priority`, `parentId`, `dependencyIds`, `createdAt`, `updatedAt`, `completedAt`, `canceledAt`, and `sync`. The ID must match the task filename. `completedAt` is non-null exactly when status is `done`; `canceledAt` is non-null exactly when status is `canceled`. The category/tags are derived from the **title** on import, not independent stored fields. No `source key` belongs in this file. A relation ID means another task in the same workspace.

Each order file contains `format: "tasks.sibling-order"`, `formatVersion: 1`, `workspaceId`, `parentId`, ordered `taskIds`, and `sync`. Root has `parentId: null`; another order filename identifies its parent. Parent ID on a task establishes membership; the order file sequences members of that scope. Duplicates and known wrong-scope IDs are invalid; an unknown task ID may remain pending during incremental import. A valid task absent from its order list gets a deterministic fallback position until reconciled.

`sync` contains `revision`, `modifiedBy`, `basedOnHash`, and a 64-character lowercase hexadecimal `contentHash`. The hash is SHA-256 of a stable JSON encoding of the whole record with **only** `sync.contentHash` omitted. That encoding recursively sorts object keys and preserves array order; see `src/backend/canonicalJson.ts` and `src/backend/requestHash.ts`. Revision/base hash describe lineage, but they do not choose a conflict winner. Before a non-TypeScript writer is declared compatible, fix cross-language canonical-JSON examples and tests: JSON string/number encoding must match, not just object ordering.

## Cache, recovery and conflicts

SQLite is a **local, rebuildable query cache** for canonical current state, classification, relationships and indexes. Local task versions, positions, activity, operations, receipts and FTS data are not in task JSON. Do **not** sync SQLite, WAL/SHM, or `.tasks-local/`. The local pending-operation journal next to the database makes interrupted multi-file writes recoverable on the next command; workspace locking serializes cooperating Node clients. `workspace.rebuild` reimports canonical records and advances a cache generation, invalidating old local optimistic versions. Android has its own SAF staged-write and private SQLite path, with a different atomicity limit; a provider does not offer a multi-file transaction.

Conflicting Syncthing files are retained and reported explicitly. `workspace.conflict.list`/`resolve` offer a human choice on desktop/CLI; never silently choose a winner or delete the losing file. Order conflicts replace a sibling sequence, task conflicts replace one task candidate. Android currently reports unresolved copies but does not resolve/delete them. See [Syncthing guidance](../docs/syncthing.md) before sharing the root.

## Different artifacts, different guarantees

| Artifact | Role |
| --- | --- |
| `sync/` canonical JSON | Authoritative *current* task state for a v1 workspace. |
| SQLite `tasks.db` and `.tasks-local/` | Local cache, history, receipts and write recovery; not a sync format. |
| `workspace.backup` / `workspace.export` | Consistent local SQLite backup / lossless cache snapshot; not replacements for a synced canonical root. |
| `workspace.exportTasks` | Smaller readable portable task export (`tasks.tasks-export` v2), omits local concurrency state; not a v1 task file. |
| JSON-lines command envelope | Process protocol (`version: 1`), not a storage or export schema. |

A combined TaskDB 2.0 client may mount several v1 roots, but each keeps its own identity, files, cache and recovery. An external write-through adapter owns **no** TaskDB canonical copy of its source. Source registry keys and cached projections stay outside the canonical v1 tree. Unknown v1 file fields and migration policy need explicit audit before any format change; never assume a current rewrite round-trips them.
