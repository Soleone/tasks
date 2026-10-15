# Platforms

This is the only place platform differences are listed. Everything else in the client spec applies everywhere.

## Desktop and web

| Rule | Desktop | Web |
| --- | --- | --- |
| `platform.open-workspace` | The workspace folder, cache and profile are confirmed in the window before anything loads | Same, with paths on the machine running the dev server |
| `platform.global-focus` | A configurable global shortcut brings the window forward. On Omarchy/Hyprland, Settings shows the binding to copy | Not available |
| `platform.prefs-scope` | Preferences belong to the app profile | Preferences belong to the browser origin (scheme, host, port) and browser profile |

## Not yet on Windows

Until these close, Windows is not at parity and the old runtime stays.

| Missing on Windows | Today instead |
| --- | --- |
| Child capture, move picker, blocker picker | Existing links show but can't change |
| Reorder | Refused |
| Status batches | Refused |
| Undo beyond the latest single status change | `Ctrl/⌘+Z` restores only the latest status change |
| Backup and restore from Settings | Available through the CLI only |
| Global focus shortcut | Not registered |
| Remembered preferences | Reset each launch while the launcher uses fresh WebView storage |
| Friendly CLI writes | Raw JSON-lines only |

Android is dropped until it is ported to the current engine.
