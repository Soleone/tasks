# Status, undo and redo

Status keys act on the selection: the active task, or the several tasks selected with Shift or Ctrl/⌘ ([home.md](home.md#selection)).

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
| `status.feedback` | A status or priority changes | The status glyph's tooltip flashes just the new status, or just the new priority like P0, and a screen reader hears it |

## Priority and copy

| Rule | When | Then |
| --- | --- | --- |
| `priority.set` | `0`–`4` on the list | Sets the active task's priority. While the task is open or in progress, the status glyph takes the priority's color, with normal priority in neutral gray; paused, done and canceled keep their status colors. The glyph's label and hover tooltip name both |
| `copy.text` | `Ctrl/⌘+C` on the list, or Copy text in Task actions | Copies the active task's title and description followed by its `#tags`, separated by spaces, without `@category` or images |
| `attach.copy` | `Ctrl/⌘+Shift+C` on the list, Copy image in Task actions, or clicking the image badge | Copies the active task's most recently added image, whether details are shown or not, and a toast confirms it. A task without images, or whose image is missing, says so |

## Completion

Finishing work should feel like it. The reward stays quiet: a moment on the row, a count in the header, a warmer empty list. Looking back at what was done is a [lens](lenses.md) on the task list, not a second list.

| Rule | When | Then |
| --- | --- | --- |
| `done.sheen` | This client completes tasks with a status key, a glyph click or a batch | As the check draws, the glyph gets a brief sheen in the theme accent. A batch plays it as a wave down the rows. A completed row that leaves the view stays until its sheen has played. Undo, redo and changes from elsewhere never play it, and reduced motion turns it off |
| `done.today` | Any task was completed in the last 24 hours, from any client | The header shows a quiet count, e.g. "3 done today". It is hidden at zero (`lens.count`), rises with a short pop and falls quietly when an undo takes a completion back. "Today" is always the last 24 hours, with no setting |
| `done.lens` | `D`, clicking the count, or Done today in the `Ctrl/⌘+K` palette | A [lens](lenses.md) on the tasks done in the last 24 hours, most recently done first. The count line reads e.g. "3 done today". With nothing done, the empty list says so and offers to look further back |
| `done.lens-window` | `Shift+D`, clicking the count line in the lens, or Look further back in the palette | The lens looks back 7 days, then 30, then 24 hours again, and the count line says which. Outside the lens, `Shift+D` opens it at 7 days. The header count always means the last 24 hours |
| `done.completed-at` | The list is sorted by Completed | Each done row shows when it was done in a trailing column on its title line: the time today, the weekday within the week, the date before that, and the full time on hover. The column never adds a line, and other sorts don't show it |
| `done.all-clear` | The default Active view is empty and something was completed in the last 24 hours | The empty shell reads "All clear" with the day's count instead of "No active tasks" |

## Undo

| Rule | When | Then |
| --- | --- | --- |
| `undo.latest` | `Ctrl/⌘+Z`, or Undo in the toolbar (disabled when unavailable) | Undoes this client's latest change and a toast confirms it. Status and priority changes show the restored status icon or priority dot when the restored tasks share that value. A task that was active when the change was made is active again, even if it left the view before the change was saved. Pressing again walks further back. Each successful undo makes that step available to redo |
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
