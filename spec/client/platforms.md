# Platforms

This is the only place platform differences are listed. Everything else in the client spec applies everywhere.

## Desktop, Android and web

Android runs the desktop app's UI and the same backend, bundled in the app.

| Rule | Desktop | Android | Web |
| --- | --- | --- | --- |
| `platform.open-workspace` | Opens the remembered task folder. The first launch asks for one: a new folder starts empty, an existing task folder opens, and a folder from the old version is refused until it is converted. Each folder's cache lives in the app data folder | As desktop. The task folder is a path on shared storage (suggested: `Documents/Tasks`) so Syncthing can sync it, which needs all files access; the app asks for it on launch. The cache stays in the app's private storage | The dev server's folder, cache and profile are confirmed in the window before anything loads |
| `platform.global-focus` | A configurable global shortcut brings the window forward. On Omarchy/Hyprland, Settings shows the binding to copy | Not available | Not available |
| `platform.prefs-scope` | Preferences belong to the app profile | As desktop | Preferences belong to the browser origin (scheme, host, port) and browser profile |

## Not yet built

| Missing | Today instead |
| --- | --- |
| Global focus shortcut on the current engine | Not registered (deferred, owner 2026-10-16) |
