# Usage and interaction guide

Tasks is a keyboard-first, not keyboard-only, app. The saved-task list is the home screen and the primary place to begin work. Every action must also have a mouse-accessible path in the UI, such as a button, menu item, inline control, or compact icon toolbar with an accessible label and tooltip. Mouse controls remain secondary, but they must be complete when a pointer is easier or keyboard access is unavailable.

Keep the interface minimal, sleek, and calm. Prefer small icon toolbars, progressive disclosure, and existing surfaces over large duplicate controls or dashboard clutter. A keyboard shortcut alone is not enough, and a mouse affordance should not require adding a noisy control to every row.

## Home-screen contract

- The first load opens with no dialog and moves focus to the task-list surface.
- When tasks exist, focus is on the `listbox`; the first visible task is the active row.
- An empty workspace focuses the `Saved tasks` list shell. From there, `N` opens capture.
- A filtered empty workspace keeps a focusable task-list shell at roughly one task-row width and height, shows “No tasks match the current filters,” and offers a mouse-accessible Clear filters action. Clear filters is not a Tab destination because Escape resets filters from the list.
- A load error focuses `Retry` until the first successful load can focus the list.
- Loading or refreshing tasks must not steal focus from the current task, an open editor, or another dialog.
- `New task` is a backup action beside the list for mouse discovery and use. It is not the launch focus or a tab stop; `N` or the command palette is the primary keyboard path.

The list uses a single focus stop. Arrow keys move the active row and do not add a tab stop for every task. The active row is exposed through `aria-activedescendant` and `aria-selected`.

## Filter toolbar

One compact row above the list, in three groups in this order:

```text
[ Status ] [ Priority ] [ Category ] [ Tags ] [ Search ] [ Unblocked ] [ Created Updated Reverse ] [ Times ]
```

Unblocked is an existing extension after the plan's five dimensions. Each button shows its active value through its pressed state, label, and tooltip. A single muted line directly below the toolbar reports the filtered count, active qualifiers, and sort state, such as “12 active tasks, by updated, newest first”; omit filler like “Showing” and truncate rather than wrap. Every shortcut below has a mouse path through its menu or dialog.

- Status: Active means open, in progress, or paused. Inactive means done or canceled. The `canceled` spelling stays canonical.
- Priority: Highest through lowest. Every task defaults to P2. Color is supplemental; labels stay present.
- Category: the `@category` grouping. Single-select.
- Tags: `#tags` multi-select with AND semantics. In the picker, `Space` toggles the highlighted tag; `Enter` selects it first when none are selected, then closes; a `Clear tags` row empties the filter.
- Search: titles and descriptions. The query stays applied after the dialog closes.
- Sort: Created or Updated date, newest or oldest first. Updated/newest is the default. The field icons mirror the time footer: clock-3 is created, rotate-ccw-clock is updated.
- View: Times toggles the per-task time footer. Off by default; a display preference, not a filter, so `Escape` never clears it.

## Time footer

Hidden unless Times is on (`V`). One quiet final row in the full task view: the created date always, the updated date only when it falls on another day. Dates read Today, Yesterday, Sep 8 (this year), or Dec 10, 2025; hovering a date shows the full local timestamp with time.

## Keyboard shortcuts

These shortcuts work anywhere on the home screen, even when focus is not on the task list. Typing in title, description, search, or picker inputs disables them, as does any open dialog. Filter keys act only in filter mode (after `F`); sort keys only in sort mode (after `O`). A pending mode resets on timeout (2 seconds), `Escape`, blur, hiding, or modal transitions.

