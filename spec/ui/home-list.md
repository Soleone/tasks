# Home list interaction

## Entry and focus

- A successful first load opens without a dialog and focuses the task-list surface.
- With tasks present, the listbox is the single Tab stop and the first visible task is active. The active row is exposed through `aria-activedescendant`; selected rows expose `aria-selected`.
- In an empty workspace, focus stays on the `Saved tasks` list shell. A filtered-empty state keeps a focusable shell, says no tasks match, and offers a mouse-accessible Clear filters action that is not a Tab stop. A load error focuses `Retry` until a successful load.
- The mouse-accessible New task action is secondary, not the initial focus or a Tab stop; capture uses the keyboard shortcut or command palette.
- Refresh never steals focus from an editor or dialog. The app preserves the active task when it remains visible.
- `Tab` and `Shift+Tab` do not traverse task rows. Arrow keys move the active row.

## Filters, views, and sort

The compact filter row includes category, status, priority, tags, unblocked, search, sort, and detail/move controls. The count line reports matching tasks and active filter qualifiers, not sort state. Each qualifier can be cleared independently by mouse. On the list, Escape first clears a multi-task selection; with no multi-selection, it resets filters.

Current semantics:

- Active means `open` or `in_progress`; inactive includes `paused`, `done`, and `canceled`.
- Category is a single-select title-derived `@category`; categories used only by canceled tasks are omitted.
- Tags use AND semantics; tags used only by canceled tasks are omitted.
- Search covers title and description. Unblocked excludes tasks with a non-canceled dependency.
- Sort supports created, updated, priority, and persistent manual sibling order. Created/newest is the default; P0 is highest priority.
- Details toggles descriptions and the timestamp footer; it is off by default. It is a display preference, not a filter.

Status and other filters do not sever hierarchy context. A matching child can show an excluded ancestor as a muted explanatory row; that row does not count toward the filtered total and remains expandable.

## Selection and ordering

The list supports single selection and visible sibling multi-selection by keyboard and pointer. Manual order is durable within each parent scope. Reorder stays within a visible sibling scope and is disabled when the current filter makes that scope ambiguous. Moving a root task carries its descendants; moving a child does not change its parent scope. Canceled and reopened tasks keep their position.

The move picker is a mouse-accessible path in addition to keyboard ordering. It is closed by default and appears below the toolbar without reflowing the page.

The full key map, filter focus modes, and responsive behavior are in the [usage guide](../../docs/usage-guide.md).