# Platforms

This is the only place platform differences are listed. Everything else in the client spec applies everywhere.

## Desktop, Android and web

Android runs the desktop app's UI and the same backend, bundled in the app.

| Rule | Desktop | Android | Web |
| --- | --- | --- | --- |
| `platform.open-workspace` | Opens the remembered Tasks home; only a small pointer to it, and the window's size and position, live in the app's own storage. The first launch asks to create a home (suggested: `Tasks` in the user folder, outside OneDrive) or open an existing one, typed or chosen with Browse… in the system folder picker, and shows the sync folder to add to Syncthing. A missing home is reported with Retry, never replaced. Choosing another home from Settings can go back to the current one. Opening another home first finishes pending task changes and home saves, trying a failed save once more; while a task change is unfinished or unresolved, or a save or the close fails, it stays on this home and says why. A moved home asks before keeping its history; a copied one offers a new history | As desktop, but the home is typed: there is no Browse…. The home is a path on shared storage (suggested: `/storage/emulated/0/Tasks`) so Syncthing can sync its `sync/` folder, which needs all files access; the app asks for it on launch | The dev server's home (a copy of the fixture, or the kept copy of the owner's real folder) opens directly. A home picked by hand is shown and confirmed in the window before anything loads |
| `platform.copy-image` | Copies the image to the system clipboard | As desktop | As desktop where the browser allows writing images; otherwise says it can't |
| `platform.window-state` | The window reopens at its last size and position, maximized if it was. A position on a monitor that is gone is dropped and the system places the window | Not applicable | Not applicable |
| `platform.uninstall` | Uninstalling never touches the Tasks home. The Windows uninstaller also keeps the app's own data (the pointer to the home and the window's size and position) even when its delete box is ticked, and says so, so a reinstall opens the same home | Uninstalling removes only the app's private files, including the pointer; the home on shared storage stays, and a reinstall opens it again | Not applicable |
| `platform.global-focus` | A configurable global shortcut brings the window forward. On Omarchy/Hyprland, Settings shows the binding to copy | Not available | Not available |
| `platform.moves` | Keyboard moves: shortcuts and the editor's shorthand and `Tab` keys. A quest step done with the mouse counts but teaches the key (`quest.pointer`) | Touch moves: New task, saving, the status icon, tapping and long-pressing a task, Move under, Blockers, the header counts and the keyboard bar's `@`, `#` and `^`. Any path to a move learns it | As desktop |
| `platform.quest-card` | The quest card is docked below the list | The card sits under the header, so the soft keyboard never hides it | As desktop |
| `platform.keyboard-bar` | No bar | While the editor is open, a bar above the soft keyboard has Esc at the far left, then `@`, `#`, `^`, Left and Right, with no Tab keys. Esc acts like physical Escape in the focused editor field; when that closes the editor, the tap never reaches the list under it. Markers insert once per tap; arrows move the text caret and repeat while held, stopping on release or cancellation. The bar never takes focus. Markers and arrows from the image row go to the title. Physical Tab navigation is unchanged | As desktop |
| `platform.toolbar-cell` | Toolbar cells share a compact, consistent size | As desktop | As desktop, for mouse and touch |
| `platform.prefs-scope` | Preferences and undo records belong to the Tasks home and load before the list shows. A home without settings takes this browser's earlier preferences, once. The browser storage keeps a copy of the theme only so the first paint has the right colors. A preference that can't be saved says so | As desktop | As desktop, through the dev server's home |

## Not yet built

| Missing | Today instead |
| --- | --- |
| Global focus shortcut on the current engine | Not registered (deferred, owner 2026-10-16) |
