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
| `copy.text` | `Ctrl/⌘+C` on the list, or Copy text in Task actions | Copies the active task's title and description followed by its `#tags`, separated by spaces, without `@category` or images |
| `attach.copy` | `Ctrl/⌘+Shift+C` on the list, Copy image in Task actions, or clicking the image badge | Copies the active task's most recently added image, whether details are shown or not, and a toast confirms it. A task without images, or whose image is missing, says so |

## Completion

Finishing work should feel like it. The reward stays quiet: a moment on the row, a count in the header, a warmer empty list.

| Rule | When | Then |
| --- | --- | --- |
| `done.sheen` | This client completes tasks with a status key, a glyph click or a batch | As the check draws, the glyph gets a brief sheen in the theme accent. A batch plays it as a wave down the rows. A completed row that leaves the view stays until its sheen has played. Undo, redo and changes from elsewhere never play it, and reduced motion turns it off |
| `done.today` | Any task was completed in the last 24 hours, from any client | The header shows a quiet count, e.g. "3 done today". It is hidden at zero, rises with a short pop and falls quietly when an undo takes a completion back. "Today" is always the last 24 hours, with no setting |
| `done.today-list` | `D`, clicking the count, or Done today in the `Ctrl/⌘+K` palette | A popover opens with every row in place and lists up to 50 of those tasks, most recent first, with when each was completed, and says how many more there are. Only the checks move, ticking in a quick wave (no motion with reduced motion). The popover is as wide as its longest title, up to the window width, so a title wraps only when the window is too narrow, to two lines before it is cut off, and shows in full on hover. It opens with focus on the list, so arrows, Page Up/Down and Home/End scroll a long one while list shortcuts stay off. Closing it returns focus to the surface that opened it. With nothing done, `D` says so instead |
| `done.all-clear` | The default Active view is empty and something was completed in the last 24 hours | The empty shell reads "All clear" with the day's count instead of "No active tasks" |

## Undo

| Rule | When | Then |
| --- | --- | --- |
| `undo.latest` | `Ctrl/⌘+Z`, or Undo in the toolbar (disabled when unavailable) | Undoes this client's latest change and a toast confirms it. Status and priority changes show the restored status icon or priority dot when the restored tasks share that value. Pressing again walks further back. Each successful undo makes that step available to redo |
| `undo.scope` | Any change | Status, capture, edit (including images), priority, parent, blocker and order changes made from this client are undoable. Changes from the CLI, agents or other devices are never offered |
| `undo.batch` | Undoing a batch | One step restores every task in it |
| `undo.depth` | History | About the last 50 changes, kept for this workspace and survives reload |
| `undo.refused` | A later change touched what the undo would restore (the same status, field, link or order), or the undo would create a cycle | Refused before anything is sent and dropped from history. The next `Ctrl/⌘+Z` tries the next older change |
| `undo.capture` | Undoing a capture | Removes the task only while it is unchanged |

## Redo

| Rule | When | Then |
| --- | --- | --- |
| `redo.latest` | `Ctrl+Y`, `Ctrl/⌘+Shift+Z`, or Redo beside Undo in the toolbar (disabled when unavailable) | Reapplies this client's most recently undone change and a toast confirms it, using the restored status icon or priority dot for status and priority changes when the restored tasks share that value. Pressing again walks forward. Each successful redo makes that step undoable again, even when the list was empty |
| `redo.scope` | Undo and redo history | Only this client's changes are offered, with the same workspace scope and batch boundaries as undo. Both stacks share the approximately 50-step limit and survive reopen |
| `redo.branch` | A new meaningful change is accepted from this client after undo | Redo history is cleared. No-ops, refused changes, navigation and refresh leave it alone. Changes from other clients are checked for conflicts, never added to this history |
| `redo.refused` | A redo would overwrite a changed affected field or order, collide with a reappeared task, or make the graph invalid | Refused before anything is sent and dropped from redo history. The next redo tries the next step |
| `redo.capture` | Redoing an undone capture | Restores the same task ID, fields, order key and timestamps only while its file is absent and the resulting graph is valid |
| `redo.text-history` | A field, editor or dialog has focus, or a toolbar key mode is active | Task undo/redo does not run. Text fields keep their own native undo/redo |
| `redo.confirmed` | An undo or redo reply is uncertain | History stays in place until the original request succeeds or is explicitly reconciled. A retry uses that same request, never a new reversal |
