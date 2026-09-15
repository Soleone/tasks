# Development and validation

Tasks has two useful development paths:

- `pnpm dev:web` runs Vite and a local HTTP bridge for fast UI iteration.
- `pnpm dev:tauri` runs the native Tauri shell and its packaged sidecar. This is the Windows desktop path.
- `pnpm dev:tauri:omarchy` runs the native Tauri shell on Omarchy with the required WebKitGTK Wayland workaround applied automatically.

The web bridge is local iteration tooling. It uses the same typed commands and SQLite storage as the sidecar, but it is not evidence of desktop or PWA support.

## Prerequisites

For the backend and web loop, install Node LTS with `node:sqlite` support and enable the repository's pinned pnpm version:

```bash
corepack enable
corepack prepare pnpm@11.22.0 --activate
pnpm install
```

The native shell additionally needs the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/). The primary native target is Windows 11. A Linux/WSL checkout is suitable for backend, packaging, and bridge checks, but it is not a native desktop acceptance environment.

## Commands

| Command | Purpose |
| --- | --- |
| `pnpm check` | Type-check the backend and web app. |
| `pnpm test` | Build the backend and run the file-backed SQLite tests. |
| `pnpm test:sidecar` | Build the target Node SEA sidecar and run it with a minimal environment. |
| `pnpm build:sidecar` | Rebuild the target sidecar without running its probe. |
| `pnpm test:ui` | Exercise the UI in Chromium against a temporary workspace. |
| `pnpm dev:web` | Run Vite and the dev-only local backend. |
| `pnpm dev:backend` | Run only the dev backend. |
| `pnpm dev:tauri` | Run the native Tauri shell on Windows, rebuilding the sidecar only when needed. |
| `pnpm dev:tauri:omarchy` | Run the native Tauri shell on Omarchy with the WebKitGTK workaround. |
| `pnpm build` | Check and build the web app and backend. |
| `pnpm build:tauri` | Build the sidecar, web app, and native release bundles. |

`pnpm test:ui` needs `agent-browser` and Linux Chromium. It covers keyboard and mouse paths, conflicts, persistence, responsive layouts, themes, exports, and accessibility checks. If those tools are unavailable, use `pnpm dev:web` for manual checks and record that native/browser automation was not run.

## Use a scratch workspace

The default web backend uses the application data directory. Point both the database and canonical root at a disposable checkout-local directory when experimenting:

```bash
mkdir -p .tmp/tasks-dev
TASKS_DATABASE_PATH="$PWD/.tmp/tasks-dev/tasks.db" \
TASKS_SYNC_ROOT="$PWD/.tmp/tasks-dev/sync" \
pnpm dev:web
```

In PowerShell:

```powershell
New-Item -ItemType Directory -Force .tmp\tasks-dev | Out-Null
$env:TASKS_DATABASE_PATH = "$PWD\.tmp\tasks-dev\tasks.db"
$env:TASKS_SYNC_ROOT = "$PWD\.tmp\tasks-dev\sync"
pnpm dev:web
```

The dev backend binds to `127.0.0.1`. Its default port is `5174`; set `TASKS_DEV_BACKEND_PORT` to change it. Vite arguments can be passed after `--`, for example `pnpm dev:web -- --port 5199`. `pnpm dev` starts Vite without a backend; set `VITE_DEV_BACKEND_URL` when connecting it to a separately started bridge. The bridge only accepts local-page origins and is never packaged.

The theme preview is served at `http://127.0.0.1:5173/themes.html` while `pnpm dev:web` is running. It reads the same built-in and workspace theme files but does not persist a selection.

## Windows 11

Use a Windows filesystem checkout for the native shell rather than launching Tauri from the WSL path. From an elevated PowerShell, install Node LTS, Rustup, and the Visual Studio C++ workload and Windows SDK:

```powershell
winget install --id OpenJS.NodeJS.LTS -e
winget install --id Rustlang.Rustup -e
winget install --id Microsoft.VisualStudio.2022.BuildTools -e
```

Then, in the Windows checkout:

```powershell
corepack enable
corepack prepare pnpm@11.22.0 --activate
rustup default stable-msvc
pnpm install
pnpm check
pnpm test
pnpm test:sidecar
pnpm dev:tauri
```

On Omarchy, use the named command; the Linux binary applies the WebKitGTK compatibility setting before starting the webview:

```bash
pnpm check
pnpm test
pnpm test:sidecar
pnpm dev:tauri:omarchy
```

`pnpm build:tauri` creates the MSI and NSIS installer after the development launch works. On Omarchy, the same build creates the Linux release binary and bundles; run the binary directly with `./src-tauri/target/release/tasks`, or launch the AppImage after it is built. The Linux binary applies the WebKitGTK compatibility setting internally, so no environment variable is required. The packaged sidecar is generated under `src-tauri/binaries/` and is intentionally ignored by Git. See [the Tauri shell notes](../src-tauri/README.md) when rebuilding native icons.

The checked Windows host has WebView2. Other Windows machines still need the normal WebView2 and Tauri prerequisites.

## WSL and agent access

The `bin/tasks` wrapper lets an agent in WSL call the Windows sidecar and Windows database instead of opening the database through `/mnt/c`. Set `TASKS_WINDOWS_ROOT`, `TASKS_WINDOWS_SIDECAR`, or `TASKS_WINDOWS_DATABASE` when the default paths do not match the checkout.

The current M0 evidence includes Linux backend and sidecar probes, Windows tests and packaged sidecar checks, a native Windows 11 long-lived desktop probe, the WSL CLI bridge with the app open and closed, sidecar recovery, and Windows MSI/NSIS builds. Omarchy remains a later native target.

Do not treat a browser preview as native desktop validation, and do not treat WSL as an Omarchy/Linux desktop pass. Keep those boundaries explicit in test reports.
