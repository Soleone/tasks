# Lenses

A lens turns the task list itself into one question, such as what was done today or what is due now. It is not a second list and not a saved filter: the same key or header count goes back, and nothing about it is remembered.

| Rule | When | Then |
| --- | --- | --- |
| `lens.view` | A lens opens | The list shows the lens's tasks in the lens's own order, with every other filter cleared. Its header count stays pressed and the count line names the lens, e.g. "3 due now". Rows work as anywhere else, and filters and sorts narrow or reorder the lens |
| `lens.parents` | A lens shows a subtask whose parent it doesn't show | The parent shows as context above it, and the lens expands it once, leaving it to you after that |
| `lens.back` | The lens's key again, clicking its count, `Escape` with no selection to clear, or Go back on an empty lens | The list returns to the view it showed before: filters, search, sort, the active task, expanded parents and scroll position. Anything changed inside the lens is dropped |
| `lens.switch` | Opening another lens while one is open | The new lens replaces it, and going back still returns to the view from before the first |
| `lens.status` | Changing the status filter in a lens | While the lens is on, the status chip is pressed and names the statuses it shows, e.g. Done, or Open, in progress, paused. Changing the filter ends the lens, and the new status view becomes the ordinary view, remembered as usual |
| `lens.launch` | Launching after quitting with a lens on | The lens is never remembered; the list opens on the view it set aside |
| `lens.count` | A header count's lens has nothing to show | The count is hidden, except while its lens is on |

## Changed by agents

The app shows what agents did while you were away, as far as this device knows: an agent's change is recorded by the CLI it ran on, and that record doesn't travel through sync.

| Rule | When | Then |
| --- | --- | --- |
| `agents.count` | An agent changed tasks through the CLI on this device since you last looked | The header shows how many tasks, with a robot, in the plain text color since it is news and not a warning, left of the due count. Changes a person makes with the CLI (`--actor-kind human`), changes from other devices and tasks that no longer exist don't count |
| `agents.lens` | `Shift+A`, clicking the count, or Changed by agents in the `Ctrl/⌘+K` palette | The list shows those tasks in every status, the latest change first, and turns like the done lens (`done.lens-flip`). Under each title a line names the task's latest change by an agent, e.g. "Completed by claude · 14:32". A change that arrives while the lens is open joins it |
| `agents.seen` | The agents lens closes, in any way | What it showed counts as looked at, so the count clears until an agent changes something again. The device remembers this between launches. A device that never looked starts 24 hours back |

## Queue

The queue is the tasks you lined up to work off next, in your own order. Being queued is part of the task (see `update.queue`), so it syncs and the CLI sees it; only the lens is a view.

| Rule | When | Then |
| --- | --- | --- |
| `queue.add` | `Q`, or Add to queue in the task menu, on an open, in-progress or paused task | It joins the back of the queue and its number slides in from the right at the row's end. On a task already queued, it leaves the queue instead. Done and canceled tasks can't be queued, and finishing one takes it out (`status.leaves-queue`) |
| `queue.front` | `Shift+Q` on an open, in-progress or paused task | It goes to the front, queued or not. Its number drops in from above and each number behind it rolls to its new place |
| `queue.marker` | The list shows a queued task | Each queued row shows its place in the queue in the accent color after its category, the front one bold, in a column every row keeps while any queued task shows. On a phone the column shows just the number |
| `queue.count` | Any task is queued | The header shows how many, in the accent color, left of the agents count |
| `queue.lens` | `W`, clicking the count, or Work off the queue in the `Ctrl/⌘+K` palette | The list shows the queue in queue order, with subtasks on their own lines rather than under their parents (`lens.parents`). Rows outside it fold away and the queued ones gather into place; going back spreads them out and unfolds the others between them. Reduced motion turns it off |
| `queue.move` | `Ctrl/⌘+↑↓` or `Ctrl/⌘+Home/End` in the queue lens, sorted by manual order | The active task moves within the queue. The list's own manual order is untouched |

## Due now

| Rule | When | Then |
| --- | --- | --- |
| `due.count` | An open, in-progress or paused task is due today or earlier, from any client | The header shows how many, e.g. "2 due now", in red (the destructive color) with a calendar, left of the done count |
| `due.lens` | `!`, clicking the count, or Due now in the `Ctrl/⌘+K` palette | The list shows open, in-progress and paused tasks due today or earlier, most overdue first and the same day by priority |
| `due.all-clear` | The due lens has nothing to show | The empty list reads "All clear" and offers Go back |
| `due.lens-flip` | The due lens opens or closes | Like `done.lens-flip`, but the list turns over its horizontal center line, like a page on a flip calendar, and the due count's number flies between the header and the count line. Switching straight between the two lenses plays the new lens's turn while the old count flies home. Reduced motion turns it off |
