# Client

The desktop, Android and web apps are one client. This folder describes what a person sees and presses. Platform differences live only in [platforms.md](platforms.md).

| File | Covers |
| --- | --- |
| [home.md](home.md) | Launch, focus, moving around, selection, reorder, details |
| [toolbar.md](toolbar.md) | Filters, search, sort and the count line |
| [capture-edit.md](capture-edit.md) | The inline editor, shorthand, the move and blocker pickers |
| [status-undo.md](status-undo.md) | Status, priority and effort shortcuts, batches, copy, undo and redo |
| [lenses.md](lenses.md) | Lenses: the list as one question, done today and due now |
| [goals.md](goals.md) | Goals per category, the done count's rings, logging a task already done |
| [settings.md](settings.md) | Settings, themes, the palette, font size and the Tasks home |
| [learning.md](learning.md) | Moves, hints, the Learn panel and progress |
| [platforms.md](platforms.md) | Desktop, Android and web differences |

## Principles

| Rule | Then |
| --- | --- |
| `client.list-home` | The task list is the home screen. There is no dashboard and no required workspace switching |
| `client.keyboard-first` | Every action has a keyboard path, and every keyboard action has a mouse path too |
| `client.calm` | Compact toolbars, menus and progressive disclosure. No controls repeated on every row |
| `client.focus-ring` | Keyboard focus on controls uses a solid 2px theme ring, without a translucent halo or extra outline. Composite controls have one ring around the keyboard stop, including filter/sort groups and search. The inline editor has none: its fields have no box and it keeps the active row's fill. Task lists, menu results and the theme picker keep their own active-item treatments |
| `client.no-tab-buttons` | Buttons are mouse fallbacks, not Tab stops. Each surface has one keyboard stop |
| `client.literal-text` | Titles and descriptions show exactly what is stored. Category and tags are shown separately |
| `client.feedback` | Feedback doesn't add lines that move the layout. Confirming something just done on a visible control, like a copy, toggle or status change, flashes a tooltip on that control, which hovering never opens. Results with no visible control, like shortcuts, undo or changes out of view, and failures show in a toast above any open dialog. Text appears inline only when it is something to read or act on: a field's error, a result with a path to open, a link |
| `client.crash` | A screen throws while rendering | The window says something went wrong and that the tasks are safe, with the error message, Reload and Send feedback. Send feedback opens the feedback dialog as a bug with the error and its stack filled in, to edit before sending |
| `client.tooltips` | A hover tooltip only names its control: it closes as soon as the pointer leaves the control, even toward the tooltip, and whenever the window loses focus or is hidden, so it never lingers after switching to another tab or app |

## Keymap

List keys work anywhere on the home screen while no field, editor or dialog has focus.

| Key | Action | Rule |
| --- | --- | --- |
| `C` | New task | `capture.open` |
| `Shift+C` | New child of the active task | `capture.child` |
| `L` | Log a task already done | `capture.log` |
| `Enter` | Edit the active task | `home.open-editor` |
| `Space` / `Shift+Space` | Status forward / back | `status.forward`, `status.back` |
| `P` | Pause or resume | `status.pause` |
| `Delete` | Cancel | `status.cancel` |
| `[` / `]` | Lower / higher priority | `priority.set` |
| `0`–`4` | Set priority P0–P4 | `priority.set` |
| `,` / `.` | Smaller / bigger effort | `effort.set` |
| `Ctrl/⌘+C` | Copy title, description and tags | `copy.text` |
| `Ctrl/⌘+Shift+C` | Copy the active task's newest image | `attach.copy` |
| `Ctrl/⌘+Z` | Undo this client's latest change | `undo.latest` |
| `Ctrl+Y` / `Ctrl/⌘+Shift+Z` | Redo this client's most recently undone change | `redo.latest` |
| `B` | Add or remove a blocker | `pick.blocker` |
| `M` | Move under another task, or remove the parent | `pick.parent` |
| `V` / `Shift+V` | Toggle details of the active task / of all tasks | `details.toggle-active`, `details.toggle-all` |
| `D` | Tasks done in the last 24 hours, or back to your list | `done.lens`, `lens.back` |
| `Shift+D` | Look further back for done tasks | `done.lens-window` |
| `!` | Tasks due today or late, or back to your list | `due.lens`, `lens.back` |
| `Up` `Down` `Home` `End` | Move the active row | `home.arrows`, `home.home-end` |
| `Left` / `Right` | Parent, collapse, expand, category | `home.left`, `home.right-expand`, `home.right-category` |
| `Shift+Up/Down/Home/End` | Extend the selection | `select.extend` |
| `Ctrl/⌘+Up/Down/Home/End` | Reorder the selection | `reorder.step`, `reorder.edge` |
| `F`, then a key | Filter (see toolbar) | `filter.mode` |
| `S`, then a key | Sort (see toolbar) | `sort.mode` |
| `@` / `#` | Category / tag picker | `filter.category`, `filter.tags` |
| `Ctrl/⌘+R`, inside either picker | Rename the highlighted category or tag | `filter.rename` |
| `/` | Search | `filter.search` |
| `Escape` | Close, go back, narrow the selection, then reset filters | `select.escape`, `filter.escape` |
| `?` | Learn panel | `learn.panel` |
| `Ctrl/⌘+K` | Shortcut and syntax palette | `help.palette` |
| `Ctrl/⌘+,` | Settings | `settings.open` |
| `Alt+T` | Theme picker | `theme.picker` |
| Global hotkeys (off until picked in Settings) | Bring the window forward from anywhere; the second also opens the New task editor | `platform.global-focus` |
