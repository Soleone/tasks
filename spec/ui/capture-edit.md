# Capture and edit interaction

## Capture

- `C` opens the inline New task editor from the list. `Shift+C` opens a child editor for the active task.
- The editor focuses its title field. A mouse-accessible New task action is available as a secondary path, not the initial focus.
- New tasks default to P2. Priority is chosen from one keyboard focus stop; number keys or arrow keys select a value.
- Title text supplies `@category` and `#tags`. The description is Markdown and does not affect classification.

## Editing

- `Enter` or clicking a task opens its inline editor. Editing replaces that row in place; capture places the editor above the list.
- `Tab` moves through title, priority, and the optional description. `Shift+Tab` reverses the sequence. Action buttons are mouse fallbacks, not extra Tab stops.
- `Enter` or `Ctrl/⌘+Enter` saves. `Escape` cancels; when the description is open, the first Escape returns to the title before a later Escape cancels.
- Save or cancel returns focus to the task list. A refresh must not discard unsaved text.

## Status and task details

The list supports forward and reverse status shortcuts, pause/resume, direct priority setting, and a mouse-accessible path for each action. `Delete` cancels the active task; it does not permanently erase it. Details are optional and reveal description and timestamps. Active blocker context remains visible even when details are hidden.

Status and priority transitions are defined in [Mutations](../mutations.md). The full keyboard and mouse behavior is in the [usage guide](../../docs/usage-guide.md).