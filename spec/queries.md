# Queries

This is the current query catalog for the Node command path. Each command returns a JSON object; the JSON-lines envelope is described in [Protocol](protocol.md).

| Command | Main arguments | Result / behavior |
| --- | --- | --- |
| `runtime.probe` | none | Reports runtime, SQLite, WAL, and FTS5 probe results. |
| `source.list` | none | Lists configured registry sources. Without a registry, returns `{ "sources": [] }`. |
| `task.list` | filters below | Returns `tasks`, optional `contextTasks`, pre-page `total`, `limit`, `offset`, and `workspaceRevision`. |
| `task.get` | `id`; registry mode can use `ref` | Returns one task projection. |
| `category.list` | none | Categories and non-canceled task counts. |
| `tag.list` | none | Tags and non-canceled task counts. |
| `activity.list` | optional `taskId`, `limit` | Recent activity, optionally scoped to one task. |
| `workspace.info` | none | Database path, workspace ID, task counts, and workspace revision. Registry mode aggregates these fields and identifies a primary source. |
| `workspace.sync` | none | Reconciles canonical files and reports file counts, conflicts, cache generation, and last-sync counts. It can update the local cache as part of the request. |
| `workspace.conflict.list` | none | Lists unresolved canonical conflict copies. |
| `workspace.receive.status` | none | Reports whether a guarded workspace receive/adoption is pending. |
| `theme.list` | none | Lists available themes and the current selection. |

## `task.list` filters

- `status`: one status or an array; an array is OR semantics. When omitted, all statuses, including canceled, are included.
- `priority`: integer 0–4.
- `category`: a slug in single-workspace mode; the source-registry controller also accepts `{kind:"all"}`, `{kind:"slug",slug:"…"}`, or `{kind:"uncategorized"}`.
- `categoryIsNull: true`: selects uncategorized tasks in the existing single-workspace query path; it cannot be combined with a category.
- `tags`: one slug or an array. Multiple tags use AND semantics.
- `search`: trimmed substring search across title and description; SQLite's default `LIKE` behavior is case-insensitive for ASCII. The current query is capped at 200 characters.
- `unblocked: true`: excludes tasks with a non-canceled dependency.
- `includeAncestors: true`: returns filtered-out ancestors separately in `contextTasks`; they do not add to `total`.
- `sort`: `created`, `updated`, `priority`, or `manual`. Date sorts default newest first; priority defaults P0 first. Manual order keeps parent trees together.
- `direction`: `asc` or `desc`; manual order is not reversed.
- `limit`, `offset`: page selection. The default limit is 50 and the maximum is 100. Single-workspace mode clamps the range to `1..100` and offset to nonnegative; registry mode rejects out-of-range limits and negative offsets.

In registry mode, `sourceKeys` can restrict a list to registered sources. Combined ties use source key and task ID as stable tie-breakers. The registry controller's current sorting and source-local limits are described in [Sources](sources.md).

Canceled-only categories and tags are omitted from the category/tag pickers. Classification always comes from the title, not the description. See [Task model](model.md).
