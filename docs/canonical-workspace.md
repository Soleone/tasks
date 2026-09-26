# Canonical workspace files

This is the current v1 file layout. See the [current storage specification](../spec/storage.md) for the file and cache contract.

Tasks keeps current task state in ordinary JSON files and uses SQLite as a local, rebuildable query cache. The default root is `sync/` beside `tasks.db`; set `TASKS_SYNC_ROOT` for a different root. Keep the root and the database out of the same live Syncthing share. Sync only the JSON root.

```text
sync/
  workspace.json
  tasks/<task-id>.json
  order/root.json
  order/<parent-task-id>.json
```

## Workspace record

`workspace.json` is immutable identity metadata:

```json
{
  "format": "tasks.workspace",
  "formatVersion": 1,
  "workspaceId": "stable-workspace-id",
  "schemaVersion": 1
}
```

A root containing task or order files without `workspace.json` is treated as an incomplete transfer. The app does not create a second workspace identity in that case.

## Task record

Each `tasks/<id>.json` contains the complete current task state. Classification is derived from `title` when a file is imported.

```json
{
  "format": "tasks.task",
  "formatVersion": 1,
  "workspaceId": "stable-workspace-id",
  "id": "task-id",
  "title": "Prepare launch @planning #product",
  "descriptionMarkdown": "",
  "status": "open",
  "priority": 2,
  "parentId": null,
  "dependencyIds": [],
  "createdAt": "2026-09-08T20:51:04.113Z",
  "updatedAt": "2026-09-08T20:51:04.113Z",
  "completedAt": null,
  "canceledAt": null,
  "sync": {
    "revision": 1,
    "modifiedBy": "laptop",
    "basedOnHash": null,
    "contentHash": "sha256-of-the-fields-without-this-hash"
  }
}
```

The canonical file does not contain SQLite's local `version`, dense `position`, activity, command receipts, FTS rows, or derived category/tag IDs. The hash is SHA-256 over stable JSON with `sync.contentHash` omitted. Revision, device, and base hash are diagnostics. They never select a winner for concurrent edits.

## Sibling order

Each sibling scope has an order file. `root.json` is the top-level scope. Other files name the parent task.

```json
{
  "format": "tasks.sibling-order",
  "formatVersion": 1,
  "workspaceId": "stable-workspace-id",
  "parentId": null,
  "taskIds": ["task-a", "task-b"],
  "sync": {
    "revision": 4,
    "modifiedBy": "laptop",
    "basedOnHash": "sha256-of-previous-order",
    "contentHash": "sha256-of-the-fields-without-this-hash"
  }
}
```

`parentId` on a task determines scope membership. The order file only orders IDs that belong to that scope. Duplicate IDs and IDs known to belong to another scope are invalid. Unknown IDs are kept pending during incremental import. A valid task missing from the list stays in the cache and receives the deterministic fallback position at the beginning of its scope.

## Recovery and conflicts

The app uses `.tasks-local/pending-operation.json` beside the database for bounded recovery of multi-file writes. It is local state and must not be synced. On the next command, the pending operation is completed or rolled back as one idempotent operation.

For a safe multi-device seed, read [Syncthing setup](syncthing.md) before sharing this root. In particular, do not let a new device create its own `workspace.json` before it receives the existing one.

SQLite stores file size, modification time, imported hash, revision, and device metadata in `sync_files`. Normal commands scan metadata first and read only changed files. `workspace.rebuild` forces a complete scan, clears derived cache data, rebuilds relationships and indexes, and advances the cache generation. Restoring a SQLite snapshot also bootstraps canonical files and starts a new cache generation. New local versions then invalidate pre-rebuild and pre-restore optimistic tokens.

Android's `workspace.rebuild` validates and reimports the selected canonical files even when their fingerprint is unchanged, then advances its local task-version offset. Within the same workspace, idempotency receipts survive so retries cannot repeat successful writes; local activity and the latest undo record do not survive because canonical files cannot restore that history and rebuild invalidates its version checks. Adopting a different workspace still follows the receive flow and clears the old workspace's receipts.

Syncthing conflict copies remain ordinary files and are indexed without automatic merging:

```text
workspace.conflict.list
workspace.conflict.resolve  { "conflictId": 1, "resolution": "keep-canonical" }
workspace.conflict.resolve  { "conflictId": 1, "resolution": "use-conflict" }
workspace.conflict.resolve  { "conflictId": 1, "resolution": "discard" }
```

Task conflicts replace one whole task candidate. Order conflicts replace only the sibling sequence. The losing conflict file is never deleted by the app. `workspace.sync` reports file counts, cache generation, and unresolved conflict count. `workspace.archive` copies the canonical root to a timestamped archive.

`workspace.archive` creates a timestamped copy of the canonical JSON root. `workspace.export` is a lossless JSON snapshot of the local cache, while `workspace.backup` creates a consistent SQLite copy. `workspace.exportTasks` writes a readable portable view beside the database. These local artifacts are not substitutes for the canonical workspace root or an independent backup plan.
