# Status and undo

Status keys act on the selection, or on the active task when nothing else is selected.

## Status

| From | `Space` | `Shift+Space` | `P` |
| --- | --- | --- | --- |
| open | in progress | done | paused |
| in progress | done | open | paused |
| paused | done | in progress | in progress |
| done | open | in progress | refused: reopen first |
| canceled | open | open | refused: reopen first |

| Rule | When | Then |
| --- | --- | --- |
| `status.forward` | `Space` | Moves to the next status in the table |
| `status.back` | `Shift+Space` | Moves to the previous status in the table |
| `status.pause` | `P` | Pauses or resumes per the table, through the same commands as the palette entry |
| `status.cancel` | `Delete` | The task is canceled at once. It is not erased |
| `status.batch` | A status key with several tasks selected | One batch. If any task is ineligible or changed elsewhere, nothing changes and the app says why |
| `status.batch-pause` | `P` with done or canceled tasks in the selection | They are skipped; the rest pause or resume |
| `status.stale` | The task changed elsewhere since it was shown | Nothing changes. The app says to refresh and try again |
| `status.feedback` | A status changes | The row confirms it briefly and a screen reader hears the new status |

## Priority and copy

| Rule | When | Then |
| --- | --- | --- |
| `priority.set` | `0`–`4` on the list | Sets the active task's priority. The row shows it as a colored dot with a label and tooltip |
| `copy.text` | `Ctrl/⌘+C` on the list | Copies the active task's title and description, without `@category` or `#tags` |

## Undo

| Rule | When | Then |
| --- | --- | --- |
| `undo.latest` | `Ctrl/⌘+Z` | Undoes this client's latest change and a toast confirms it. Pressing again walks further back. There is no redo |
| `undo.scope` | Any change | Status, capture, edit, priority, parent, blocker and order changes made from this client are undoable. Changes from the CLI, agents or other devices are never offered |
| `undo.batch` | Undoing a batch | One step restores every task in it |
| `undo.depth` | History | About the last 50 changes, kept for this workspace and survives reload |
| `undo.refused` | A later change touched what the undo would restore (the same status, field, link or order), or the undo would create a cycle | Refused before anything is sent and dropped from history. The next `Ctrl/⌘+Z` tries the next older change |
| `undo.capture` | Undoing a capture | Removes the task only while it is unchanged |
