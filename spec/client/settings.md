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
| `settings.empty-canceled` | Empty canceled tasks in Data | Shows how many canceled tasks there are and how much space their images and unlisted images take, then asks before removing them for good (`task.purgeCanceled`). When other tasks link to canceled ones, it names them and removes nothing |
| `settings.clear-done` | Clear done tasks… in Data | A dialog picks an age (done more than 1 month, 3 months, 1 year ago, or all; 3 months first) and what to remove: Remove images only, or Remove tasks and images. Each choice shows its counts and size from a preview. Export and clear, Clear and Cancel close it; it says the removal can't be undone |
| `settings.clear-result` | A clear finishes | It says what was removed and how many tasks were kept because others link to them, and shows the export's path with Open folder (desktop) |
| `settings.home` | Data | Shows the Tasks home's path with Open folder (desktop) and its sync folder's path with Copy path, and warns to add only the sync folder to Syncthing, because syncing the home copies this device's database and locks |

## Preferences

| Rule | When | Then |
| --- | --- | --- |
| `prefs.remembered` | Theme, font size, help mode, Details, filters, search, sort | Saved locally and restored on the next launch |
| `prefs.not-authority` | Any saved preference | Never picks a workspace or grants write access. Opening a workspace is always explicit |
