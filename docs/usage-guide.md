# Usage and interaction guide

Tasks is a keyboard-first, not keyboard-only, app. The saved-task list is the home screen and the primary place to begin work. Every action must also have a mouse-accessible path in the UI, such as a button, menu item, inline control, or compact icon toolbar with an accessible label and tooltip. Mouse controls remain secondary, but they must be complete when a pointer is easier or keyboard access is unavailable.

Keep the interface minimal, sleek, and calm. Prefer small icon toolbars, progressive disclosure, and existing surfaces over large duplicate controls or dashboard clutter. A keyboard shortcut alone is not enough, and a mouse affordance should not require adding a noisy control to every row.

## Home-screen contract

- The first load opens with no dialog and moves focus to the task-list surface.
- When tasks exist, focus is on the `listbox`; the first visible task is the active row.
- An empty workspace focuses the `Saved tasks` list shell. From there, `C` opens capture.
- A filtered empty workspace keeps a focusable task-list shell at roughly one task-row width and height, shows “No tasks match the current filters,” and offers a mouse-accessible Clear filters action. Clear filters is not a Tab destination because Escape resets filters from the list.
- A load error focuses `Retry` until the first successful load can focus the list.
- Loading or refreshing tasks must not steal focus from the current task, an open editor, or another dialog.
- `New task` is a backup action beside the list for mouse discovery and use. It is not the launch focus or a tab stop; `C` or the command palette is the primary keyboard path.

The list uses a single focus stop. Arrow keys move the active row and do not add a tab stop for every task. The active row is exposed through `aria-activedescendant`; the list is multi-selectable and exposes selected rows through `aria-selected`.

## Filter toolbar

One compact row above the list, in three groups in this order:

```text
[ Category ] [ Status ] [ Priority ] [ Tags ] [ Unblocked ] [ Search ] [ Created Updated Manual Reverse ] [ Details Move ]
```

Unblocked is an existing extension after the plan's five dimensions. Each button shows its active value through its pressed state, label, and tooltip. A single muted line directly below the toolbar reports the filtered count and active qualifiers, such as “12 active tasks”. It never includes the sort state. Omit filler like “Showing” and truncate rather than wrap. Every keyboard action below has a mouse path through its menu or dialog. Move controls are the one mouse-only button: the popover is closed by default and opens below the toolbar without reflowing the page.

`F` moves focus to the whole filter button group and `S` moves focus to the whole sort button group. The focused group has a visible focus ring and owns its keyboard shortcuts until an option is chosen, the same focus key is pressed again, or `Escape` returns focus to the task list. These are explicit focus modes with no timeout. Category, tag, and search dialogs opened from a toolbar mode return focus to the task list when they close.

- Status: Active means open or in progress. Inactive means paused, done, or canceled. The `canceled` spelling stays canonical.
- Priority: Highest through lowest. Every task defaults to P2. Task rows show the priority as a colored dot with an accessible label and tooltip; filters and the editor keep the text labels.
- Category: the `@category` grouping. Single-select. The picker omits categories used only by canceled tasks.
- Tags: `#tags` multi-select with AND semantics. In the picker, `Space` toggles the highlighted tag; `Enter` selects it first when none are selected, then closes; a `Clear tags` row empties the filter. Tags used only by canceled tasks are omitted.
- Relationships: canceled tasks cannot be chosen as new parents or blockers, and a new child cannot be created under a canceled parent. Existing parent and dependency links remain available for removal. A canceled dependency does not count as a blocker for the Unblocked filter.
- Search: titles and descriptions. The query stays applied after the dialog closes.
- Sort: Created or Updated date, Priority, Manual order, and newest or oldest direction for date sorts. Priority defaults to highest first and can be reversed to lowest first. Updated/newest is the default. Manual order is a persistent sibling order shared by the UI, CLI, and agents; reverse is unavailable for it. The reverse toggle exposes its direction through its pressed state. The field icons mirror the time footer: clock-3 is created, rotate-ccw-clock is updated, and list-ordered is manual.
- View: Details toggles optional task descriptions and the per-task time footer together. Off by default; a display preference, not a filter, so `Escape` never clears it. Active blocked-by context remains visible either way. Move opens the mouse-only controls for the selected task group in a popover below the toolbar; it is closed by default.
- Hierarchy: Status and other filters do not sever parent links. When a matching child belongs to an excluded ancestor, the ancestor appears as a muted explanatory row, does not count toward the filtered total, and remains expandable.
- Manual ordering: Every sibling scope has a dense persistent order. New tasks and tasks moved under a new parent enter first. Root moves carry their descendants; child moves stay inside the current parent. Canceled and reopened tasks keep their position. Shift selection and reordering stay within one visible sibling scope. Manual ordering is unavailable while a context-only ancestor is active.

