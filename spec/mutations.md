# Mutations and workspace operations

This is the current write catalog for the Node command path. Task writes preserve canonical JSON, local cache, version, activity, and receipt rules described in [Protocol](protocol.md) and [Storage](storage.md).

## Task mutations

| Command | Main arguments | Current behavior |
| --- | --- | --- |
| `task.create` | `title`, optional `descriptionMarkdown`, `priority`, `parentId` | Creates an open task, default priority P2, at the beginning of its sibling scope. |
| `task.update` | `id`, expected version, optional `title`, `descriptionMarkdown`, `priority` | Partial update. Title edits recalculate derived category and tags. |
| `task.start` | `id`, expected version | Sets `in_progress` from open, in-progress, paused, or done. |
| `task.pause` | `id`, expected version | Sets `paused` from open, in-progress, or paused. |
| `task.complete` | `id`, expected version | Sets `done` from open, in-progress, paused, or done. |
| `task.reopen` | `id`, expected version | Sets `open` from any status. |
| `task.cancel` | `id`, expected version | Sets `canceled` from open, in-progress, paused, or canceled. |
| `task.delete` | `id`, expected version | Legacy alias for cancellation, not permanent deletion. |
| `task.purgeCanceled` | optional `readOnly`/`dryRun` preview flags | Permanently removes all canceled tasks; surviving children are promoted to root, and dependencies and canonical order files are repaired. |
| `task.move` | `id`, expected version, `parentId` (`null` for root) | Changes parent; the task enters the new sibling scope first. Moving under its current parent is a no-op, not a reorder. Descendants stay under the moved task. |
| `task.dependency.add` | task ID, expected version, `dependsOnId` | Adds a source-local dependency; self-links and cycles are rejected. |
| `task.dependency.remove` | task ID, expected version, `dependsOnId` | Removes a dependency link. |
| `task.reorder` | `tasks: [{id, expectedVersion}]`, `placement` | Reorders selected siblings using exactly one of `beforeId`, `afterId`, `first: true`, or `last: true`. |
| `task.transitionMany` | versioned task/command items | Applies a batch of status transitions atomically. |
| `task.status.undo` | task ID and expected version | Undoes the latest eligible status transition. |
| `task.status.undoMany` | versioned task items | Undoes a grouped status transition when the group still matches. |
| `operation.undo` | `operationId` | Undoes that eligible operation group, subject to version and relationship checks. |

Repeated status transitions to the same status are no-ops. Unsupported transitions fail with `INVALID_TRANSITION`. `task.cancel` does not cancel a `done` task; the legacy `task.delete` alias can. A canceled dependency remains linked but does not block readiness. Canceled tasks cannot be selected as a new parent or dependency target. Parent and dependency relationships do not cross workspace boundaries.

## Workspace, export, and settings operations

| Command | Main arguments | Current behavior |
| --- | --- | --- |
| `workspace.backup` | `destinationPath` | Writes a consistent SQLite backup; does not overwrite an existing destination. |
| `workspace.export` | optional `destinationPath` | Returns a cache snapshot and writes it when a destination is supplied; see [Storage](storage.md) for the included tables. |
| `workspace.exportTasks` | optional preview flags | Writes a readable portable task export under the database's `exports/` directory. |
| `workspace.restore` | `sourcePath`, new `destinationPath` | Restores a snapshot to a new workspace; it refuses an existing destination or the snapshot itself. |
| `workspace.rebuild` | optional preview flags | Reimports canonical files and replaces/reconciles the local cache. |
| `workspace.archive` | optional preview flags | Archives the canonical JSON workspace. |
| `workspace.conflict.resolve` | `conflictId`, resolution | `keep-canonical`, `use-conflict`, or `discard`; the conflict candidate is retained for explicit handling. |
| `workspace.receive.prepare` | none | Backs up the current canonical workspace and prepares to adopt an incoming one. |
| `workspace.receive.abort` | none | Aborts a pending receive and restores its backup. |
| `theme.set` | theme name | Changes the selected theme preference. |

`workspace.sync` is documented with queries because it reports sync state while reconciling changed canonical files. `workspace.receive.status` is read-only. The `readOnly` and `dryRun` request flags are honored only by commands that define preview behavior.

The opt-in source-registry path routes the currently implemented targeted task writes to one TaskDB v1 source. Its unsupported operations and routing limits are listed in [Sources](sources.md).
