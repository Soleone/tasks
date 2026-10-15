# Settings

## Dialog

| Rule | When | Then |
| --- | --- | --- |
| `settings.open` | `Ctrl/⌘+,` or the header button | Settings opens with focus on its tabs: General, Shortcuts, Data |
| `settings.tabs` | `Left` / `Right` on the tabs | Switches section. `Tab` enters the section's first control, `Shift+Tab` returns |
| `settings.close` | `Escape` | Closes and returns focus to where it was opened |

## General

| Rule | When | Then |
| --- | --- | --- |
| `theme.select` | Choosing a theme in General | Applies at once and is remembered |
| `theme.picker` | `Alt+T` | The theme picker opens directly |
| `font.size` | The font size slider | Default, +10%, +25%, +33% or +40%. Applies at once and is remembered |
| `help.mode` | Keyboard help display | Full shows all hints, Basic only filter and sort hints, None hides automatic hints |
| `help.starter` | `?` | The starter help panel opens on the right |
| `help.palette` | `Ctrl/⌘+K` | A searchable palette lists every shortcut and the shorthand syntax |

## Shortcuts

| Rule | When | Then |
| --- | --- | --- |
| `settings.global-shortcut` | Shortcuts tab | Shows and changes the global focus shortcut where the platform has one |

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
