# Settings

## Dialog

| Rule | When | Then |
| --- | --- | --- |
| `settings.open` | `Ctrl/⌘+,` or the header button | Settings opens with focus on its tabs: General, Categories, Goals, Keys, Data and Cleanup. Theme selection is only in the dedicated theme picker, not Settings |
| `settings.tabs` | `Left` / `Right` on the tabs | Switches section without resizing: the dialog fits its tallest section. `Tab` or `Down` enters the section's first control, `Shift+Tab` returns. An arrow no control in the section uses moves nothing, neither focus nor a text caret |
| `settings.close` | `Escape` | Closes and returns focus to where it was opened |
| `settings.version` | Settings is open | Its footer shows the app version, e.g. Tasks 0.3.2, below every tab |
| `settings.feedback` | Send feedback in Settings' footer | A dialog takes Feedback or Bug, a title and a description, and says reports become public GitHub issues. Send files the issue through our feedback Worker, labeled `bug` or `enhancement` and signed with the app version and platform, without a GitHub account. It then shows the issue's link. A failed send keeps the report and says why |

## General

| Rule | When | Then |
| --- | --- | --- |
| `theme.select` | Choosing a theme in the dedicated theme picker | Applies a built-in or user theme at once and remembers it |
| `theme.user` | A palette file in the Tasks home's `themes/` folder: `<name>.toml`, or an Omarchy theme folder `<name>/colors.toml` | When the home opens, it joins the picker after the built-in themes, named from the file (`midnight-orchid` reads "Midnight Orchid"). The file uses Omarchy's `colors.toml` format and needs at least `background` and `foreground`; missing slots are derived. A file that isn't a usable theme is skipped and a toast names it. The folder sits beside `sync/`, so each device keeps its own. Changes show on the next launch |
| `theme.picker` | `Alt+T`, Themes in the header or help palette | Opens the shared theme ring on the current palette. Arrows, drag or scroll browse; typing filters. Enter or clicking the front card confirms; browsing leaves the page unchanged. Escape clears a filter before closing and focus returns to the opener. No plain T or D theme shortcut |
| `theme.favorites` | `!` or a card's star in the theme picker | Stars or unstars the theme without selecting it. Favorites are remembered on this device only. `@` or the star button beside Close toggles favorites-only; unstarring a filtered card removes it from the ring. Each opening resets to the full ring on the current theme |
| `font.size` | The font size slider | Default, +10%, +25%, +33% or +40%. Applies at once and is remembered |
| `help.palette` | `Ctrl/⌘+K` | A searchable palette lists every shortcut and the shorthand syntax |

## Categories

