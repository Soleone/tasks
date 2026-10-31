# Tasks: plan

What's next and what's waiting. How the app behaves is in [the spec](spec/README.md); what shipped is in [CHANGELOG.md](CHANGELOG.md) and git. Each item needs its own go-ahead.

## Direction

A local-first, keyboard-first task list for one person working alongside agents: capture quickly, clarify, choose work, complete it, understand what changed. One Tauri 2 and React app with a bundled Node backend, shared by desktop (Windows, Omarchy Linux), Android and `tasks-cli`.

## Waiting on the owner

Native checks automation can't do:

- Experimental Apple Silicon macOS build: run the manual GitHub Actions workflow, install its ad-hoc-signed DMG and check the UI on a disposable home before calling it supported. Intel, notarization and Mac auto-updates are not included.
- Desktop updates: an installed build finds, downloads and installs a newer release, on Windows and the Linux AppImage.
- Image paste and copy in each shell (WebView2, WebKitGTK, Android WebView). Add `tauri-plugin-clipboard-manager` only for a shell that fails.
- Windows: Open folder for the home and exports; uninstall and reinstall keep the home.
- Android: the gallery skips the home's images; the due-date strip fits above the keyboard; touch quest steps.
- Global hotkeys: both bring Tasks forward from another app on Windows and open the New task editor; the Hyprland binds do the same on Omarchy; Update still restarts Tasks now that a second launch hands over to the running one.
- A real Syncthing exchange between two homes.
- Daily-use feedback, especially save speed and repeated keyboard reorder.

## Open work

- Rename categories and tags: designed in `$DATA/plans/2026-10-25-tasks-classification-rename.md`, not started.
- The status chip reads Active inside the due lens although paused tasks show.
- Done lens follow-ups: a once-a-day recap line, `tasks-cli done --today`, grouping Done by day.
- Rebuild the Windows crash-recovery checks; crash recovery is tested on Linux only.
- Sign the Windows installer. Without an install-folder exception, Bitdefender adds about 850 ms to startup.
- The web build's `mainWorkspace` chunk (about 600 kB) trips the size warning. Investigate if load time warrants it; don't raise the limit.
- `pnpm build:android` deletes a partial Node build on retry instead of resuming it.
