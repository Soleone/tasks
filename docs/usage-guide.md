# Usage and interaction guide

Tasks is a keyboard-first task app. The saved-task list is the home screen and the primary place to begin work. Mouse controls remain available when a pointer is easier or keyboard access is unavailable, but new UI should not make the user leave the list just to start an action.

## Home-screen contract

- The first load opens with no dialog and moves focus to the task-list surface.
- When tasks exist, focus is on the `listbox`; the first visible task is the active row.
- An empty workspace focuses the `Saved tasks` list shell. From there, `C` opens capture.
- A load error focuses `Retry` until the first successful load can focus the list.
- Loading or refreshing tasks must not steal focus from the current task, an open editor, or another dialog.
- `New task` is an action beside the list, not the launch focus. `C`, the command palette, or the button can open it.

The list uses a single focus stop. Arrow keys move the active row and do not add a tab stop for every task. The active row is exposed through `aria-activedescendant` and `aria-selected`.

## Keyboard shortcuts

These shortcuts assume focus is on the task list unless noted otherwise.

| Key | Action |
| --- | --- |
| `C` | Open the New task dialog |
| `Enter` | Edit the active task |
| `Space` | Cycle the active task through open, in progress, paused, and done |
| `Delete` | Open cancellation confirmation for the active task |
| `A` | Switch between active and inactive task views |
| `U` | Toggle the unblocked-task view |
| `B` | Add a blocker to the active task |
| `M` | Move the active task under another task |
| `Up` / `Down` | Move through visible tasks |
| `Home` / `End` | Jump to the first or last visible task |
| `Left` / `Right` | Move to a parent or expand/collapse children |
| `Tab` | Move from the list to Load more, when present, then to New task |
| `Shift+Tab` | Move backward through the list and New task stops |
| `Escape` | Leave the list for the New task action |
| `Ctrl/⌘+K` | Open the searchable shortcuts and syntax palette |
| `Alt+T` | Open the theme picker |

Inside the task dialog, `Enter` saves from the title, `Tab` opens the optional description, `Ctrl/⌘+Enter` saves from either field, and `Escape` closes or steps back from the description. Create stays open after a successful save for rapid capture; editing closes back to the list. Dialogs return focus to the control or list that opened them.

Use `@category` and `#tags` in task text. The command palette explains the complete current shortcut and syntax surface, so update it when a keyboard action changes.

## For agents and contributors

Treat this document as the UI interaction contract when using browser automation, reviewing changes, or adding commands:

- Start UI checks from the task list. Do not assume the New task button is focused or that a dialog is already open.
- Wait for the initial focus contract: a populated workspace should have `document.activeElement` on `[role="listbox"]`; an empty workspace should focus `[aria-label="Saved tasks"]`.
- Prefer keyboard events for the primary path. Use a mouse click only when testing pointer support or when the action is intentionally pointer-specific.
- Add a shortcut to `src/components/HelpPalette.tsx` when adding a keyboard-first action. Keep the list as the initiating surface.
- Keep focus ownership explicit. `src/components/TaskList.tsx` owns the home/list focus, `src/navigation.ts` owns linear stops such as list and New task, and the focus stack owns modal return targets.
- Do not add `autoFocus` to a secondary action to solve initial focus. Initial focus belongs in the list lifecycle, after the first query has rendered the correct empty, error, or populated state.
- Refreshes must preserve focus and unsaved dialog content. A new data result should update the active row without moving the user's focus unless the focused element no longer exists.
- Keep the end-to-end assertions in `scripts/check-ui.mjs` aligned with this guide. Run `pnpm test:ui` when Chromium and `agent-browser` are available; use a scratch database only.

The backend and standalone CLI are separate keyboard-free agent surfaces that use the same typed command path and SQLite workspace. UI focus does not replace those interfaces, and UI-only behavior must not introduce duplicate task or storage rules.
