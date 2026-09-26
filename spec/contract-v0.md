# Combined-source behavior contract (v0)

**Status:** Frozen for the first controller prototype after the Stage 2 conformance gate passed. This is the TaskDB combined-source contract, not a deployed protocol version. The existing JSON-lines protocol remains version 1. Stage 3 now implements an opt-in local registry for TaskDB v1 roots and a first slice of combined reads and targeted writes.

The v0 contract is deliberately a small semantic layer around existing task behavior. It does not redefine the v1 files or require every source to support every operation.

## Task identity and projection

A task in a combined client is identified by the pair:

```json
{"sourceKey":"personal","taskId":"task-id-from-that-source"}
```

This object is the `TaskRef`. `sourceKey` is an opaque, stable key in the client's source registry. It is not a path, a category, or a globally meaningful ID. `taskId` is the identifier used by the source. Task IDs may collide between sources, so combined-client comparisons and writes use the whole `TaskRef`. The normalized task projection carries a `ref`; its existing `id` field, if present for compatibility, remains source-local. `task.get`, `task.update`, status changes, moves, dependency changes, and reorder items target `ref` in v0. Existing v1 requests continue using `id`.

A create accepts an optional `sourceKey`; if omitted, it uses the configured default source. If there is no usable default, the controller returns `SOURCE_REQUIRED`; it must not guess. Source keys and projected records do not get written into TaskDB v1 canonical task files.

Statuses are exactly `open`, `in_progress`, `paused`, `done`, and `canceled`. `done` and `canceled` are distinct states and must not be collapsed. Priorities are integers P0 through P4, where P0 is highest and P2 is the default. A source that cannot preserve a status or priority reports that limitation and must not silently coerce it.

Category and tags are derived from the task title, not the description. A token begins with `@` or `#`, followed by an ASCII letter and then ASCII letters, digits, `_`, or `-`; the token must end at a word boundary. A token is recognized only at the start of the title or after a character other than an ASCII letter, digit, `_`, `/`, or `@`. Tokens inside inline or fenced code are ignored. Slugs are lower-case; labels retain the entered spelling. A task has at most one distinct `@category`; repeated spellings that normalize to the same slug are one category, while two distinct categories fail with `MULTIPLE_CATEGORIES`. Tags are deduplicated by lowercase slug and retain the first entered label. A title change recalculates both fields.

## List queries

In the opted-in combined-source profile, `task.list` filters across all configured sources by default. An optional nonempty, duplicate-free `sourceKeys` array narrows it to those registered sources; an unknown key returns `SOURCE_NOT_FOUND`. Category selection is a virtual query, not a persisted task value:

| `args.category` | Result |
| --- | --- |
| Omitted or `{"kind":"all"}` | Tasks in every configured source, with or without a category. |
| `{"kind":"slug","slug":"planning"}` | Tasks whose category slug is `planning`, across sources. |
| `{"kind":"uncategorized"}` | Tasks with no category, across sources. |

For example, `{"command":"task.list","args":{"category":{"kind":"uncategorized"}}}` selects the virtual Uncategorized view.

The current v1 `task.list` remains unchanged: omitted `category` means no category restriction, and a string `category` filters to that slug. It does not expose the distinct virtual Uncategorized selection.

Other filters retain their v1 meaning: statuses are an OR set, multiple tags use AND semantics, and title/description search is independent of category. `unblocked: true` excludes tasks with a non-canceled dependency; a canceled dependency remains linked but does not block. A combined query filters before pagination; `total` is the number of matches before the page is cut. `limit` is 1–100 (default 50), and `offset` is a nonnegative integer (default 0). Sort fields are `created`, `updated`, `priority`, and `manual`; date `desc` means newest first, and priority `desc` means P0 first. For cross-source ties, use `(sourceKey, taskId)` ascending as the stable final tie-break. `manual` preserves each source's sibling-tree order and orders source groups by `sourceKey` ascending; direction does not reverse manual order. No relation or sibling order crosses source boundaries.

## Relationships and source-local order

Parent and dependency targets belong to the same source as the task. A normalized task's `parentId` and `dependencyIds` resolve only within its `ref.sourceKey`; they are not globally unique references. Parent and dependency cycles are rejected with `PARENT_CYCLE` and `DEPENDENCY_CYCLE`. A canceled task cannot be newly selected as a parent or blocker. Existing dependency links remain visible when a blocker is canceled, but that canceled task no longer blocks readiness.