## Task details

Descriptions and timestamps are hidden unless Details is on (`V`). One quiet final row in the full task view: the updated date leads when it falls on another day, followed by the created date; otherwise only the created date appears. Each timestamp is labeled Created or Updated. Recent dates read `today`, `yesterday`, or `2 days ago`; older dates use `Sep 8` (this year) or `Dec 10, 2025`. Hovering a date shows the full local timestamp with time. Active blocked-by context stays visible when Details is off.

## Keyboard shortcuts

These shortcuts work anywhere on the home screen, even when focus is not on the task list. Typing in title, description, search, or picker inputs disables them, as does any open dialog. Filter keys act only while the filter toolbar is focused; sort keys act only while the sort toolbar is focused. A toolbar mode ends when an option is chosen, focus leaves the app, the page is hidden, or `Escape` returns focus to the task list.

| Key | Action |
| --- | --- |
| `C` | Open the New task dialog |
| `Shift+C` | Open New task with the active task as parent |
| `Enter` | Edit the active task |
| `Space` | Move the active task forward: open to in progress, in progress or paused to done, done or canceled back to open |
| `Shift+Space` | Move the active task backward: open to done, in progress to open, paused or done to in progress, canceled to open |
| `P` | Pause an open or in-progress task, hiding it from Active, or resume a paused task to in progress. The palette entry runs the same action by mouse. |
| `Delete` | Immediately cancel the active task |
| `Ctrl/⌘+C` | Copy the selected task's title and description, without `@category` or `#tags` |
| `Ctrl/⌘+Z` | Undo the latest desktop task change; also in the shortcuts palette. A newer change replaces it, and the toast confirms the restore |
| `0` `1` `2` `3` `4` | Set the active task to P0 through P4 |
| `F` | Focus the filter toolbar; the next key picks a filter, or press `F` again to return to the list |
| `F then S` | Switch between active and inactive task views |
| `F then O` / `I` / `D` / `P` / `X` | Show only Open / In progress / Done / Paused / Canceled tasks |
| `F then 0`–`4` | Filter to P0 through P4; pressing the active number clears it |
| `F then U` | Toggle the unblocked-task view |
| `@` | Open the category filter with its search field focused |
| `#` | Open the tag filter with its search field focused |
| `F then C` | Open the category filter |
| `F then T` | Open the tag filter |
| `/` | Open task search; works from the task list or filter toolbar |
| `S` | Focus the sort toolbar; the next key picks a sort, or press `S` again to return to the list |
| `S then C` | Sort by created date |
| `S then U` | Sort by updated date |
| `S then P` | Sort by priority, highest first |
| `S then M` | Sort by manual sibling order |
| `S then R` | Reverse the date or priority sort direction |
| `V` | Toggle task descriptions and the time footer |
| `B` | Add a blocker to the active task |
| `M` | Open the move picker, including Remove parent for nested tasks |
| `Shift+Up` / `Shift+Down` | Extend the selection through visible sibling tasks |
| `Shift+Home` / `Shift+End` | Extend the selection to the beginning or end of the active sibling scope |
| `Ctrl/⌘+click` / `Shift+click` | Toggle a task or select a visible sibling range with the mouse |
| `Ctrl/⌘+Up` / `Ctrl/⌘+Down` | Move the selected task group one visible sibling slot in Manual order |
| `Ctrl/⌘+Home` / `Ctrl/⌘+End` | Move the selected task group to the beginning or end of its visible sibling scope; the first move switches to Manual order |
| `Up` / `Down` | Move through visible tasks, replacing the selection with the active row |
| `Home` / `End` | Jump to the first or last visible task, replacing the selection |
| `Ctrl/⌘` with movement keys | Reorder only in the default Active view, optionally narrowed to one category; search, tags, priority, Unblocked, inactive, exact-status, and context-only rows report what to clear. The Move button provides the same actions by mouse. |
| `Left` / `Right` | Move to a parent or expand/collapse children; `Right` on a task without children filters by its category and keeps that task as the sole selection, while `Left` while category-filtered clears that filter and keeps the active task selected |
| `Tab` / `Shift+Tab` | Do nothing while the task list is focused; list focus stays put |
| `Escape` | Return from the filter or sort toolbar to the task list; on the list, clear a multi-task selection, otherwise reset all filters; `F`/`S` also close their focused toolbar |
| `?` (`Shift+/`) | Open the starter help section on the right |
| `Ctrl/⌘+K` | Open the searchable shortcuts and syntax palette |
| `Ctrl/⌘+,` | Open Settings |
| `Alt+T` | Open the theme picker |
| Configured global shortcut (default `Ctrl+Alt+Space`) | Focus the Tasks window from anywhere in the native desktop app; change it in Settings. On Omarchy/Hyprland, copy the generated Lua binding from Settings. |