| Rule | When | Then |
| --- | --- | --- |
| `settings.category-colors` | Categories | Lists every category, most recently used first as in the category picker, each with its color: red, orange, yellow, cyan, blue, magenta, brown or none (the theme's green, as before). `Up` / `Down` move between categories and the focused one shows all its swatches; `Left` / `Right`, `Home` and `End` pick one at once. Typing a name jumps to that category; repeating a letter steps through the categories starting with it. Colors are stored by name in the workspace's shared settings (`home.shared-settings`), so every device shows them in its own theme. Renaming a category in the picker carries its color |
| `home.category-color` | A category with a color | Its folder icon takes the color on rows, in the editor and on the category filter chip. The name stays quiet text |

## Keys

Every shortcut on the list and in the app can take another key. The tab shows them in a scrolling list grouped as in the `Ctrl/⌘+K` palette, with a search over names and keys, a Changed only filter, the count of changed keys and Reset all keys. Changed keys are stored in the preferences (`prefs.remembered`), so each device keeps its own.

| Rule | When | Then |
| --- | --- | --- |
| `keys.rebind` | Clicking an action's key, then pressing a key | The pressed key, with any Ctrl/⌘, Alt or Shift, does that action at once, and the old key does nothing. Backspace turns the action's key off, Escape keeps it without closing Settings. A changed key shows a dot and a reset button that brings back its default |
| `keys.conflict` | Pressing a key another action already has | A note under the row names that action and keeps the old key. Swap gives the pressed key to this action and this action's old key to the other one; Cancel leaves both |
| `keys.fixed` | Pressing `↑` `↓` `←` `→`, `Home`, `End`, `Enter`, `Esc`, `Tab`, `Backspace`, the Menu key, `0`–`4` or `Ctrl+Y` | Says the key always keeps its own meaning and keeps the old one. These are listed under Always the same. The second key of a [filter or sort mode](toolbar.md) stays the same too; only the mode's own key changes |
| `keys.everywhere` | A changed key | The `Ctrl/⌘+K` palette, the filter and sort guides, tooltips, the Learn panel and quest steps name the key as it is now. An action whose key is off shows none. Plain keys (no Ctrl/⌘ or Alt) never act while typing in a field |

### From any app

Desktop only, above the list. Bring Tasks forward and New task work from any app once picked; both are off until then (`platform.global-focus`).

| Rule | When | Then |
| --- | --- | --- |
| `settings.hotkey-record` | Clicking a hotkey, then pressing keys | Ctrl, Alt or Super (Win on Windows, ⌘ on macOS) with a letter, digit, F-key or Space becomes the hotkey at once and is remembered. Backspace turns it off; Escape keeps the old one without closing Settings. While a hotkey is being pressed, both are off, so their keys reach the field |
| `settings.hotkey-refused` | Keys the system or another app holds, or the other hotkey uses | Says why and keeps the old hotkey |
| `settings.hotkey-hyprland` | Global hotkeys on Hyprland | Nothing is registered, since Hyprland keeps global keys for itself. The tab shows a `bind` line per hotkey that launches Tasks (`--new-task` for New task), with Copy binds, and the lines follow the hotkeys chosen |

## Data

| Rule | When | Then |
| --- | --- | --- |
| `settings.home` | Data | Shows the Tasks home's path with Open folder (desktop) and its sync folder's path with Copy path, and warns to add only the sync folder to Syncthing, because syncing the home copies this device's database and locks |
| `settings.export` | Export all tasks in Data | Saves a zip of the sync folder as it stands (tasks, images and shared settings; `workspace.export`) to the home's `exports/` and shows its path, with Open exports on desktop. Nothing in the workspace changes. A failure says why in a toast. In the hosted web build the button is in its own Tasks home section and the browser downloads the zip instead |
| `settings.agents` | Data, on desktop | An Agents section shows the path of the CLI that comes with the app, with Copy CLI path, and Copy agent instructions: a short block for an agent's own instructions file that names that path, points to `help` for the commands and says what the agent may touch. It names no home, since the CLI finds the app's (`cli.home`). On Windows, Copy for WSL gives the same block with the path as WSL sees it (`/mnt/c/…`). The section is missing where the build has no CLI |

## Cleanup

The Cleanup tab has one Delete tasks section with two items. Deletion controls are separate from the home and sync folder in Data.

| Rule | When | Then |
| --- | --- | --- |
| `settings.delete-canceled` | Delete canceled tasks | Says how many canceled tasks there are and asks before deleting them for good (`task.purgeCanceled`), with Cancel where the first button stood so a double click never deletes. When other tasks link to canceled ones, it names them and deletes nothing |
| `settings.delete-done` | Delete done tasks… | A dialog picks an age (done more than 1 month, 3 months, 1 year ago, or all; 3 months first) and what to delete: Images only, or Tasks and images. Each choice shows its counts and size from a preview. Delete (the destructive one), Export and delete and Cancel close it; it says deleting can't be undone |
| `settings.delete-result` | Deleting done tasks finishes | It says what was deleted and how many tasks were kept because others link to them, and shows the export's path with Open folder (desktop) |

## Preferences

| Rule | When | Then |
| --- | --- | --- |
| `prefs.remembered` | Theme, font size, hints and learned moves, Details, filters, search, sort, keys, global hotkeys | Saved locally and restored on the next launch |
| `prefs.not-authority` | Any saved preference | Never picks a workspace or grants write access. Opening a workspace is always explicit |
