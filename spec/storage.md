# Storage and architecture

**Legacy default (implemented; removed at `dvs`).** Replacement authority: [V2 storage](v2/storage.md).

## Authorities and execution path

For the Node desktop, CLI, sidecar, and web-development path, canonical JSON files hold current task state. SQLite is a local rebuildable cache. The common path is:

```text
UI / CLI / JSON-lines request
          ↓
     executeCommand
          ↓
workspace lock → reconcile canonical files → task command
          ↓                                  ↓
      SQLite cache                    canonical JSON writes
```

The first-party UI and CLI call the same Node command path. Android uses a separate private SQLite cache and can optionally write canonical files through Android's Storage Access Framework (SAF); its transaction and recovery limits differ.

## Canonical v1 folder

```text
sync/
  workspace.json
  tasks/<task-id>.json
  order/root.json
  order/<parent-task-id>.json
```

`workspace.json` holds `format: "tasks.workspace"`, `formatVersion: 1`, `workspaceId`, and `schemaVersion: 1`. It gives the root its stable identity. Task and order records without it are treated as an incomplete workspace, not assigned a new identity.

Task fields are defined in [Task model](model.md). Each order record uses `format: "tasks.sibling-order"`, version 1, `workspaceId`, `parentId`, `taskIds`, and `sync`. Root order has `parentId: null`; each other file orders the children of its parent. The task's `parentId` determines membership, while `taskIds` determines order.

Every canonical record's `sync` object contains `revision`, `modifiedBy`, `basedOnHash`, and `contentHash`. The TypeScript implementation hashes stable JSON with only `sync.contentHash` omitted. Cross-language string and number encoding has not been proven equivalent, so this is not yet evidence of independent-writer interoperability.

## SQLite cache

The current Node database schema version is 6. Its main tables include:

- `tasks`, `categories`, `tags`, `task_tags`, and `task_dependencies` for query state;
- `activity`, `command_receipts`, `operations`, and `operation_effects` for local history, retries, and undo;
- `sync_files`, `sync_conflicts`, and `cache_meta` for canonical-file tracking, conflict state, and cache generation/revision.

Dense sibling positions, optimistic versions, FTS indexes, activity, and command receipts are local cache state. Do not sync the SQLite database, its WAL/SHM files, or `.tasks-local/`. Use the SQLite backup operation rather than copying only the live database file.

Before canonical changes are applied, a local pending-operation journal records intended file replacements. The next command completes or rolls back an interrupted operation. Workspace locks serialize cooperating Node writers. `workspace.rebuild` reimports canonical files and advances the cache generation, invalidating old optimistic versions.

## Conflicts and artifacts

Canonical conflict copies are retained for explicit resolution; the app does not silently pick a winner or delete the losing copy. Android reports unresolved SAF conflicts but does not resolve them.

| Artifact | Role |
| --- | --- |
| Canonical `sync/` JSON | Authoritative current state for a TaskDB v1 workspace. |
| SQLite `tasks.db` | Local cache, history, receipts, indexes, and recovery metadata. |
| `workspace.backup` | Consistent SQLite backup. |
| `workspace.export` | JSON snapshot of task state, classifications, relations, activity, and command receipts. It does not include every local history, sync, or recovery table. |
| `workspace.exportTasks` | Readable `tasks.tasks-export` version 2 projection. |
| JSON-lines request | Command transport, protocol version 1. |

The `workspace.export` snapshot contains `formatVersion`, `schemaVersion`, `exportedAt`, `categories`, `tags`, `tasks`, `taskTags`, `taskDependencies`, `activity`, and `commandReceipts`. `workspace.exportTasks` uses a different readable schema: each task has `id`, `siblingOrder`, `title`, `status`, `priority`, category/tag slugs, `parentId`, `blockedByIds`, `notesMarkdown`, and lifecycle timestamps. In that export, `blockedByIds` currently carries all direct dependency IDs, including canceled targets; use the command API's `TaskRecord.blockedByIds` for only non-canceled blockers. The portable export omits source refs and the command API's optimistic `version`.

These artifacts are not interchangeable. Restore writes to a new destination; it does not overwrite the live database in place. Use `workspace.backup` when a complete SQLite copy is needed. See [the canonical workspace guide](https://github.com/Soleone/tasks/blob/f762b50c8739b994629c68e4ab62a3a01142aaae/docs/canonical-workspace.md) for user-facing recovery steps.