Status commands keep the TaskDB v1 transition rules: `start` sets `in_progress` from `open`, `in_progress`, `paused`, or `done`; `pause` sets `paused` from `open`, `in_progress`, or `paused`; `complete` sets `done` from `open`, `in_progress`, `paused`, or `done`; `reopen` sets `open` from any status; and `cancel` sets `canceled` from `open`, `in_progress`, `paused`, or `canceled`. Other transitions fail with `INVALID_TRANSITION`. A transition to the current status is a no-op and does not advance the task version. The legacy v1 `task.delete` command also cancels and can cancel a `done` task; it remains a v1 compatibility behavior, not a separate v0 status.

Sibling order is durable within each source and parent scope. New tasks enter first in their sibling scope. Reorder requests cannot span sources or parent scopes. A source that does not support hierarchy, dependencies, or reorder reports those capabilities as unavailable and rejects the operation rather than dropping the request.

## Writes, actor, version, and retry

An actor has `kind` (`human`, `agent`, or `system`) and a nonempty `label`. A mutation includes an idempotency key and the source-issued version precondition for every existing task it changes. The version is source-local and opaque to a combined client: echo it unchanged as `expectedVersion`, and never compare versions across sources. TaskDB v1 uses a positive integer. A cache rebuild or restore can invalidate old v1 versions; a version is not a canonical file revision or content hash.

A successful retry with the same source, command, arguments, actor, and idempotency key returns the recorded result instead of applying the mutation twice. Reuse of a key for a different request is `IDEMPOTENCY_KEY_REUSED`; a missing required key is `IDEMPOTENCY_REQUIRED`. A stale precondition is `STALE_TASK_VERSION`; re-read and resolve rather than retrying with a new version. Receipts are local cache state, not canonical v1 task files, and are not guaranteed to survive cache loss.

Legacy v1 JSON-lines requests may omit `actor`, in which case the current parser supplies `{kind:"agent",label:"cli"}`. New combined-source clients send an explicit actor. The JSON-lines envelope's `requestId` correlates one response and is not an idempotency key.

## Local source registry

The combined profile is explicitly enabled for a process with `TASKS_SOURCE_REGISTRY_PATH` pointing to a local JSON file. With the variable absent or empty, the existing v1 single-workspace path is unchanged. The registry is client configuration, not canonical task data, and its contents never enter v1 task records.

A version-1 registry has this shape:

```json
{
  "format": "tasks.source-registry",
  "formatVersion": 1,
  "defaultSourceKey": "personal",
  "sources": [
    {
      "key": "personal",
      "label": "Personal",
      "databasePath": "./personal/tasks.db",
      "syncRoot": "./personal/sync"
    }
  ]
}
```

There must be 1–32 sources. Keys are unique ASCII letters/digits plus `.`, `_`, or `-`; labels are nonempty. `databasePath` and `syncRoot` resolve relative to the registry file. `syncRoot` is optional and defaults to a `sync/` directory beside that source's database. `defaultSourceKey` is optional, but if present must identify a registered source. Repeated database paths or canonical roots, and distinct roots with the same canonical `workspaceId`, fail with `DUPLICATE_SOURCE_MOUNT` rather than appearing twice.

`tasks-cli sources` lists configured sources (an empty list when no registry is configured); the legacy v1 single-workspace commands remain unchanged without a registry. `tasks-cli --source-key KEY` narrows `list` or targets a single-source operation; combined JSON list records include both the compatibility `id` and authoritative `ref`. In multi-source mode, an existing-task write without a ref or explicit source key fails with `SOURCE_REQUIRED`; a create without a default or explicit `sourceKey` also fails. `task.list` aggregates by default and supports `sourceKeys` plus the category selection described above. `source.list`, `workspace.info`, `workspace.sync`, category and tag lists aggregate over mounted TaskDB sources. Aggregate `workspace.info.databasePath` and `primarySourceKey` identify the configured default source, or the first source if no default exists; `sourceRegistryPath` identifies the local registry file.

The first implementation slice supports combined list pagination, categories, tags, task get/create, and ref-routed update/status/delete/move/dependency operations. Bulk operations and registry-enabled first-party UI routing are not yet complete. The adapter reports `reorder: false` until v0 TaskRef reorder validation is implemented; it must not imply that operation is supported just because the underlying v1 workspace can reorder by local IDs.

