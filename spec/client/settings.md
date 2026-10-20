# Settings

## Dialog

| Rule | When | Then |
| --- | --- | --- |
| `settings.open` | `Ctrl/⌘+,` or the header button | Settings opens with focus on its tabs: General and Data. Theme selection is only in the dedicated theme picker, not Settings |
| `settings.tabs` | `Left` / `Right` on the tabs | Switches section. `Tab` enters the section's first control, `Shift+Tab` returns |
| `settings.close` | `Escape` | Closes and returns focus to where it was opened |

## General

| Rule | When | Then |
| --- | --- | --- |
| `theme.select` | Choosing a theme in the dedicated theme picker | Applies one of the built-in themes at once and remembers it |
| `theme.picker` | `Alt+T`, Themes in the header or help palette | Opens the shared theme ring on the current palette. Arrows, drag or scroll browse; typing filters. Enter or clicking the front card confirms; browsing leaves the page unchanged. Escape clears a filter before closing and focus returns to the opener. No plain T or D theme shortcut |
| `font.size` | The font size slider | Default, +10%, +25%, +33% or +40%. Applies at once and is remembered |
| `help.mode` | Keyboard help display | Full shows all hints, Basic only filter and sort hints, None hides automatic hints |
| `help.starter` | `?` | The starter help panel opens on the right |
| `help.palette` | `Ctrl/⌘+K` | A searchable palette lists every shortcut and the shorthand syntax |

## Data

| Rule | When | Then |
| --- | --- | --- |
| `backup.create` | Create backup | Copies the workspace folder to a new path. The destination must be empty or absent, outside the workspace, with an existing parent |
| `backup.restore` | Restore to new folder | Copies a backup into a new folder. The current workspace is untouched; the new folder must be opened separately |
| `backup.confirm` | Either action | Shows source and destination, then asks for a separate confirmation |
| `backup.contents` | Any copy | Includes tasks and conflict originals. The local cache and undo history are not copied |

## Preferences

| Rule | When | Then |
| --- | --- | --- |
| `prefs.remembered` | Theme, font size, help mode, Details, filters, search, sort | Saved locally and restored on the next launch |
| `prefs.not-authority` | Any saved preference | Never picks a workspace or grants write access. Opening a workspace is always explicit |
