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
| `envelope.task-shape` | A returned task is its stored fields, with optional fields at their defaults filled in, plus `version` (a positive integer local token) and `blockedByIds` |
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

`task.create` takes exactly one of `title` (literal) or `text` (shorthand). `task.update` with `text` replaces title, category, tags and due date together. The typed text is kept so an editor can show it again exactly as written.

| Rule | Then |
| --- | --- |
| `text.markers` | Outside code, `@name` sets the category and `#name` adds a tag, where a marker follows start of text or a character other than a letter, digit, `_`, `/` or `@`, and the name starts with a letter. Names are slugs; joined markers such as `#one@two` or `@one#two` stay literal text |
| `text.due` | `!word` sets the due date when the word names one, with the same start rule as other markers. Words: `today`, `tomorrow` or `tmr`, a weekday (`fri`, `friday`; the next one, never today), a count of days, weeks, months or years (`3d`, `2w`, `1m`, `1y`), a month and day (`oct31`, `october31`; this year unless it has passed) or a date (`2026-10-31`). Anything else, such as `!soon` or `Done!`, stays text |
| `text.due-fixed` | Relative words resolve against today on the device that parses them, and the stored `text` holds the date instead (`!fri` is kept as `!2026-10-23`), so it reads the same later |
| `text.one-due` | Two different due dates fail `INVALID_ARGUMENT` |
| `text.code` | Text inside triple or single backticks never classifies |
| `text.escape` | `\@`, `\#`, `\!` and `\\` become literal characters and never classify |
| `text.remove-span` | The marker and name are removed, and a marker between two spaces leaves one: `Review @work now` becomes `Review now`. Other spacing stays as typed |
| `text.normalize` | Category and tags are lowercased; tags are deduplicated and sorted |
| `text.one-category` | Two different categories fail `MULTIPLE_CATEGORIES` |
| `text.empty` | An empty title after removal fails `INVALID_ARGUMENT` |
| `text.literal` | With `title`, `Call @alice` is stored as written with no category |
| `text.partial-update` | Omitted fields are kept. `category: null`, `tags: []` and `due: null` clear |
| `text.kept` | With `text`, the trimmed input is stored as the task's `text` next to the title, category and tags it produced. With `title`, `text` is `null` |
| `text.cleared` | A change to title, category, tags or due date without `text` sets `text` to `null`. Other changes, and setting the same values again, keep it |
| `text.stale` | Results report `text` only while it still produces the task's title, category, tags and due date. Otherwise, as after a hand edit of the file, they report `null` |
| `text.mixed` | Mixing `text` with `title`, `category`, `tags` or `due`, or using old field names, fails `INVALID_ARGUMENT` |

## Task commands

| Command | Args | Result |
| --- | --- | --- |
| `task.create` | `title` or `text`; optional `description`, `priority`, `effort`, `category`, `tags`, `due`, `attachments`, `parentId`, `closedAt` | `task`, `changed`, `operationId` |
| `task.update` | `id`, `expectedVersion`; optional `title` or `text`, `description`, `priority`, `effort`, `category`, `tags`, `due`, `attachments` | `task`, `changed`, `operationId` |
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
| `task.purgeCanceled` | none | `purgedIds`, `removedAttachments`, `changed`, `recoveryLocation` |
| `task.clearDone` | `closedBefore` (a timestamp, or `null` for all), `scope` (`attachments` or `tasks`); optional `export: true` | `clearedIds`, `keptIds`, `removedAttachments`, `bytes`, `changed`, `recoveryLocation`, and `exportLocation` when exporting |

| Rule | Then |
| --- | --- |
| `create.logged` | `task.create` with `closedAt` (a timestamp, not after now) logs a task already done: it is created done at that time. A time in the future fails `INVALID_ARGUMENT` |
| `create.defaults` | New tasks are open, P2, empty description, no category, tags, parent or dependencies unless given, and first among siblings |
| `update.no-graph` | `task.update` can't set status, links, order keys or timestamps |
| `reorder.one-scope` | All selected tasks and the anchor share one parent, the anchor isn't selected, and selected tasks are in their current order. Otherwise `INVALID_ARGUMENT` |
| `batch.all-or-nothing` | `transitionMany` and `undoMany` check every item first. One bad item fails the whole batch with no writes |
| `attach.list-replace` | `attachments` replaces the whole list. Names added by the request must exist in `attachments/`; names already listed may be missing. A name that doesn't match `data.attachment-name`, a duplicate or more than 10 fail `INVALID_ARGUMENT` |

