# CLI and agents

There are two ways in from outside the app. Both use the same [commands](../backend/commands.md) as the app.

- **JSON lines**: send one request envelope per line on stdin, get one reply per line on stdout. This is the complete interface for agents.
- **`tasks-cli`**: friendly verbs for people and simple scripts.

## Selecting a workspace

| Rule | Then |
| --- | --- |
| `cli.explicit-root` | Every call names the Tasks home with `--home PATH`; the CLI keeps its own cache in the home's `local/`. There is no default home and no environment fallback. `--root PATH --database PATH` selects a bare folder for tests and conversion, and can't be combined with `--home` |

## Verbs

| Verb | Command |
| --- | --- |
| `list [search]` | `task.list` with `--status`, `--priority`, `--category`, `--uncategorized`, `--tag`, `--search`, `--unblocked`, `--include-ancestors`, `--sort`, `--direction`, `--limit`, `--offset` |
| `show ID` | `task.get` |
| `add TEXT...` | `task.create` with shorthand. `--title` is literal; also `--description`, `--priority`, `--parent`, `--category`, `--tag` |
| `update ID` | `task.update` with `--title`, `--text`, `--description`, `--priority`, `--category`, `--clear-category`, `--tag`, `--clear-tags` |
| `start` `pause` `complete` `reopen` `cancel` `delete` `ID` | the matching status command |
| `undo ID` | `task.status.undo` |
| `undo-operation ID` | `operation.undo` |
| `redo-operation ID` | `operation.redo`, with the completed undo's ID |
| `move ID --parent ID` or `--no-parent` | `task.move` |
| `dep-add ID DEP` / `dep-remove ID DEP` | `task.dependency.add` / `.remove` |
| `purge-canceled` | `task.purgeCanceled` |
| `activity [--task ID]` | `activity.list` |
| `categories`, `tags`, `info` | `category.list`, `tag.list`, `workspace.info` |
| `init`, `rebuild` | `workspace.init` (creating the home first), `workspace.rebuild` |
| `rebind`, `new-history` | `workspace.rebind`, `workspace.newHistory` |
| `archive DEST`, `restore SRC DEST` | `workspace.archive`, `workspace.restore` |
| `migrate DEST` | `workspace.migrate` |
| `recover OPERATION_ID` | `workspace.recovery.resume` |

Reorder, status batches and doctor are JSON lines only.

| Rule | Then |
| --- | --- |
| `cli.shorthand` | Positional `add` text is shorthand. It can't be combined with `--category` or `--tag` |
| `cli.flags-checked` | A flag that doesn't belong to the verb is a usage error |
| `cli.actor` | `--actor-kind` (`human` or `agent`, default agent) and `--actor-label` set the actor |

## Retries

| Rule | Then |
| --- | --- |
| `cli.first-call` | Without `--write-context`, `--idempotency-key` and `--expected-version`, the CLI fetches them itself |
| `cli.retry` | To retry an uncertain write, pass the original `--write-context`, `--idempotency-key` and `--expected-version`. The CLI sends the original request unchanged, so a stored receipt answers first |
| `cli.retry-report` | Before a write, stderr gets one line with the command, paths, context, key, version, actor and a `requestHash`. It never contains task text |
| `cli.request-hash` | `--request-hash HASH` refuses to send if the prepared request or selected paths differ from that hash |
| `cli.no-auto-retry` | The CLI never retries, recovers or refreshes authority on its own |

## Output

| Rule | Then |
| --- | --- |
| `cli.output` | Plain text by default. `--json` prints the result object; errors go to stderr as `{ok:false, error}` |
| `cli.exit` | Exit 0 on success, 1 for protocol or storage errors, 2 for usage errors, 3 for a stale task version |
