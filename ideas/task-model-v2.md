# TaskDB v2 data model proposal

**Status:** Working design, not implemented behavior. The current v1 model remains authoritative in the [system specification](../spec/model.md). See the separate [v2 behavior proposal](task-behavior-v2.md) for lifecycle and timestamp mutation rules, and the [Syncthing sync and ordering note](syncthing-sync-ordering.md) for replicated-file concerns.

## Scope

This note defines the candidate canonical data shape and the meaning of its fields. It does not define UI interactions, command behavior, controller routing, or platform-specific storage mechanics.

## Workspace manifest

The selected directory is the collection boundary. The proposed root manifest has one field; version 2 is provisional.

```json
{
  "schemaVersion": 2
}
```

Omit `format` and `workspaceId`. Do not repeat the schema version or a record-type discriminator on task files.

## Candidate task record

Task records stay flat. The containing path establishes their role, so they need no separate `type` field.

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
  "orderKey": "a0",
  "createdAt": "2026-09-08T20:51:04.113Z",
  "updatedAt": "2026-09-08T20:51:04.113Z",
  "closedAt": null
}
```

The `orderKey` value and exact encoding are illustrative, not a locked algorithm.

| Field | Proposed meaning |
| --- | --- |
| `description` | Markdown content; replaces `descriptionMarkdown`. |
| `status` | Existing task states remain the baseline: `open`, `in_progress`, `paused`, `done`, and `canceled`. |
| `category` | One lowercase value or `null`. |
| `tags` | A list of lowercase values. |
| `closedAt` | Timestamp associated with the current terminal state, `done` or `canceled`. Its mutation rules are in the [behavior proposal](task-behavior-v2.md). |
| `updatedAt` | Timestamp whose proposed meaning and update triggers are defined in the [behavior proposal](task-behavior-v2.md). |
| `orderKey` | Leading candidate for sparse per-task manual ordering. See the [sync and ordering note](syncthing-sync-ordering.md). |

Keep `@category` and `#tag` as input or presentation syntax, not markers stored in task titles.

## Excluded from canonical task files

- No task `type` or per-task schema version.
- No `sync` block, including `revision`, writer identity, `basedOnHash`, or `contentHash`.
- No device-local optimistic version or observed-file hash. Those remain local cache/sync state, as described in the [sync and ordering note](syncthing-sync-ordering.md).

## Open data questions

- Exact category/tag input grammar, escaping, canonical tag order, and CLI/import compatibility.
- Exact fractional-key algorithm, comparison rules, and v1 order migration.
- Final v1-to-v2 compatibility/export contract and the version number.
