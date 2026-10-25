# Learning

Tasks teaches itself through short quests. A quest leads with the keyboard: one step at a time, a clear prompt, a visible reward for each step, and no pressure. A quest can be put aside at any point and picked up later, exactly where it was left.

## Moves

A move is one shortcut, shorthand key or gesture worth learning, named after the rule it performs (`status.forward`, `shorthand.category`). Keyboard devices and touch devices learn different moves (see `platform.moves`).

| Rule | When | Then |
| --- | --- | --- |
| `learn.practice` | A move is performed: by its keys on a keyboard device, or by any path on a touch device | It is learned for good and saved with this Tasks home's preferences, whether or not a quest asked for it |

## Quests

Each quest teaches a handful of moves in an order where every step makes sense on its own. Quests build on the tasks you made in the quests before them, so none needs sample data.

| Quest | Summary | Keyboard steps | Touch steps |
| --- | --- | --- | --- |
| First task | Learn the basics in about two minutes | `C`, `@`, `#`, `Enter`, `Space`, `Space`, `D`, `D` | +, `@`, `#`, save, status icon, status icon, the done count, the done count |
| Plan ahead | Due dates, priorities, pausing and undo | `C`, `^`, `Enter`, `0`–`4`, `P`, `Ctrl/⌘+Z`, `N`, `N` | +, `^`, save, the due count, the due count |
| Find your way | Filters, sorting and search | `F` then a key, `S` then a key, `@`, `Escape`, `/` | |
| Shape your list | Child tasks, blockers and reordering | `Shift+C`, `Enter`, `M`, `B`, `Shift+↓`, `Ctrl/⌘+↑↓` | long-press, Move under, Blockers |
| Fast hands | Quicker edits and every shortcut there is | `Enter` on a task, `Tab` completion, `Backspace` after a pill, `Tab` then `0`–`4`, `Enter`, `V`, `Ctrl/⌘+K` | |

A device without steps for a quest doesn't list it. A quest that opens a view, like the done or due lens, ends by closing it again.

Each step has one prompt and one success line. First task, on a keyboard:

| Step | Prompt | Success |
| --- | --- | --- |
| 1 | Press `C` to create your first task | A fresh task |
| 2 | Type what needs doing, then `@` and a word for its category, like `@life`. `Space` selects it, `Enter` saves the task | Filed under life |
| 3 | Add a tag with `#`, like `#quick` | Tagged quick |
| 4 | Press `Enter` to save it | Saved |
| 5 | Press `Space` to start it | In progress |
| 6 | Press `Space` again when it's done | Done |
| 7 | Press `D` to see what you finished today | That's your day so far |
| 8 | Press `D` again to go back to your list | Back to your list |

Success lines name what was typed, so `@work` reads "Filed under work". A second sentence shows muted on its own line (`quest.card`).

| Rule | When | Then |
| --- | --- | --- |
| `quest.offer` | Quests are shown, no quest is under way or put aside, and one is unfinished | The quest card offers the first unfinished quest with Later beside it, showing its first step's prompt over its summary, so the key always says what it does: "Press `C` to create your first task" over "Learn the basics in about two minutes". Doing the first step starts the quest; Later puts it aside like `quest.pause` |
| `quest.card` | A quest is under way | A card docked below the list (see `platform.quest-card`) shows the quest's name, one dot per step, the step's keys as large key caps and its prompt. A second sentence, like "`0` is the most urgent", sits muted on its own line under the one to act on. A help icon in its corner opens the Learn panel. The list gives up the room, so the card never covers a row or the editor. It never takes focus and never handles a key |
| `quest.step` | The step's move is performed while its quest is under way | The step is done, even if the move was learned before. An editor step done before its turn in the same editor shows its success line and counts when its turn comes, so `#quick @life` finishes both |
| `quest.success` | A step is done | Its key caps turn into a check with a short pop in the accent color, its dot fills and the success line replaces the prompt. After about two seconds the next step slides in. Reduced motion keeps the check and the timing, without the pop or the slide |
| `quest.pointer` | On a keyboard device, a step is done with the mouse instead of its keys | The step still counts, so nobody is stuck, but the move isn't learned and the success line ends with "Next time, try `Space`" |
| `quest.complete` | The last step is done | The card reads "First task complete" and the keys the quest taught appear one after another as a small recap. The help icon's ring fills by as much as was learned. The card then names the next quest ("Next: Plan ahead, whenever you like") and, on the next key or after a few seconds, gives way to its offer (`quest.offer`). The next quest never starts on its own |
| `quest.pause` | Later on the card, Pause in the Learn panel, or Pause quest in the `Ctrl/⌘+K` palette | The card slides away and a toast says "Quest paused. Pick it up from `?` whenever you like." The quest keeps its step across restarts. Nothing asks again on its own; the help icon's ring is the only reminder |
| `quest.resume` | Resume in the Learn panel, or Resume quest in the palette | The card returns at the step where it was left |
| `quest.reopen` | The quest is at a step inside the editor while the editor is closed: after `Escape`, Cancel, saving before the step was done, a restart or `quest.resume` | Every step done so far stays done. The card asks to open the editor first ("Press `Enter` to open the active task, or `C` for a new one"; on touch "Tap a task to open it, or + for a new one") and shows the step's own prompt once it opens. Steps done ahead of their turn in the closed editor count again only when redone |
| `quest.one-at-a-time` | Starting a quest while another is under way | The other one is put aside, as with `quest.pause`, without a toast |

## Learn panel

| Rule | When | Then |
| --- | --- | --- |
| `learn.panel` | `?`, or the Help button | The Learn panel opens on the right without taking focus. It lists the quests in order, each with its state (new, under way, paused at step 3 of 7, or complete with a trophy) and a Start, Pause, Resume or Replay button, then the moves it is first to teach with their keys, learned ones checked. Start, Resume and Replay close the panel so the card shows. `?`, `Escape` or its close button closes it |
| `learn.progress-ring` | Quests are shown and some of this device's moves are unlearned | The Help button's circle fills in the accent color as moves are learned. Once every move is learned it is the plain help icon |
| `learn.hesitation` | `F` or `S` | The mode's guide opens at once until that mode has been used to choose an option. After that it opens only when no key follows within 600 ms, so a practiced chord never flashes it |
| `learn.all-shortcuts` | All shortcuts at the bottom of the Learn panel | Opens the `Ctrl/⌘+K` palette |

## Settings

| Rule | When | Then |
| --- | --- | --- |
| `learn.quests` | Show quests under Help in Settings > General | On by default and remembered. Off: no offer, no card and no progress ring. Quests can still be started from the Learn panel or the palette, which shows the card again for that quest |
| `learn.reset` | Reset progress under Help in Settings > General | Every learned move and every quest's progress is forgotten, so the offer, the ring and every quest start over. The section says how many moves are learned. Nothing else changes |
