# Toolbar

One compact toolbar above the list, in this order:

```text
[ + ]  ⧩ [ Category Status Priority Tags Unblocked Search ]  ⇣ [ Created Updated Priority Manual Reverse ]  ☝ [ Details Reorder Undo Task actions ]
```

Each button shows its value through its pressed state, label and tooltip. Filters, search and sort are remembered between launches.

The toolbar holds list-level controls (filters, sort, view) and global actions (New task, Undo). Actions that set a value on the active task belong in Task actions, not in a new toolbar button.

| Rule | When | Then |
| --- | --- | --- |
| `toolbar.layout` | Arranging the toolbar | Every control and group glyph is one cell, with no gaps between them. New task is an icon-only accent cell at the start of the first row. Groups are a glyph followed by their buttons; they flow beside New task and wrap whole onto rows that start one cell in, so every icon sits on a shared column at any width. On a wide window the column is a whole number of cells, so the top bar's buttons sit on the toolbar's columns. At the default text size the desktop toolbar fits one row; a 390px window with a mouse fits two. Nothing overflows horizontally at 320px. Actions contains Details, Reorder, Undo and Task actions |
| `toolbar.button-kinds` | Any toolbar button | State buttons (filters, sort, Reverse, Details) report pressed, and only they use the accent tint for "on". Commands (New task, Undo, Reorder, Task actions) never report pressed; one that opens a menu or popover shows it as expanded |

## Folding

| Rule | When | Then |
| --- | --- | --- |
| `toolbar.fold` | Clicking a group's glyph | The group folds to its glyph, or unfolds. Folded groups are remembered between launches. The count line still reports every active filter. At rest an open group's glyph reads as a quiet label, dimmer than its buttons but the same size; hovering it shows the fold direction. While the group is open, a short line as wide as the glyph's icon sits under it, so each group's start is easy to find. A folded glyph drops the line for a dashed outline, so it reads as a stub for hidden buttons rather than part of the group beside it |
| `toolbar.fold-indicator` | A folded group has a pressed button | Its glyph shows a small dot |
| `toolbar.fold-mode` | `F` or `S` while Filters or Sort is folded | The group unfolds for the focus mode and folds again when the mode exits. Shortcuts work the same folded or not |

## Task actions

| Rule | When | Then |
| --- | --- | --- |
| `toolbar.task-actions` | Clicking the Task actions icon in Actions | A menu offers Blockers, Move under, New child, Copy text and Pause/resume with their shortcuts. Undo and Task actions use the same compact icon buttons and tooltips as their neighbors; the open menu shows as expanded, not pressed. Task-specific entries act on the active task; Pause/resume uses the selection like `P`. The button is disabled without an active task; both action buttons are disabled while the editor is open. Closing the menu returns focus to the list unless an editor or dialog opened |

## Touch feedback

| Rule | When | Then |
| --- | --- | --- |
| `toolbar.tooltips` | Hovering toolbar buttons | Only one toolbar tooltip is open at a time. Moving to another button replaces it; leaving the trigger and tooltip dismisses it |
| `toolbar.touch-feedback` | Tapping Unblocked, a sort option, Reverse or Details with touch | The action runs immediately and a tooltip above the button uses the same short text as desktop hover for 1.5 seconds. The next interaction dismisses or replaces it, without taking focus. Disabled controls do not show feedback. Buttons that open menus or pickers do not add tap feedback |

## Count line

| Rule | When | Then |
| --- | --- | --- |
| `count.line` | Any list state | One muted line under the toolbar reports the matching count and active filters, e.g. "12 active tasks". It never mentions sort and truncates instead of wrapping |
| `count.clear-one` | Clicking a filter in the count line | Only that filter resets |

## Focus modes

| Rule | When | Then |
| --- | --- | --- |
| `filter.mode` | `F` | The filter group takes focus with a visible ring. The next key picks a filter |
| `sort.mode` | `S` | The sort group takes focus. The next key picks a sort |
| `toolbar.mode-exit` | Choosing an option, pressing the same key again, `Escape`, leaving the app or hiding the page | Focus returns to the list. There is no timeout |
| `toolbar.dialog-return` | A category, tag or search dialog opened from a mode closes | Focus returns to the list |

## Filters

| Rule | When | Then |
| --- | --- | --- |
| `filter.status-toggle` | `F` `S` | Switches between active (open, in progress) and inactive (paused, done, canceled). Active is the default |
| `filter.status-exact` | `F` then `O` / `I` / `D` / `P` / `X` | Shows only Open / In progress / Done / Paused / Canceled |
| `filter.priority` | `F` then `0`–`4` | Shows only that priority. The same key again clears it |
| `filter.unblocked` | `F` `U` | Hides tasks with any blocker. A done blocker still blocks; a canceled one doesn't |
| `filter.category` | `@`, or `F` `C` | Category picker with its search focused. One category at a time. Categories used only by canceled tasks are left out |
| `filter.tags` | `#`, or `F` `T` | Tag picker. Tags combine with AND. `Space` toggles, `Enter` picks the highlighted tag when none is picked, then closes. A Clear tags row empties the filter; `Enter` activates it even when tags are selected. Tags used only by canceled tasks are left out |
| `filter.search` | `/` | Search over titles and descriptions. The query stays applied after the dialog closes |
| `filter.escape` | `Escape` on the list with one or no task selected | All filters and search reset. Sort and Details stay |

## Sort

| Rule | When | Then |
| --- | --- | --- |
| `sort.default` | First launch | Created, newest first |
| `sort.created` | `S` `C` | Created date |
| `sort.updated` | `S` `U` | Updated date |
| `sort.priority` | `S` `P` | Priority, P0 first |
| `sort.manual` | `S` `M` | Manual order, the order shared with the CLI and agents |
| `sort.reverse` | `S` `R` | Reverses date or priority order. Not available for Manual |
