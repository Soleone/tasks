# Task model

This document describes the current TaskDB v1 canonical task record and the richer record returned by the command API. They are different shapes.

## Canonical task file

Each durable task is one JSON object in `sync/tasks/<id>.json`:

```json
{
  "format": "tasks.task",
  "formatVersion": 1,
  "workspaceId": "workspace-id",
  "id": "task-id",
  "title": "Review release @planning #product",
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
    "contentHash": "<sha256>"
  }
}
```

| Field | Current meaning |
| --- | --- |
| `workspaceId`, `id` | The task is identified within its canonical workspace. The task ID must match its filename. |
| `title` | Nonempty task text. It is also the source of category and tag classification. |
| `descriptionMarkdown` | Markdown description, empty by default. |
| `status` | `open`, `in_progress`, `paused`, `done`, or `canceled`. |
| `priority` | Integer 0–4. 0 is highest; new tasks default to 2. |
| `parentId` | Nullable ID of a parent in the same workspace. |
| `dependencyIds` | IDs of tasks this task depends on, in the same workspace. |
| `createdAt`, `updatedAt` | ISO timestamps maintained by task mutations. |
| `completedAt`, `canceledAt` | Nullable timestamps. The corresponding timestamp is populated for `done` or `canceled`, respectively. |
| `sync` | File revision, writer label, prior-content hash, and current-content hash. See [Storage](storage.md). |

The canonical task does not store a source key, category, tags, SQLite version, or sibling position. For now, a task's source is the workspace that contains it; the optional `sourceKey` is controller routing metadata, not a field written into the task. Classification is derived and version/order are local.

## Classification and relationships

Classification is derived from the **title only**. A token is `@` or `#` followed by `[A-Za-z][A-Za-z0-9_-]*` with a word boundary. It is recognized at the title start or after a character other than an ASCII letter, digit, `_`, `/`, or `@`. Tokens inside inline or fenced code are ignored. Slugs are lowercase; the parser keeps the first spelling for repeated tokens in a title. Persisted categories and tags are workspace-level dictionaries keyed by slug, so the API uses the stored label for that slug rather than storing a label per task. Tags in a `TaskRecord` are sorted by slug. A task may have only one distinct category; a second distinct category is rejected.

Parent and dependency IDs are workspace-local. Parent and dependency cycles are rejected. A canceled task cannot be selected as a new parent or dependency target. A canceled dependency that was already linked remains for history, but does not block readiness. Sibling order is stored separately by parent scope in order files.

## Command API task record

Task queries return a projection with these fields:

```text
id, title, descriptionMarkdown, status, priority,
category, tags, parentId, dependencyIds, blockedByIds,
version, createdAt, updatedAt, completedAt, canceledAt
```

- `category` is a `{slug,label}` object or `null`; `tags` is an array of those objects.
- `blockedByIds` contains current non-canceled blockers. `dependencyIds` retains all direct links.
- `version` is a local optimistic-write token. It is not written to the canonical file and may change after rebuild or restore.
- In the opt-in Node source-registry path, a projection may also contain `ref: {sourceKey, taskId}`. This is controller metadata, not part of the v1 canonical record. See [Sources](sources.md).

The readable `workspace.exportTasks` output is a separate export shape, documented in [Storage](storage.md).