## Source capabilities

`source.list` returns `{"sources":[{"key":"personal","label":"Personal","capabilities":{"task":{"list":true,"get":true,"create":true,"update":true,"complete":true,"reopen":true,"start":true,"pause":true,"cancel":true,"parent":true,"dependencies":true,"reorder":true}}}]}`. V0 requires ordinary task sources to report `list`, `get`, `create`, `update`, `complete`, and `reopen` as `true`. `start`, `pause`, `cancel`, `parent`, `dependencies`, and `reorder` are optional and each is reported as an explicit boolean. A missing source is `SOURCE_NOT_FOUND`, and a known unsupported operation is `CAPABILITY_UNSUPPORTED` with the source and operation identified. A source that cannot provide the required read/write path is not presented as a normal writable task source.

A capability is a statement about that source, not a promise that every mounted source supports the full TaskDB command surface. Storage maintenance, backups, conflict resolution, undo, and export remain source-specific until separately defined. Unsupported operations must never silently return success.

## Compatibility and storage versions

The combined-source semantics are selected by an explicitly configured registry/profile; with no registry, the current v1 single-workspace command path remains unchanged. The existing v1 JSON-lines envelope stays `version: 1`; `tasks.workspace`, `tasks.task`, and `tasks.sibling-order` canonical files stay `formatVersion: 1`. `workspace.export` snapshots are format version 1, while `workspace.exportTasks` uses `tasks.tasks-export` format version 2; these remain distinct formats. This v0 semantic contract does not add a source field to v1 files or change their hashes, IDs, statuses, order, recovery, or conflict behavior. Old v1 clients continue to read and write a single v1 workspace through the existing command path.

A v1 root containing task or order records without `workspace.json` is incomplete and fails with `INVALID_CANONICAL`; it must not be assigned a new identity automatically. Conflicting canonical copies are retained and reported for explicit resolution, never silently selected or deleted.

## Stable errors and platform limits

Clients branch on `error.code`, not the human-readable `message`. The v0 controller uses stable codes including `INVALID_REQUEST`, `UNSUPPORTED_VERSION`, `UNKNOWN_COMMAND`, `INVALID_ARGUMENT`, `INVALID_SOURCE_REGISTRY`, `DUPLICATE_SOURCE_MOUNT`, `SOURCE_REGISTRY_REQUIRED`, `INVALID_CANONICAL`, `TASK_NOT_FOUND`, `SOURCE_REQUIRED`, `SOURCE_NOT_FOUND`, `CAPABILITY_UNSUPPORTED`, `EXPECTED_VERSION_REQUIRED`, `STALE_TASK_VERSION`, `IDEMPOTENCY_REQUIRED`, `IDEMPOTENCY_KEY_REUSED`, `MULTIPLE_CATEGORIES`, `INVALID_TRANSITION`, `INVALID_PARENT`, `PARENT_CYCLE`, `INVALID_DEPENDENCY`, and `DEPENDENCY_CYCLE`. A versioned platform surface may also define a stable platform-specific unsupported code; it still must reject unsupported work explicitly.

Android remains a single-workspace v1 implementation. It does not implement source references or the virtual Uncategorized query. Its `task.update` requires both `title` and `descriptionMarkdown`, while Node accepts partial updates; the portable contract must not promise partial-update parity. Android's generic unsupported-command response is `ANDROID_COMMAND_UNSUPPORTED`; conflict resolution reports `CONFLICT_RESOLUTION_UNSUPPORTED`. Neither code implies that browser or emulator checks prove native desktop acceptance.

## Conformance status

`scripts/taskdbConformance.test.mjs` exercises the existing v1 sidecar and CLI through disposable fixture copies, and now exercises two distinct v1 roots, source-scoped list references, targeted protocol/CLI writes, and duplicate-workspace rejection. It does not claim registry-enabled first-party UI support or native desktop acceptance. `scripts/platformParity.test.mjs` covers only behavior actually exercised by the Android command engine. Native M1 obligations remain open in [the audit](../docs/taskdb-audit.md); the owner re-scoped Stage 3 implementation to WSL scratch data, which does not satisfy those native obligations.
