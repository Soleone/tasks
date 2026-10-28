# Lenses

A lens turns the task list itself into one question, such as what was done today or what is due now. It is not a second list and not a saved filter: the same key or header count goes back, and nothing about it is remembered.

| Rule | When | Then |
| --- | --- | --- |
| `lens.view` | A lens opens | The list shows the lens's tasks in the lens's own order, with every other filter cleared. Its header count stays pressed and the count line names the lens, e.g. "3 due now". Rows work as anywhere else, and filters and sorts narrow or reorder the lens |
| `lens.parents` | A lens shows a subtask whose parent it doesn't show | The parent shows as context above it, and the lens expands it once, leaving it to you after that |
| `lens.back` | The lens's key again, clicking its count, `Escape` with no selection to clear, or Go back on an empty lens | The list returns to the view it showed before: filters, search, sort, the active task, expanded parents and scroll position. Anything changed inside the lens is dropped |
| `lens.switch` | Opening another lens while one is open | The new lens replaces it, and going back still returns to the view from before the first |
| `lens.status` | Changing the status filter in a lens | The lens ends and the new status view becomes the ordinary view, remembered as usual |
| `lens.launch` | Launching after quitting with a lens on | The lens is never remembered; the list opens on the view it set aside |
| `lens.count` | A header count's lens has nothing to show | The count is hidden, except while its lens is on |

## Due now

| Rule | When | Then |
| --- | --- | --- |
| `due.count` | An open, in-progress or paused task is due today or earlier, from any client | The header shows how many, e.g. "2 due now", in the warning color with a calendar, left of the done count |
| `due.lens` | `!`, clicking the count, or Due now in the `Ctrl/⌘+K` palette | The list shows open, in-progress and paused tasks due today or earlier, most overdue first and the same day by priority |
| `due.all-clear` | The due lens has nothing to show | The empty list reads "All clear" and offers Go back |
