# Platforms

This is the only place platform differences are listed. Everything else in the client spec applies everywhere.

## Desktop, Android and web

Android runs the desktop app's UI and the same backend, bundled in the app.

| Rule | Desktop | Android | Web |
| --- | --- | --- | --- |
| `platform.open-workspace` | Opens the remembered Tasks home; only a small pointer to it lives in the app's own storage. The first launch asks to create a home (suggested: `Tasks` in the user folder, outside OneDrive) or open an existing one, and shows the sync folder to add to Syncthing. A device with a task folder from before homes is offered to bring it into a new home (`home.adopt`). A missing home is reported with Retry, never replaced. A moved home asks before keeping its history; a copied one offers a new history | As desktop. The home is a path on shared storage (suggested: `/storage/emulated/0/Tasks`) so Syncthing can sync its `sync/` folder, which needs all files access; the app asks for it on launch | The dev server's home (a copy of the fixture, or the kept copy of the owner's real folder) opens directly. A home picked by hand is shown and confirmed in the window before anything loads |
| `platform.global-focus` | A configurable global shortcut brings the window forward. On Omarchy/Hyprland, Settings shows the binding to copy | Not available | Not available |
| `platform.keyboard-help` | Keyboard help starts at Full | Keyboard help starts at None, since a phone has no keyboard to hint at. Settings can still turn it on | As desktop |
| `platform.keyboard-bar` | No bar | While the editor is open, a bar above the soft keyboard has Esc at the far left, then `@`, `#`, Left and Right, with no Tab keys. Esc acts like physical Escape in the focused editor field. Markers insert once per tap; arrows move the text caret and repeat while held, stopping on release or cancellation. The bar never takes focus or navigates to priority. Markers and arrows from priority go to the title. Physical Tab navigation is unchanged | As desktop |
| `platform.toolbar-cell` | Toolbar cells are 28px with a mouse | Cells are 32px for touch | Cells follow the primary pointer: 28px for a mouse, 32px for touch |
| `platform.prefs-scope` | Preferences and undo records belong to the Tasks home and load before the list shows. A home without them takes this browser's earlier preferences, and the undo records made under the home's write context, once. The browser storage keeps a copy of the theme only so the first paint has the right colors. A preference that can't be saved says so | As desktop | As desktop, through the dev server's home |

## Not yet built

| Missing | Today instead |
| --- | --- |
| Global focus shortcut on the current engine | Not registered (deferred, owner 2026-10-16) |
