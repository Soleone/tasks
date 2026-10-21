# Commands

Every client, the CLI and agents use the same commands. A request is one JSON object per line (see [protocol](#envelope)).

## Envelope

```json
{"version":2,"requestId":"edit-1","writeContext":"ctx-A","command":"task.update","args":{"id":"a","expectedVersion":17,"title":"Call @alice"},"actor":{"kind":"agent","label":"release-agent"},"idempotencyKey":"edit-key"}
```

| Rule | Then |
| --- | --- |
| `envelope.fields` | Allowed fields: `version` (must be 2), `requestId`, `command`, `args`, `actor`, `idempotencyKey`, `writeContext`, `readOnly`, `dryRun`. Anything else, duplicate keys or bad JSON fail `INVALID_REQUEST` |
| `envelope.actor` | `actor.kind` is `human`, `agent` or `system`, with a non-empty label. Default: agent, cli |
| `envelope.reply` | Success is `{version, requestId, ok:true, writeContext, result}`. Failure is `{version, requestId, ok:false, error:{code, message, details?}}`. Callers branch on `code`, never on `message` |
| `envelope.task-shape` | A returned task is the 13 stored fields plus `version` (a positive integer local token) and `blockedByIds` |
| `envelope.dry-run` | `dryRun` previews without writing and without using up the idempotency key |
| `envelope.no-task-text-logs` | Default logs never contain task text |

## Write authority

| Rule | Then |
| --- | --- |
| `auth.context` | Writes and previews need the current `writeContext`, a local token tied to this folder and this cache. Missing fails `WRITE_CONTEXT_REQUIRED`, old fails `STALE_WRITE_CONTEXT` |
| `auth.key` | Executing writes need a non-empty `idempotencyKey` (`IDEMPOTENCY_REQUIRED`) |
| `auth.version` | Commands on an existing task need its current `expectedVersion` (`EXPECTED_VERSION_REQUIRED`, `STALE_TASK_VERSION`). Batch items carry their own |
| `auth.replay` | The same key with the same request returns the original result, even if the task changed since. The same key with a different request fails `IDEMPOTENCY_KEY_REUSED`. `requestId` and key order don't count; array order does |
| `auth.replay-first` | A known key is looked up before any check on the current tasks |
| `auth.noop-receipt` | A no-op stores a receipt and writes nothing |
| `auth.fresh-context` | A new or lost cache gives a new context. A cache recorded for another folder, or copied from elsewhere, fails `CACHE_FROM_ELSEWHERE` and is never wiped or adopted; `workspace.newHistory` moves it to `retired/` beside it, untouched, and starts a new context. Old keys then fail `STALE_WRITE_CONTEXT`; callers inspect and reconcile by hand, never silently retry with fresh authority |
| `auth.moved-home` | When the folder and its cache are the same files at a new path, requests fail `HOME_MOVED` until `workspace.rebind` confirms the move, which keeps the context, receipts and history. The same paths and files on a new device number (as Android's shared storage can get) keep the context without asking. Neither choice runs while the folder has unfinished work |
| `auth.rebuild` | Rebuilding the cache in place keeps the context and receipts and issues new task versions |

## Text input

`task.create` takes exactly one of `title` (literal) or `text` (shorthand). `task.update` with `text` replaces title, category and tags together. The typed text is kept so an editor can show it again exactly as written.

| Rule | Then |
| --- | --- |
| `text.markers` | Outside code, `@name` sets the category and `#name` adds a tag, where a marker follows start of text or a character other than a letter, digit, `_`, `/` or `@`, and the name starts with a letter. Names are slugs; joined markers such as `#one@two` or `@one#two` stay literal text |
| `text.code` | Text inside triple or single backticks never classifies |
| `text.escape` | `\@`, `\#` and `\\` become literal characters and never classify |
| `text.remove-span` | The marker and name are removed, and a marker between two spaces leaves one: `Review @work now` becomes `Review now`. Other spacing stays as typed |
| `text.normalize` | Category and tags are lowercased; tags are deduplicated and sorted |
| `text.one-category` | Two different categories fail `MULTIPLE_CATEGORIES` |
| `text.empty` | An empty title after removal fails `INVALID_ARGUMENT` |
| `text.literal` | With `title`, `Call @alice` is stored as written with no category |
| `text.partial-update` | Omitted fields are kept. `category: null` and `tags: []` clear |
| `text.kept` | With `text`, the trimmed input is stored as the task's `text` next to the title, category and tags it produced. With `title`, `text` is `null` |
| `text.cleared` | A change to title, category or tags without `text` sets `text` to `null`. Other changes, and setting the same values again, keep it |
| `text.stale` | Results report `text` only while it still produces the task's title, category and tags. Otherwise, as after a hand edit of the file, they report `null` |
| `text.mixed` | Mixing `text` with `title`, `category` or `tags`, or using old field names, fails `INVALID_ARGUMENT` |

## Task commands

| Command | Args | Result |
| --- | --- | --- |
| `task.create` | `title` or `text`; optional `description`, `priority`, `category`, `tags`, `parentId` | `task`, `changed`, `operationId` |
| `task.update` | `id`, `expectedVersion`; optional `title` or `text`, `description`, `priority`, `category`, `tags` | `task`, `changed`, `operationId` |
| `task.start` `pause` `complete` `reopen` `cancel` `delete` | `id`, `expectedVersion` | `task`, `changed`, `operationId` |
| `task.status.undo` | `id`, `expectedVersion` | `task`, `changed`, `operationId` |
| `task.move` | `id`, `expectedVersion`, `parentId` (or `null`) | `task`, `changed`, `operationId` |
| `task.dependency.add` / `.remove` | `id`, `expectedVersion`, `dependsOnId` | `task`, `changed`, `operationId` |
| `task.reorder` | `tasks: [{id, expectedVersion}]` in current order, one of `beforeId`, `afterId`, `first: true`, `last: true` | selected tasks, `parentId`, `changed`, `rewrittenIds`, `operationId` |
| `task.order.normalize` | `parentId`, every sibling as `tasks: [{id, expectedVersion}]` in order | sibling tasks, `parentId`, `changed`, `rewrittenIds`, `operationId` |
| `task.transitionMany` | `tasks: [{id, expectedVersion, command}]` | `tasks`, `changed`, `operationId` |
| `task.status.undoMany` | `tasks: [{id, expectedVersion}]` | `tasks`, `changed`, `operationId` |
| `operation.undo` | `operationId` of a supported forward change or completed redo | affected tasks, `changed`, `operationId`; a create undo adds `removedIds`, `recoveryLocation` |
| `operation.redo` | `operationId` of a completed `operation.undo` | affected tasks, `changed`, a new `operationId` |
| `task.purgeCanceled` | none | `purgedIds`, `changed`, `recoveryLocation` |

| Rule | Then |
| --- | --- |
| `create.defaults` | New tasks are open, P2, empty description, no category, tags, parent or dependencies unless given, and first among siblings |
| `update.no-graph` | `task.update` can't set status, links, order keys or timestamps |
| `reorder.one-scope` | All selected tasks and the anchor share one parent, the anchor isn't selected, and selected tasks are in their current order. Otherwise `INVALID_ARGUMENT` |
| `batch.all-or-nothing` | `transitionMany` and `undoMany` check every item first. One bad item fails the whole batch with no writes |

## Queries

| Command | Args | Result |
| --- | --- | --- |
| `task.get` | `id` | `task` |
| `task.list` | filters below | `tasks`, `contextTasks`, `total`, `limit`, `offset`, `workspaceRevision` |
| `category.list` / `tag.list` | none | `[{slug, taskCount}]`, counting tasks that aren't canceled |
| `activity.list` | optional `taskId`, `limit` | `[{operationId, taskId, actor, createdAt, command, before, after}]` |
| `workspace.info` | none | `state`, `schemaVersion`, `commands`, `issues`, `pendingOperationId`, `workspaceRevision` |

| Rule | Then |
| --- | --- |
| `list.filters` | `status` (any of), `tags` (all of), `priority`, `category` or `categoryIsNull`, `search`, `unblocked`, `includeAncestors`, `includeDescendants` |
| `list.search` | Case-insensitive (ASCII) substring over title and description. Trimmed and capped at 200 UTF-16 units |
| `list.sort` | `created` and `updated` default newest first, `priority` defaults P0 first, `manual` is tree order and can't be reversed. Ties break by ID bytes |
| `list.paging` | `limit` defaults to 50 and clamps to 1 to 100. `offset` clamps to 0 or more |
| `list.ancestors` | Filters never detach a child from its tree. Non-matching ancestors come back in `contextTasks` and don't count in `total` |
| `list.descendants` | `includeDescendants: true` includes ancestors and every descendant of each page task's root in `contextTasks`, excluding tasks already in the page. Unrelated trees stay out. Context doesn't change matching `total`, `limit` or `offset` |
| `list.canceled-classification` | Categories and tags used only by canceled tasks are left out of `category.list` and `tag.list` |
| `info.state` | `state` is `empty`, `ready`, `incomplete`, `unsupported` or `recovery_pending`. `commands` lists what this build supports, sorted |
| `info.refusals` | A known command this build doesn't offer fails `UNSUPPORTED_COMMAND`, an unknown one `UNKNOWN_COMMAND`. No command approximates another |

## Workspace commands

| Command | Args | Result |
| --- | --- | --- |
| `workspace.init` | none | `schemaVersion`, `changed` |
| `workspace.rebuild` | none | `taskCount`, `changed`, `workspaceRevision` (cache only) |
| `workspace.migrate` | `destinationDirectory` | completion report |
| `workspace.recovery.resume` | `operationId` | `operationId`, `outcome`, original result when available |
| `workspace.doctor.inspect` / `.plan` / `.apply` | see [sharing](../ecosystem/sharing.md#doctor) | issues, plan, repair result |

## Errors

| Code | Meaning |
| --- | --- |
| `INVALID_REQUEST` | Bad envelope or JSON |
| `UNSUPPORTED_VERSION` / `UNSUPPORTED_SCHEMA` | Wrong protocol or stored schema |
| `UNKNOWN_COMMAND` / `UNSUPPORTED_COMMAND` | Unknown, or known but not offered here |
| `INVALID_ARGUMENT` / `MULTIPLE_CATEGORIES` | Bad or mixed input, competing categories |
| `TASK_NOT_FOUND` / `INVALID_PARENT` / `INVALID_DEPENDENCY` | Missing task or bad link target |
| `PARENT_CYCLE` / `DEPENDENCY_CYCLE` / `INVALID_TRANSITION` | Forbidden link or status change |
| `EXPECTED_VERSION_REQUIRED` / `STALE_TASK_VERSION` | Missing or old task version |
| `IDEMPOTENCY_REQUIRED` / `IDEMPOTENCY_KEY_REUSED` | Missing key, or key used for a different request |
| `WRITE_CONTEXT_REQUIRED` / `STALE_WRITE_CONTEXT` | Missing or old write context |
| `INVALID_CANONICAL` / `INVALID_STORAGE` | Invalid files, or a storage failure |
| `STALE_FILE` / `STALE_SCOPE` / `ORDER_KEY_LIMIT` | Files changed under the write, or order key too long |
| `PURGE_REFERENCED` | Survivors still link to canceled tasks |
| `UNDO_UNAVAILABLE` / `OPERATION_UNAVAILABLE` | Nothing eligible to undo, or no eligible operation to redo |
| `AMBIGUOUS_LINK` / `STALE_REPAIR_PLAN` | Doctor needs a link choice, or its plan is out of date |
| `RECOVERY_PENDING` / `RECOVERY_CONFLICT` | Unfinished work blocks writes, or can't be safely finished |
| `FOLDER_IN_USE` | Another window or the CLI holds the folder's lock or cache; try again |
| `MIGRATION_INVALID_SOURCE` / `MIGRATION_CONFLICT` / `DESTINATION_NOT_EMPTY` | Bad migration source, source changed, destination occupied |