## Attachment commands

| Command | Args | Result |
| --- | --- | --- |
| `attachment.write` | `type` (`image/png`, `image/jpeg`, `image/webp` or `image/gif`), `data` (base64) | `name`, `changed` |
| `attachment.read` | `name` | `type`, `data` (base64) |

| Rule | Then |
| --- | --- |
| `attach.write` | `attachment.write` checks the size and that the bytes are the stated format, picks a new name and stores the file. Listing it on a task is a separate `task.create` or `task.update`; until then it is unlisted. Too large or not an image fails `INVALID_ARGUMENT` |
| `attach.read` | `attachment.read` returns a stored attachment's bytes. A missing file fails `ATTACHMENT_NOT_FOUND`; bytes that aren't the named format fail `INVALID_STORAGE` |

## Classification commands

Categories and tags are slugs written into each task (`data.no-labels`), so renaming one rewrites every task that carries it.

| Command | Args | Result |
| --- | --- | --- |
| `category.rename` / `tag.rename` | `from`, `to` | changed `tasks`, `changed`, `merged`, `operationId` |

| Rule | Then |
| --- | --- |
| `rename.scope` | Every task with `from` changes, whatever its status, so reopening a task never brings the old slug back. The backend finds them itself; there are no `expectedVersion`s. Both are lowercased like other classification input (`text.normalize`); one that still isn't a slug (`data.slug`) fails `INVALID_ARGUMENT` |
| `rename.merge` | Renaming onto a slug already in use merges, and `merged` is `true`. A tag rename on a task that already has `to` leaves one `to`, sorted with the rest (`text.normalize`); a category rename sets `to` |
| `rename.noop` | `from` that no task uses, or `from` equal to `to`, succeeds with `changed: false` and writes nothing |
| `rename.text` | Changed tasks get `text: null` (`text.cleared`); markers inside other fields are never rewritten. Every field but the category or tags, `text` and `version` is kept, `updatedAt` and `closedAt` included |
| `rename.atomic` | All changed tasks are written as one batch. After a crash, recovery leaves either all of them renamed or none |
| `rename.undo` | Undo and redo through `operation.undo` / `operation.redo` cover the whole rename as one step. Undo gives each task back its own earlier category or tags, so after a merge, tasks that already had `to` keep it. Refused per `undo.operation` if any of those tasks changed since |

## Queries

| Command | Args | Result |
| --- | --- | --- |
| `task.get` | `id` | `task` |
| `task.list` | filters below | `tasks`, `contextTasks`, `total`, `limit`, `offset`, `workspaceRevision` |
| `category.list` / `tag.list` | none | `[{slug, taskCount}]`, counting tasks that aren't canceled, most recently updated task first, then by slug |
| `query.batch` | `queries`: 1 to 8 of `{command, args}`, each `task.get`, `task.list`, `category.list` or `tag.list` | `results`, one per query in order |
| `activity.list` | optional `taskId`, `limit`, `since`, `from` | `[{operationId, taskId, taskIds, actor, createdAt, command, before, after}]`, newest first, at most 100. `taskIds` names every task the operation touched |
| `workspace.info` | none | `state`, `schemaVersion`, `commands`, `issues`, `pendingOperationId`, `workspaceRevision` |

