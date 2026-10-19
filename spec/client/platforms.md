# Platforms

This is the only place platform differences are listed. Everything else in the client spec applies everywhere.

## Desktop, Android and web

Android runs the desktop app's UI and the same backend, bundled in the app.

| Rule | Desktop | Android | Web |
| --- | --- | --- | --- |
| `platform.open-workspace` | Opens the remembered task folder. The first launch asks for one: a new folder starts empty, an existing task folder opens, and a folder from the old version is refused until it is converted. Each folder's cache lives in the app data folder | As desktop. The task folder is a path on shared storage (suggested: `Documents/Tasks`) so Syncthing can sync it, which needs all files access; the app asks for it on launch. The cache stays in the app's private storage | A folder the dev server copied (the fixture, or the kept copy of the owner's real folder) opens directly. A folder picked by hand is shown and confirmed in the window before anything loads |
| `platform.global-focus` | A configurable global shortcut brings the window forward. On Omarchy/Hyprland, Settings shows the binding to copy | Not available | Not available |
| `platform.keyboard-help` | Keyboard help starts at Full | Keyboard help starts at None, since a phone has no keyboard to hint at. Settings can still turn it on | As desktop |
| `platform.keyboard-bar` | No bar | While the editor is open, a bar on top of the soft keyboard has `@`, `#`, `Shift+Tab`, `Tab` and the four arrows. Each acts like that key in the field with focus, and the keyboard stays open. `@` and `#` from priority go to the title. Up and down move between suggestions in the title and between lines in the description | As desktop |
| `platform.toolbar-cell` | Toolbar cells are 28px with a mouse | Cells are 32px for touch | Cells follow the primary pointer: 28px for a mouse, 32px for touch |
| `platform.launch-time` | Launch time is measured from the app process start | As desktop | Not shown |
| `platform.prefs-scope` | Preferences belong to the app profile | As desktop | Preferences belong to the browser origin (scheme, host, port) and browser profile |

## Not yet built

| Missing | Today instead |
| --- | --- |
| Global focus shortcut on the current engine | Not registered (deferred, owner 2026-10-16) |
