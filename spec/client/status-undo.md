# Status, undo and redo

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
| `status.pause` | `P`, or Pause/resume in Task actions | Pauses or resumes per the table, through the same commands as the palette entry |
| `status.cancel` | `Delete` | The task is canceled at once. It is not erased |
| `status.batch` | A status key with several tasks selected | One batch. If any task is ineligible or changed elsewhere, nothing changes and the app says why |
| `status.batch-pause` | `P` with done or canceled tasks in the selection | They are skipped; the rest pause or resume |
| `status.immediate` | A status or priority key on one task | The row shows the change at once and saves it behind the scenes. Repeated keys apply in order |
| `status.stale` | The task changed elsewhere since it was shown | Nothing is saved, the row goes back, and the app says to refresh and try again |
| `status.feedback` | A status changes | The row confirms it briefly and a screen reader hears the new status |

## Priority and copy

| Rule | When | Then |
| --- | --- | --- |
| `priority.set` | `0`–`4` on the list | Sets the active task's priority. The row shows it as a colored dot with a label and tooltip |
| `copy.text` | `Ctrl/⌘+C` on the list, or Copy text in Task actions | Copies the active task's title and description, without `@category` or `#tags` |

## Undo

| Rule | When | Then |
| --- | --- | --- |
| `undo.latest` | `Ctrl/⌘+Z`, or Undo in the toolbar (disabled when unavailable) | Undoes this client's latest change and a toast confirms it. Pressing again walks further back. Each successful undo makes that step available to redo |
| `undo.scope` | Any change | Status, capture, edit, priority, parent, blocker and order changes made from this client are undoable. Changes from the CLI, agents or other devices are never offered |
| `undo.batch` | Undoing a batch | One step restores every task in it |
| `undo.depth` | History | About the last 50 changes, kept for this workspace and survives reload |
| `undo.refused` | A later change touched what the undo would restore (the same status, field, link or order), or the undo would create a cycle | Refused before anything is sent and dropped from history. The next `Ctrl/⌘+Z` tries the next older change |
| `undo.capture` | Undoing a capture | Removes the task only while it is unchanged |

## Redo

| Rule | When | Then |
| --- | --- | --- |
| `redo.latest` | `Ctrl+Y`, `Ctrl/⌘+Shift+Z`, or Redo beside Undo in the toolbar (disabled when unavailable) | Reapplies this client's most recently undone change and a toast confirms it. Pressing again walks forward. Each successful redo makes that step undoable again, even when the list was empty |
| `redo.scope` | Undo and redo history | Only this client's changes are offered, with the same workspace scope and batch boundaries as undo. Both stacks share the approximately 50-step limit and survive reopen |
| `redo.branch` | A new meaningful change is accepted from this client after undo | Redo history is cleared. No-ops, refused changes, navigation and refresh leave it alone. Changes from other clients are checked for conflicts, never added to this history |
| `redo.refused` | A redo would overwrite a changed affected field or order, collide with a reappeared task, or make the graph invalid | Refused before anything is sent and dropped from redo history. The next redo tries the next step |
| `redo.capture` | Redoing an undone capture | Restores the same task ID, fields, order key and timestamps only while its file is absent and the resulting graph is valid |
| `redo.text-history` | A field, editor or dialog has focus, or a toolbar key mode is active | Task undo/redo does not run. Text fields keep their own native undo/redo |
| `redo.confirmed` | An undo or redo reply is uncertain | History stays in place until the original request succeeds or is explicitly reconciled. A retry uses that same request, never a new reversal |
