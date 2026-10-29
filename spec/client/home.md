# Home

The task list is the home screen. Everything starts and ends there: launching, capturing, editing and closing a dialog all return focus to the list.

## Launch

| Rule | When | Then |
| --- | --- | --- |
| `home.launch-focus` | The first load succeeds with tasks | No dialog opens. The list has focus and the first visible task is active |
| `home.launch-empty` | The first load succeeds with no tasks | The empty `Saved tasks` shell has focus. `C` opens capture from there |
| `home.launch-error` | The first load fails | `Retry` has focus until a load succeeds, then the list takes focus |
| `home.new-task-secondary` | Any launch | The New task button is visible for the mouse but is never the initial focus and never a Tab stop |

> Why: launching straight into the list means the first keystroke always does something useful.

## Focus

| Rule | When | Then |
| --- | --- | --- |
| `home.single-tab-stop` | The list has focus | The list is one Tab stop. `Tab` and `Shift+Tab` do nothing; focus stays on the list |
| `home.aria` | Any list state | The active row is exposed through `aria-activedescendant`, selected rows through `aria-selected`, and a parent's expanded or collapsed state through `aria-describedby` |
| `home.row-glyphs` | Status, category or disclosure glyph on a row | Clicking acts on that task. Glyphs are never nested buttons or Tab stops |
| `home.due-soon` | An open, in-progress or paused task is due within 6 days, or overdue | A quiet calendar marker before the row's category column reads `today`, `tomorrow`, the weekday (`Fri`) or `2d late`, with the full date on hover. Today and overdue use the warning color. Dates further out show only in Details; done and canceled tasks never show the marker |
| `home.row-layout` | A task row | The title wraps in the space it leaves, with tags as quiet `#tag` text after its last word. The row ends with the due marker, the expand arrow and a fixed-width category column, all level with the first line. The column shows the category as quiet text after a folder, cut with an ellipsis when long. The arrow and the column keep their width when empty, so dates and arrows line up down the list. The column is left out while the list is filtered by a category |
| `home.tag-click` | Clicking a tag on a row | Adds it to the tag filter instead of opening the editor. The title and the rest of the row still open it (`home.open-editor`) |
| `home.click-keeps-focus` | Clicking a toolbar button, row glyph or header button | The button doesn't take focus; the current keyboard surface keeps it |
| `home.dialog-return` | A dialog closes | Focus returns to the surface that opened it, never to the button that was clicked |
| `home.refresh-keeps-focus` | The workspace changes elsewhere (CLI, agent, another device) | The list reloads without moving focus, closing an editor or losing unsaved editor text. The active task stays active while it is still visible, including a task made active by arrows, a click or undo while the reload was on its way |
| `home.auto-load` | Navigation or scrolling comes within a screenful of the end of the loaded tasks, and more match | The next page loads without a button or a visible change. Reloads after an edit or a workspace change keep every row already loaded |

## Shortcut scope

| Rule | When | Then |
| --- | --- | --- |
| `home.shortcuts-anywhere` | Focus is anywhere on the home screen | List shortcuts work, even when the list itself isn't focused |
| `home.shortcuts-paused` | Typing in a field, or an editor or dialog is open | List shortcuts are off. The editor's own keys win |
| `home.app-shortcuts` | Any state | `Ctrl/⌘+K` (palette), `Ctrl/⌘+,` (Settings) and `Alt+T` (themes) still work |
| `home.palette-complete` | Any keyboard action exists | It is listed in the `Ctrl/⌘+K` palette |
| `home.same-key-closes` | A key opened a panel, popover or dialog (`?`, `Ctrl/⌘+K`, `Ctrl/⌘+,`, `Alt+T`). Toolbar modes follow `toolbar.mode-exit` | Pressing that key again closes it like `Escape`, and focus returns to where it was. A surface you type into (`@`, `#`, `/`) keeps the key as text |
| `home.mouse-path` | Any action exists | It also has a mouse path: a button, menu item, picker or row glyph. A shortcut alone is incomplete |

## Moving around

The list shows two levels: root tasks and their children.

| Rule | When | Then |
| --- | --- | --- |
| `home.arrows` | `Up` / `Down` | The previous or next visible task becomes active and the only selection |
| `home.home-end` | `Home` / `End` | The first or last visible task becomes active and the only selection |
| `home.left` | `Left` on a child | The parent becomes active |
| `home.left-collapse` | `Left` on an expanded parent | It collapses |
| `home.left-clear-category` | `Left` on a collapsed or childless root task while filtered by category | The category filter clears and the task stays active |
| `home.right-expand` | `Right` on a collapsed parent with no category, one shown only because a child matches, or any parent while filtered by category | It expands. On an expanded parent, nothing happens |
| `home.right-category` | `Right` on a categorized childless task, or on a categorized parent that matches the filters itself while no category filter is active; also `Right` on a childless task without a category | A categorized task filters the list to its category and stays the only selection. A parent stays collapsed; another `Right` expands it. A childless task without a category stays put and the app says so |
| `home.category-flight` | A row's category becomes the filter, by click or `home.right-category` | A copy of the row's category flies up into the filter summary as its category badge fades in, the reverse of a new task taking the filter's category. Reduced motion turns it off |
| `home.open-editor` | `Enter`, or clicking a row | The task's inline editor replaces its row with the title focused |
| `home.task-context-menu` | Long-pressing or right-clicking a saved task | Opens a task-actions menu for that row without opening its editor. Moving a touch to scroll cancels the hold. Actions target that task alone; release never also edits it. Dismissal returns focus to the list unless an action opened an editor or dialog. Every action has an icon matching the existing action where available. Cancel task changes status to canceled, rather than deleting the task. The existing toolbar remains an alternative path |

