# Usage and interaction guide

Tasks is a keyboard-first, not keyboard-only, app. The saved-task list is the home screen and the primary place to begin work. Every action must also have a mouse-accessible path in the UI, such as a button, menu item, inline control, or compact icon toolbar with an accessible label and tooltip. Mouse controls remain secondary, but they must be complete when a pointer is easier or keyboard access is unavailable.

Keep the interface minimal, sleek, and calm. Prefer small icon toolbars, progressive disclosure, and existing surfaces over large duplicate controls or dashboard clutter. A keyboard shortcut alone is not enough, and a mouse affordance should not require adding a noisy control to every row.

## Home-screen contract

- The first load opens with no dialog and moves focus to the task-list surface.
- When tasks exist, focus is on the `listbox`; the first visible task is the active row.
- An empty workspace focuses the `Saved tasks` list shell. From there, `C` opens capture.
- A load error focuses `Retry` until the first successful load can focus the list.
- Loading or refreshing tasks must not steal focus from the current task, an open editor, or another dialog.
- `New task` is an action beside the list, not the launch focus or a tab stop. `C`, the command palette, or the button can open it.

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
| `Tab` / `Shift+Tab` | Do nothing while the task list is focused; list focus stays put |
| `Escape` | Leave the list for the New task action |
| `Ctrl/⌘+K` | Open the searchable shortcuts and syntax palette |
| `Alt+T` | Open the theme picker |

Inside the task dialog, `Enter` saves from the title, `Tab` opens the optional description, `Ctrl/⌘+Enter` saves from either field, and `Escape` closes or steps back from the description. Create stays open after a successful save for rapid capture; editing closes back to the list. Dialogs return focus to the control or list that opened them.

Use `@category` and `#tags` in task text. The command palette explains the complete current shortcut and syntax surface, so update it when a keyboard action changes.

## For agents and contributors

Treat this document as the UI interaction contract when using browser automation, reviewing changes, or adding commands:

- Start UI checks from the task list. Do not assume the New task button is focused or that a dialog is already open.
- Wait for the initial focus contract: a populated workspace should have `document.activeElement` on `[role="listbox"]`; an empty workspace should focus `[aria-label="Saved tasks"]`.
- Prefer keyboard events for the primary path, but verify the equivalent mouse path for every action. A shortcut-only feature is incomplete.
- Do not add Tab navigation from the task list. The New task button is intentionally `tabIndex=-1`; use `C`, the command palette, or the button itself to open capture.
- Add a compact, discoverable mouse affordance when adding an action. Icon buttons need accessible labels and tooltips; use menus or progressive disclosure instead of duplicating controls across every row.
- Add a shortcut to `src/components/HelpPalette.tsx` when adding a keyboard-first action. Keep the list as the initiating surface.
- Keep focus ownership explicit. `src/components/TaskList.tsx` owns the home/list focus, `src/navigation.ts` owns explicit destinations such as list and New task, and the focus stack owns modal return targets.
- Do not add `autoFocus` to a secondary action to solve initial focus. Initial focus belongs in the list lifecycle, after the first query has rendered the correct empty, error, or populated state.
- Refreshes must preserve focus and unsaved dialog content. A new data result should update the active row without moving the user's focus unless the focused element no longer exists.
- Keep the end-to-end assertions in `scripts/check-ui.mjs` aligned with this guide. Run `pnpm test:ui` when Chromium and `agent-browser` are available; use a scratch database only.

The backend and standalone CLI are separate keyboard-free agent surfaces that use the same typed command path and SQLite workspace. UI focus does not replace those interfaces, and UI-only behavior must not introduce duplicate task or storage rules.
