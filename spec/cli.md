# Command-line interface

**Legacy default (implemented; removed at `dvs`).** Sections linked from [V2 protocol](v2/protocol.md#queries-and-cli) are inherited by the replacement until consolidation.

`tasks-cli` is the friendly shell interface for the shared Node command path. It translates verbs and flags to protocol commands; it does not define a second task model or write the database directly. Raw protocol envelopes are documented in [Protocol](protocol.md).

## Commands

| CLI command | Protocol command(s) | Purpose |
| --- | --- | --- |
| `list` | `task.list` | Filter and page tasks. |
| `show <id>` | `task.get` | Read one task. |
| `add <title...>` | `task.create` | Create a task. |
| `update <id>` | `task.update` | Partially edit title, description, or priority. |
| `start`, `pause`, `complete`, `reopen`, `cancel`, `delete` | corresponding `task.*` commands | Change status; `delete` is the legacy cancel alias. |
| `purge-canceled` | `task.purgeCanceled` | Permanently remove canceled tasks. |
| `undo <id>` | `task.status.undo` | Undo the latest status transition. |
| `undo-operation <operation-id>` | `operation.undo` | Undo an eligible operation group. |
| `move <id>` | `task.move` | Set or remove a parent. |
| `dep-add`, `dep-remove` | `task.dependency.add`, `.remove` | Add or remove a dependency. |
| `activity` | `activity.list` | Read task activity. |
| `categories`, `tags` | `category.list`, `tag.list` | Read classification values and counts. |
| `info` | `workspace.info` | Show workspace paths and counts. |
| `sources` | `source.list` | Show registered sources; empty when no registry is set. |

The CLI does not currently expose every protocol command. For example, batch status, reorder, theme, backup/restore, and conflict operations are available through other command surfaces, not as `tasks-cli` verbs.

## Options and output

Global options include `--database`, `--source-key`, `--json`, `--dry-run`, `--idempotency-key`, `--expected-version`, `--actor-kind`, and `--actor-label`. List-specific options cover status, priority, category, tag, search, limit, offset, sort, direction, and unblocked state.

Without `--json`, results are human-readable. With `--json`, the CLI prints the command result object or `{ok:false,error:{code,message}}`. The JSON-lines sidecar instead wraps results in the versioned request/response envelope.

For versioned CLI writes, the client normally reads the task first to obtain `expectedVersion`. Use `--expected-version` only when the caller already has the current token. Reuse the same `--idempotency-key` after an uncertain result. Exit code 3 indicates a stale task version; see `tasks-cli --help` for all current flags and exit codes.

`--source-key` and `sources` use the opt-in registry described in [Sources](sources.md). Without a registry, existing CLI commands continue to use the single resolved workspace.