| Key | Action |
| --- | --- |
| `N` | Open the New task dialog |
| `Shift+N` | Open New task with the active task as parent |
| `Enter` | Edit the active task |
| `Space` | Move the active task forward: open to in progress, in progress or paused to done, done or canceled back to open |
| `P` | Pause an open or in-progress task, or resume a paused task to in progress. The palette entry runs the same action by mouse. |
| `Delete` | Immediately cancel the active task |
| `Ctrl/⌘+Z` | Undo the last task-list status change; also in the shortcuts palette. A newer status change replaces it, and the toast confirms the restore |
| `0` `1` `2` `3` `4` | Set the active task to P0 through P4 |
| `F` | Enter filter mode; the next key picks a filter |
| `F then S` | Switch between active and inactive task views (`A` works too) |
| `F then O` / `I` / `D` / `P` / `X` | Show only Open / In progress / Done / Paused / Canceled tasks |
| `F then 0`–`4` | Filter to P0 through P4; pressing the active number clears it |
| `F then U` | Toggle the unblocked-task view |
| `F then C` | Open the category filter |
| `F then T` | Open the tag filter |
| `/` | Open task search; works with or without a pending mode |
| `O` | Enter sort mode; the next key picks a sort |
| `O then C` | Sort by created date |
| `O then U` | Sort by updated date |
| `O then R` | Reverse the newest/oldest direction |
| `V` | Toggle the time footer |
| `B` | Add a blocker to the active task |
| `M` | Open the move picker, including Remove parent for nested tasks |
| `Up` / `Down` | Move through visible tasks |
| `Home` / `End` | Jump to the first or last visible task |
| `Left` / `Right` | Move to a parent or expand/collapse children |
| `Tab` / `Shift+Tab` | Do nothing while the task list is focused; list focus stays put |
| `Escape` | Exit a pending `F`/`O` mode, otherwise reset all filters; list focus stays put |
| `Ctrl/⌘+K` | Open the searchable shortcuts and syntax palette |
| `Alt+T` | Open the theme picker |

Inside the task dialog, `Tab` and `Shift+Tab` move through the title, optional description, and the single priority section. A non-empty title opens and focuses the description; an empty create title does not open the optional description. Focus the priority section itself, not an individual P0-P4 button, then press `0`-`4` or `←`/`→` to choose the task priority. Those number keys set the active task's priority on the list; behind `F` they filter instead. Action buttons are backup mouse controls, not Tab destinations; use `Enter` or `Ctrl/⌘+Enter` to save and `Escape` to close or step back from the description. The priority defaults to P2. Create stays open after a successful save for rapid capture; editing closes back to the list. Dialogs return focus to the control or list that opened them.

Use `@category` and `#tags` in task text. The command palette explains the complete current shortcut and syntax surface, so update it when a keyboard action changes.

## For agents and contributors

Treat this document as the UI interaction contract when using browser automation, reviewing changes, or adding commands:

- Start UI checks from the task list. Do not assume the New task button is focused or that a dialog is already open.
- Wait for the initial focus contract: a populated workspace should have `document.activeElement` on `[role="listbox"]`; an empty workspace should focus `[aria-label="Saved tasks"]`.
- Prefer keyboard events for the primary path, but verify the equivalent mouse path for every action. A shortcut-only feature is incomplete.
- Buttons are backup and discovery affordances. Trigger actions with their normal keyboard commands or field shortcuts; do not make buttons Tab destinations. The New task button is intentionally `tabIndex=-1` and remains available as a mouse fallback, as do the filter buttons and the individual dialog priority buttons. The dialog's priority section is its single keyboard focus stop.
- Clicking a toolbar button, the New task button, or a task status icon never moves DOM focus (the mousedown default is prevented), so the list keeps focus and arrow keys keep working. The header Help, Themes, and Settings buttons are outside the list and do take focus on click; dialogs opened from them return focus to the button.
- Do not add Tab navigation from the task list. `Tab`, `Shift+Tab`, and `Escape` leave focus on the list; use `N` or the command palette to open capture.
- Add a compact, discoverable mouse affordance when adding an action. Icon buttons need accessible labels and tooltips; use menus or progressive disclosure instead of duplicating controls across every row. The move picker puts its Remove parent action in a separate group above new-parent results when the task is nested.
- Add a shortcut to `src/components/HelpPalette.tsx` when adding a keyboard-first action. Keep the list as the initiating surface.
- Keep focus ownership explicit. `src/components/TaskList.tsx` owns the home/list focus and the window-level home shortcuts, `src/navigation.ts` owns explicit list entry plus the shared focus-steal prevention for backup controls, and the focus stack owns modal return targets.
- Do not add `autoFocus` to a secondary action to solve initial focus. Initial focus belongs in the list lifecycle, after the first query has rendered the correct empty, error, or populated state.
- Refreshes must preserve focus and unsaved dialog content. A new data result should update the active row without moving the user's focus unless the focused element no longer exists.
- Keep the end-to-end assertions in `scripts/check-ui.mjs` aligned with this guide. Run `pnpm test:ui` when Chromium and `agent-browser` are available; use a scratch database only.

The backend and standalone CLI are separate keyboard-free agent surfaces that use the same typed command path and SQLite workspace. UI focus does not replace those interfaces, and UI-only behavior must not introduce duplicate task or storage rules.
