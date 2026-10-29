# CLI and agents

There are two ways in from outside the app, both through `tasks-cli`, the same executable the desktop app runs as its backend. Both use the same [commands](../backend/commands.md) as the app.

- **JSON lines** (`tasks-cli --stdio`): send one request envelope per line on stdin, get one reply per line on stdout. This is the complete interface for agents.
- **Verbs** (`tasks-cli VERB`): friendly verbs for people and simple scripts.

## Selecting a workspace

| Rule | Then |
| --- | --- |
| `cli.explicit-root` | Every call names the Tasks home with `--home PATH`; the CLI keeps its own cache in the home's `local/`. There is no default home and no environment fallback. `--root PATH --database PATH` selects a bare folder for tests and conversion, and can't be combined with `--home` |

## Verbs

| Verb | Command |
| --- | --- |
| `list [search]` | `task.list` with `--status`, `--priority`, `--category`, `--uncategorized`, `--tag`, `--search`, `--unblocked`, `--include-ancestors`, `--sort` (including `effort`, `due` and `closed`), `--direction`, `--limit`, `--offset` |
| `show ID` | `task.get`, with each attachment's absolute path |
| `add TEXT...` | `task.create` with shorthand. `--title` is literal; also `--description`, `--priority`, `--effort`, `--parent`, `--category`, `--tag`, `--due` |
| `update ID` | `task.update` with `--title`, `--text`, `--description`, `--priority`, `--effort`, `--category`, `--clear-category`, `--tag`, `--clear-tags`, `--due`, `--clear-due` |
| `start` `pause` `complete` `reopen` `cancel` `delete` `ID` | the matching status command |
| `undo ID` | `task.status.undo` |
| `undo-operation ID` | `operation.undo` |
| `redo-operation ID` | `operation.redo`, with the completed undo's ID |
| `move ID --parent ID` or `--no-parent` | `task.move` |
| `dep-add ID DEP` / `dep-remove ID DEP` | `task.dependency.add` / `.remove` |
| `attach ID FILE` | `attachment.write` with the image file, then `task.update` listing it after the existing ones |
| `purge-canceled` | `task.purgeCanceled` |
| `activity [--task ID]` | `activity.list` |
| `categories`, `tags`, `info` | `category.list`, `tag.list`, `workspace.info` |
| `init`, `rebuild` | `workspace.init` (creating the home first), `workspace.rebuild` |
| `rebind`, `new-history` | `workspace.rebind`, `workspace.newHistory` |
| `recover OPERATION_ID` | `workspace.recovery.resume` |

Reorder, status batches, doctor, removing attachments and deleting done tasks are JSON lines only.

| Rule | Then |
| --- | --- |
| `cli.shorthand` | Positional `add` text is shorthand. It can't be combined with `--category`, `--tag` or `--due` |
| `cli.due` | `--due` takes any word `!` accepts (see `text.due`) and sends the date it names today. A word that names no date is a usage error |
| `cli.flags-checked` | A flag that doesn't belong to the verb is a usage error |
| `cli.attachment-paths` | `show` prints each attachment as an absolute path into the home's `sync/attachments/`, so agents can open the image. A missing file is marked missing |
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
