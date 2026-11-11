# Tasks: plan

What's next and what's waiting. How the app behaves is in [the spec](spec/README.md); what shipped is in [CHANGELOG.md](CHANGELOG.md) and git. Each item needs its own go-ahead.

## Direction

A local-first, keyboard-first task list for one person working alongside agents: capture quickly, clarify, choose work, complete it, understand what changed. One Tauri 2 and React app with a bundled Node backend, shared by desktop (Windows, Omarchy Linux), Android and `tasks-cli`.

## Waiting on the owner

Native checks automation can't do:

- Experimental Apple Silicon macOS build: retest the welcome, save and completion animations and the remaining UI on a disposable home before calling it supported; see [the animation audit](docs/animation-compatibility.md). Intel and notarization are not included.
- Release acceptance: install a release with the native installers, and run the Linux AppImage on Omarchy.
- Desktop updates: an installed build finds, downloads and installs a newer release, on Windows, the Linux AppImage and macOS.
- Image paste and copy in each shell (WebView2, WebKitGTK, Android WebView). Add `tauri-plugin-clipboard-manager` only for a shell that fails.
- Windows: Open folder for the home and exports; uninstall and reinstall keep the home.
- Android: the gallery skips the home's images; the due-date strip fits above the keyboard; touch quest steps.
- iOS: start the "iOS test build" workflow, sideload its unsigned IPA (Sideloadly or AltStore with a free Apple ID, renewed every 7 days) and check that a home can be created at all, since the backend's file access from the page is untested on a device. Then the keyboard bar above the soft keyboard, the notch and home-indicator areas, Add image, Share image… and the home showing in Files.
- Global hotkeys on Omarchy: the Hyprland binds bring Tasks forward and open the New task editor; Update still restarts Tasks now that a second launch hands over to the running one.

## Open work

- Rebuild the Windows crash-recovery checks; crash recovery is tested on Linux only.
- Sign the Windows installer. Without an install-folder exception, Bitdefender adds about 850 ms to startup.
