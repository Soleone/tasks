# Platforms

This is the only place platform differences are listed. Everything else in the client spec applies everywhere.

## Desktop and web

| Rule | Desktop | Web |
| --- | --- | --- |
| `platform.open-workspace` | Opens the remembered task folder. The first launch asks for one: a new folder starts empty, an existing task folder opens, and the old version's tasks can be imported into a new or empty folder. Each folder's cache lives in the app data folder | The dev server's folder, cache and profile are confirmed in the window before anything loads |
| `platform.global-focus` | A configurable global shortcut brings the window forward. On Omarchy/Hyprland, Settings shows the binding to copy | Not available |
| `platform.prefs-scope` | Preferences belong to the app profile | Preferences belong to the browser origin (scheme, host, port) and browser profile |

## Not yet built

| Missing | Today instead |
| --- | --- |
| Global focus shortcut on the current engine | Not registered (deferred, owner 2026-10-16) |

Android is dropped until it is ported to the current engine.