| Rule | Then |
| --- | --- |
| `list.filters` | `status` (any of), `tags` (all of), `priority`, `category` or `categoryIsNull`, `excludeCategories` (none of), `search`, `unblocked`, `closedSince`, `closedBefore`, `dueBefore`, `ids` (any of), `includeAncestors`, `includeDescendants` |
| `list.closed-since` | `closedSince` is a stored-format timestamp. It matches done and canceled tasks whose `closedAt` is at or after it; active tasks never match |
| `list.closed-before` | `closedBefore` is a stored-format timestamp. It matches done and canceled tasks whose `closedAt` is before it; active tasks never match |
| `list.due-before` | `dueBefore` is a `YYYY-MM-DD` date. It matches tasks due earlier than that day, whatever their status; undated tasks never match |
| `list.ids` | `ids` is a list of task IDs. Only those tasks match, and IDs that name no task match nothing |
| `activity.from-cli` | Each client keeps its own history in the home's `local/` folder. `from: "cli"` answers from the CLI's history on this device instead of the caller's own, read-only: a home the CLI never opened answers with nothing and gains no file. `since` is a stored-format timestamp and keeps only what was recorded after it. Changes made on another device are in neither history |
| `list.search` | Case-insensitive substring over title and description, for every script's letters (`übung` finds `Übung`). Trimmed and capped at 200 UTF-16 units |
| `list.sort` | `created`, `updated` and `closed` default newest first, `priority` defaults P0 first, `effort` defaults largest first, `due` defaults soonest first, `manual` is tree order and can't be reversed. Ties break by ID bytes |
| `list.sort-closed` | `closed` orders by `closedAt`. Tasks that were never closed come last in either direction |
| `list.sort-due` | Tasks without a due date come last in either direction. Tasks due the same day go by priority, P0 first |
| `list.sort-effort` | Tasks of the same effort go by priority, P0 first |
| `list.paging` | `limit` defaults to 50 and clamps to 1 to 500. `offset` clamps to 0 or more |
| `list.ancestors` | Filters never detach a child from its tree. Non-matching ancestors come back in `contextTasks` and don't count in `total` |
| `list.descendants` | `includeDescendants: true` includes ancestors and every descendant of each page task's root in `contextTasks`, excluding tasks already in the page. Unrelated trees stay out. Context doesn't change matching `total`, `limit` or `offset` |
| `list.canceled-classification` | Categories and tags used only by canceled tasks are left out of `category.list` and `tag.list` |
| `query.batch` | All answers come from one look at the folder, so they agree with each other and the folder is walked once. If any query fails, the whole batch fails with that query's error |
| `info.state` | `state` is `empty`, `ready`, `incomplete`, `unsupported` or `recovery_pending`. `commands` lists what this build supports, sorted |
| `info.refusals` | A known command this build doesn't offer fails `UNSUPPORTED_COMMAND`, an unknown one `UNKNOWN_COMMAND`. No command approximates another |

## Workspace commands

| Command | Args | Result |
| --- | --- | --- |
| `workspace.init` | none | `schemaVersion`, `changed` |
| `workspace.rebuild` | none | `taskCount`, `changed`, `workspaceRevision` (cache only) |
| `workspace.recovery.resume` | `operationId` | `operationId`, `outcome`, original result when available |
| `workspace.export` | optional `download: true` | `exportLocation` and `files`, or `name`, `data` and `files` for a download |
| `workspace.doctor.inspect` / `.plan` / `.apply` | see [sharing](../ecosystem/sharing.md#doctor) | issues, plan, repair result |

| Rule | Then |
| --- | --- |
| `export.workspace` | `workspace.export` writes `tasks-<date>-<time>.zip` to the home's `exports/`: every file under the sync folder at its path below `sync/`, uncompressed, so unpacking gives the folder back. Syncthing's own entries (`.st*` and half-received files) stay out. It holds the writer lock while reading, changes nothing in the workspace and so answers a read-only request too. A bare `--root` folder refuses with `INVALID_ARGUMENT`. With `download: true` it answers the zip's file name and its bytes as base64 instead of a path, and leaves no file in `exports/`: the way out of a home kept in a browser. There is no restore command yet |

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
| `ATTACHMENT_NOT_FOUND` | The attachment's file isn't in this folder (yet) |
| `UNDO_UNAVAILABLE` / `OPERATION_UNAVAILABLE` | Nothing eligible to undo, or no eligible operation to redo |
| `AMBIGUOUS_LINK` / `STALE_REPAIR_PLAN` | Doctor needs a link choice, or its plan is out of date |
| `RECOVERY_PENDING` / `RECOVERY_CONFLICT` | Unfinished work blocks writes, or can't be safely finished |
| `FOLDER_IN_USE` | Another window or the CLI holds the folder's lock or cache; try again |
