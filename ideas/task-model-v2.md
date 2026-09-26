# Task model v2 direction

**Status:** Working design notes based on decisions so far. This is not implemented behavior. The current v1 model remains in the [system specification](../spec/model.md).

## Proposed shape

The workspace manifest identifies and versions the whole TaskDB workspace. Its version applies to every task and order file in that workspace.

`workspace.json`:

```json
{
  "format": "taskdb",
  "formatVersion": 2,
  "workspaceId": "workspace-id"
}
```

The example uses `2` as the next version number; that number is not yet locked.

A task file stays a flat task object. The path under `tasks/` establishes that it is a task, so it needs no separate record-type field. `workspaceId` and format version are not repeated on every task. Synchronization data remains grouped separately from task data for now:

```json
{
  "id": "task-id",
  "title": "Review release",
  "description": "",
  "status": "open",
  "priority": 2,
  "category": "planning",
  "tags": ["product"],
  "parentId": null,
  "dependencyIds": [],
  "createdAt": "2026-09-08T20:51:04.113Z",
  "updatedAt": "2026-09-08T20:51:04.113Z",
  "closedAt": null,
  "sync": {
    "revision": 1,
    "modifiedBy": "laptop",
    "basedOnHash": null,
    "contentHash": "<sha256>"
  }
}
```

The core `Task` is the task fields without `sync`. A portable or in-memory task can omit synchronization data; a canonical TaskDB task file includes it. Workspace format and identity live in the workspace manifest. Order records remain separate under `order/` and use the format version declared by the workspace.

## Decisions captured so far

- `description` is a Markdown string; Markdown is a content rule, not part of the field name.
- `category` is either one lowercase value or `null`. `tags` is a list of lowercase values. Inputs compare case-insensitively and are normalized to lowercase when stored. No separate display labels are stored.
- `@category` and `#tag` remain UI input/presentation syntax. The UI can style them inline, but the saved title is plain title text and the values are stored in their own fields.
- `closedAt` replaces `completedAt` and `canceledAt`. It is set when entering `done` or `canceled`, and cleared when reopened. `status` tells which terminal state the timestamp refers to.
- There is one format version per workspace, not a schema version per task. `workspaceId` is stored once in the manifest; task IDs and relationships are scoped to that workspace.
- Keep per-record `sync.revision` for now. Android currently uses it as its optimistic task version; Node uses a separate local version. It does not choose a winner when devices conflict.

A configured `sourceKey` remains a local route to a workspace, not a field on each task. At a boundary that combines workspaces, identity can include both `workspaceId` and task `id`.

## Still open

- Whether `sync.contentHash` includes the workspace identity after `workspaceId` moves to the manifest, or hashes only the task file content.
- The long-term sync contract. Revision is currently useful for Android stale-write checks, but it is not a global clock or a conflict-resolution rule. Hash ancestry and conflict behavior need a deliberate contract.
- The exact input-token grammar, escaping, and compatibility behavior for CLI/imports when `@category` and `#tags` become UI shorthand rather than stored title text.
- Whether tags have a canonical serialized order. They are set-like, but the storage rule is not decided.
- The v1 migration and compatibility/export behavior.