Inside the task dialog, `Tab` and `Shift+Tab` move through the title, optional description, and the single priority section. A non-empty title opens and focuses the description; an empty create title does not open the optional description. Focus the priority section itself, not an individual P0-P4 button, then press `0`-`4` or `←`/`→` to choose the task priority. Those number keys set the active task's priority on the list; behind `F` they filter instead. Action buttons are backup mouse controls, not Tab destinations; use `Enter` or `Ctrl/⌘+Enter` to save and `Escape` to close or step back from the description. The priority defaults to P2. Saving a new or edited task closes the dialog and returns to the list. Dialogs return focus to the control or list that opened them.

Settings opens with focus on its tab list. Use `←`/`→` to switch between General, Shortcuts, and Data, then `Tab` to enter the selected panel's first control. `Shift+Tab` returns to the tab list; the selected tab and active panel keep the normal focus ring. Panel wrappers and the mouse-only close icon are not Tab stops; `Escape` closes the dialog.

Use `@category` and `#tags` in task text. The command palette explains the complete current shortcut and syntax surface, so update it when a keyboard action changes.

## For agents and contributors

Treat this document as the UI interaction contract when using browser automation, reviewing changes, or adding commands:

- Start UI checks from the task list. Do not assume the New task button is focused or that a dialog is already open.
- Wait for the initial focus contract: a populated workspace should have `document.activeElement` on `[role="listbox"]`; an empty workspace should focus `[aria-label="Saved tasks"]`.
- Prefer keyboard events for the primary path, but verify the equivalent mouse path for every action. A shortcut-only feature is incomplete.
- Buttons are backup and discovery affordances. Trigger actions with their normal keyboard commands or field shortcuts; do not make buttons Tab destinations. The New task button is intentionally `tabIndex=-1` and remains available as a mouse fallback, as do the filter buttons and the individual dialog priority buttons. The filter and sort button groups are programmatic focus stops for `F` and `S`, not normal Tab destinations. The dialog's priority section is its single keyboard focus stop.
- Clicking a toolbar button, the New task button, a task status icon, a task's category badge, or a header Help, Themes, or Settings button never moves DOM focus (the mousedown default is prevented), so the current keyboard surface keeps focus and keyboard navigation keeps working. Clicking a category badge filters the list to that category, the same as choosing it from the picker. Ctrl/Cmd-click toggles a row, and Shift-click selects a visible sibling range. Dialogs opened from header controls return focus to the surface that opened them, never to the button.
- Do not add Tab navigation from the task list. `Tab`, `Shift+Tab`, and `Escape` leave focus on the list; use `C` or the command palette to open capture.
- Add a compact, discoverable mouse affordance when adding an action. Icon buttons need accessible labels and tooltips; use menus or progressive disclosure instead of duplicating controls across every row. The Move button beside Details opens a popover with Move up, Move down, Move to beginning, and Move to end for the selected task group; it is closed by default and does not add controls to every row. The move picker puts its Remove parent action in a separate group above new-parent results when the task is nested.
- Add a shortcut to `src/components/HelpPalette.tsx` when adding a keyboard-first action. Keep the list as the initiating surface.
- Keep focus ownership explicit. `src/components/TaskList.tsx` owns the home/list focus, toolbar focus modes, and window-level home shortcuts, `src/navigation.ts` owns explicit list entry plus the shared focus-steal prevention for backup controls, and the focus stack owns modal return targets.
- Do not add `autoFocus` to a secondary action to solve initial focus. Initial focus belongs in the list lifecycle, after the first query has rendered the correct empty, error, or populated state.
- While visible, the home list checks a shared workspace revision and reloads only when it changes, so CLI and agent writes appear without a restart. Refreshes must preserve focus and unsaved dialog content. A new data result should update the active row without moving the user's focus unless the focused element no longer exists.
- Keep the end-to-end assertions in `scripts/check-ui.mjs` aligned with this guide. Run `pnpm test:ui` when Chromium and `agent-browser` are available; use a scratch database only.

The backend and standalone CLI are separate keyboard-free agent surfaces that use the same typed command path and SQLite workspace. `task.list` accepts `sort: "manual"`; `task.reorder` accepts an explicit `tasks` list with expected versions and one `beforeId`, `afterId`, `first`, or `last` placement. UI focus does not replace those interfaces, and UI-only behavior must not introduce duplicate task or storage rules.