## Selection

The active task is the row the cursor is on: `Enter`, arrows, priority and copy act on it. The selection is what status keys, `Delete` and reorder act on. Without Shift or Ctrl/⌘ the two are the same task, so no other row is ever selected by accident. Only Shift and Ctrl/⌘ select several tasks; the active task is always one of them, and they stay within one visible sibling scope: the children of one parent, or the root tasks.

| Rule | When | Then |
| --- | --- | --- |
| `select.single` | The active task changes without Shift or Ctrl/⌘: arrows, a click, `Left`/`Right`, undo or redo, a refresh, a filter change or a new task | It becomes the only selection |
| `select.includes-active` | Several tasks are selected | The active task is one of them. Removing it with `Ctrl/⌘+click` makes the nearest selected sibling active |
| `select.extend` | `Shift+Up` / `Shift+Down` | The selection extends through visible siblings |
| `select.extend-edge` | `Shift+Home` / `Shift+End` | The selection extends to the first or last sibling |
| `select.pointer` | `Ctrl/⌘+click` / `Shift+click` | Toggles one task, or selects a sibling range |
| `select.escape` | `Escape` on the list with several tasks selected | The selection narrows to the active task. With one or none selected, `Escape` resets filters instead |

## Reorder

Reordering changes manual order, which is saved and shared with the CLI and agents.

| Rule | When | Then |
| --- | --- | --- |
| `reorder.step` | `Ctrl/⌘+Up` / `Ctrl/⌘+Down`, including key repeats | The selected group moves one visible sibling slot immediately in Manual order. Repeated presses update the list while earlier moves save in sequence; a failed move stops the unsaved sequence and restores the confirmed order |
| `reorder.edge` | `Ctrl/⌘+Home` / `Ctrl/⌘+End` | The selected group moves to the start or end of its sibling scope |
| `reorder.switch-sort` | The first reorder while another sort is active | The list switches to Manual order |
| `reorder.allowed-view` | Reordering outside the default Active view (optionally narrowed to one category) | Nothing moves. A message names the filter to clear |
| `reorder.children-follow` | A root task moves | Its children move with it. A child never leaves its parent by reordering |
| `reorder.mouse` | The Reorder button beside Details | A popover below the toolbar offers Move up, Move down, Move to beginning and Move to end. It is closed by default and never reflows the page |

## Hierarchy in a filtered list

| Rule | When | Then |
| --- | --- | --- |
| `home.context-ancestor` | A matching task's ancestor doesn't match the filters | The ancestor shows as a muted row explaining that a child matches, expanded so that child is in view. It isn't counted. Collapsing it sticks while it stays a context row |
| `home.context-children` | A loaded tree has children outside the current results | The parent keeps its expand arrow. Expanding reveals all descendants, including paused, done and canceled tasks, in the two-level outline. Outside-result children are muted and labeled as shown with their parent. Context rows don't change the matching count or join bulk selection or reorder; their individual actions still work |
| `home.filtered-empty` | Filters match nothing | A focusable, row-sized shell says "No tasks match the current filters" with a mouse-only Clear filters action. `Escape` clears filters from the keyboard |

## Details

| Rule | When | Then |
| --- | --- | --- |
| `details.toggle-all` | `Shift+V`, or the Details button | Descriptions and the time footer show or hide for every task together. Off by default and remembered. It is a display preference, so `Escape` never clears it. Pressing it resets any per-task change |
| `details.toggle-active` | `V`, or Show or Hide details in the task menu | Flips details for that task alone, against the all-tasks setting. It lives in client memory only: never stored in the workspace, never synced, and gone on reload |
| `details.mixed-marker` | Some tasks differ from the all-tasks setting | The Details button shows a dot, and its tooltip says some tasks differ |
| `details.keep-active-visible` | Details toggles while a task is active | The active task scrolls back into view, since its row height changed |
| `details.blocked-by` | A task has active blockers | "Blocked by" stays visible with Details on or off |
| `details.layout` | Details is on | The description follows the title, as in the editor, and the footer comes after it in place of the "Blocked by" line. The description keeps its line breaks and is cut after four lines |
| `details.footer` | Details is on | One quiet row of plain facts separated by dots shows "Blocked by" first when the task has active blockers, then the due date in full when the row has no due marker (further out than the week, or on a done or canceled task), Created, and Updated before Created when it falls on a different day. The row's due marker looks the same as with Details off, so the date shows once and takes no line of its own |
| `details.relative-dates` | A date in the footer | Reads `today`, `yesterday` or `2 days ago`; older dates read `Sep 8`, or `Dec 10, 2025` outside the current year. Hover shows the full local time |
| `attach.badge` | Details is on and a task has images | The footer shows the image count, known from the task alone. Clicking it copies the newest image |

## Scrolling

| Rule | When | Then |
| --- | --- | --- |
| `home.quiet-scrollbar` | A list, dialog or panel overflows | Its scrollbar thumb shows only while the pointer is over it or it is scrolling, by mouse or keyboard, and hides shortly after it rests |
