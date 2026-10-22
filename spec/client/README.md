# Client

The desktop app and the web app are one client. This folder describes what a person sees and presses. Platform differences live only in [platforms.md](platforms.md).

| File | Covers |
| --- | --- |
| [home.md](home.md) | Launch, focus, moving around, selection, reorder, details |
| [toolbar.md](toolbar.md) | Filters, search, sort and the count line |
| [capture-edit.md](capture-edit.md) | The inline editor, shorthand, the move and blocker pickers |
| [status-undo.md](status-undo.md) | Status and priority shortcuts, batches, copy, undo and redo |
| [settings.md](settings.md) | Settings, themes, help, font size and the Tasks home |
| [platforms.md](platforms.md) | Desktop, web, Linux and Windows differences |

## Principles

| Rule | Then |
| --- | --- |
| `client.list-home` | The task list is the home screen. There is no dashboard and no required workspace switching |
| `client.keyboard-first` | Every action has a keyboard path, and every keyboard action has a mouse path too |
| `client.calm` | Compact toolbars, menus and progressive disclosure. No controls repeated on every row |
| `client.no-tab-buttons` | Buttons are mouse fallbacks, not Tab stops. Each surface has one keyboard stop |
| `client.literal-text` | Titles and descriptions show exactly what is stored. Category and tags are shown separately |

## Keymap

List keys work anywhere on the home screen while no field, editor or dialog has focus.

| Key | Action | Rule |
| --- | --- | --- |
| `C` | New task | `capture.open` |
| `Shift+C` | New child of the active task | `capture.child` |
| `Enter` | Edit the active task | `home.open-editor` |
| `Space` / `Shift+Space` | Status forward / back | `status.forward`, `status.back` |
| `P` | Pause or resume | `status.pause` |
| `Delete` | Cancel | `status.cancel` |
| `0`–`4` | Set priority P0–P4 | `priority.set` |
| `Ctrl/⌘+C` | Copy title, description and tags | `copy.text` |
| `Ctrl/⌘+Z` | Undo this client's latest change | `undo.latest` |
| `Ctrl+Y` / `Ctrl/⌘+Shift+Z` | Redo this client's most recently undone change | `redo.latest` |
| `B` | Add or remove a blocker | `pick.blocker` |
| `M` | Move under another task, or remove the parent | `pick.parent` |
| `V` / `Shift+V` | Toggle details of the active task / of all tasks | `details.toggle-active`, `details.toggle-all` |
| `Up` `Down` `Home` `End` | Move the active row | `home.arrows`, `home.home-end` |
| `Left` / `Right` | Parent, collapse, expand, category | `home.left`, `home.right-expand`, `home.right-category` |
| `Shift+Up/Down/Home/End` | Extend the selection | `select.extend` |
| `Ctrl/⌘+Up/Down/Home/End` | Reorder the selection | `reorder.step`, `reorder.edge` |
| `F`, then a key | Filter (see toolbar) | `filter.mode` |
| `S`, then a key | Sort (see toolbar) | `sort.mode` |
| `@` / `#` | Category / tag picker | `filter.category`, `filter.tags` |
| `/` | Search | `filter.search` |
| `Escape` | Close, go back, clear selection, then reset filters | `select.escape`, `filter.escape` |
| `?` | Starter help panel | `help.starter` |
| `Ctrl/⌘+K` | Shortcut and syntax palette | `help.palette` |
| `Ctrl/⌘+,` | Settings | `settings.open` |
| `Alt+T` | Theme picker | `theme.picker` |
| Global shortcut (default `Ctrl+Alt+Space`) | Bring the window forward from anywhere | `platform.global-focus` |
