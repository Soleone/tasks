# Development and validation

Tasks has two useful development paths:

- `pnpm dev:web` runs Vite and a local HTTP bridge for fast UI iteration.
- `pnpm dev:tauri` runs the native Tauri shell and its packaged sidecar. This is the Windows desktop path.
- `pnpm dev:tauri:omarchy` runs the native Tauri shell on Omarchy with the required WebKitGTK Wayland workaround applied automatically.

The web bridge is local iteration tooling. It uses the same typed commands and SQLite storage as the sidecar, but it is not evidence of desktop or PWA support.

## Technical reference

The repository has one shared application path:

```text
React UI
  -> typed Tauri bridge
  -> thin Rust process/lifecycle boundary
  -> bundled Node sidecar (JSON lines over stdin/stdout)
       -> TypeScript commands and domain rules
       -> SQLite adapter and canonical JSON workspace

Standalone CLI -> the same TypeScript commands and storage adapters
```

Keep the boundaries concrete:

- **Domain/contracts** contain task rules, schemas, command/query types, and stable errors. They do not import Tauri, Node, the DOM, or SQLite.
- **Application/storage** owns validation, canonical-file reconciliation, SQLite transactions, migrations, queries, activity, and idempotency. It is the only layer that writes task data.
- **Adapters** handle UI transport, CLI arguments/JSON, and native lifecycle/file integration. They do not duplicate business rules.

The canonical JSON files are the inspectable source of current task state; SQLite is a local, rebuildable cache. See [Canonical workspace files](canonical-workspace.md) for the file layout, import/rebuild behavior, archives, and conflict resolution. Sync only that canonical root; never sync the database or its WAL files. See [Syncthing setup](syncthing.md) for multi-device setup.

### Command and reliability rules

- UI and CLI use versioned JSON envelopes with request IDs, actor/client identity, runtime validation, stable error codes, and deterministic bounded queries.
- Every mutation has an idempotency key; edits also require an expected version. Reusing a key with a different payload is an error, and stale versions are rejected rather than silently retried.
- A task change, activity entry, and successful receipt commit together. Dry runs and read-only requests persist nothing.
- SQLite uses foreign keys, short transactions, a bounded busy timeout, and WAL on local storage. Only one writer is expected at a time.
- The desktop keeps one long-lived sidecar. Correlate requests and handle malformed responses, timeouts, exit, shutdown, and restart visibly. Never replay an uncertain write without its original idempotency key.
- The native shell provides a configurable focus-only global shortcut through the Tauri global-shortcut plugin. Windows supports this. Linux support is X11-only with the current backend; native Wayland compositors such as Omarchy/Hyprland do not reliably deliver it, so an Omarchy bind or the desktop portal is still required there.
- The WSL wrapper invokes the Windows sidecar when the Windows app is running; WSL must not open the Windows database directly through `/mnt/c`.

### Data and recovery

The minimum task record has a UUID, title, Markdown description, status, optional priority/category, timestamps, completion state, and a local optimistic version. Activity has a monotonic sequence, actor/request provenance, and before/after changes. Receipts record successful idempotent mutations. Add planning dates, parent/dependency edges, and FTS indexes only as their milestone behavior ships.

Statuses are `open`, `in_progress`, `paused`, `done`, and `canceled`. Inbox, Today, overdue, deferred, and blocked are views, not statuses. Real mutations increment the version; repeated state transitions are no-ops. Parent and dependency cycles are rejected transactionally, and cancellation does not silently remove history or relationships.

Classification is derived from task text: at most one `@category` and any number of `#tags`, with Markdown/code/URL false positives excluded. Derived category/tag records are reconciled in the same transaction as the task change.

Use the SQLite backup API or `VACUUM INTO` for live-database backups; never copy only the main file from a WAL database. Validate snapshots in a new location before switching workspaces. Lossless JSON snapshots preserve canonical records, relationships, history, and receipts; portable task exports are intentionally smaller and readable. Migration and restore must fail without making the previous workspace unusable.

### Safety boundaries

Task text and imported Markdown are untrusted input: sanitize or disable raw HTML, validate external link schemes, and never pass task content to a shell. Tauri exposes only the fixed sidecar and required native capabilities; there is no arbitrary SQL/shell interface or unauthenticated network listener. Local storage relies on OS permissions and is not encryption. Debug logs should not include task content by default.

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
| `pnpm build:sidecar` | Rebuild the target sidecar and `tasks-cli` binaries without running their probes. |
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

The built-in global shortcut is not considered supported on Omarchy's native Wayland session yet. Open Settings and copy the generated Omarchy binding into `~/.config/hypr/bindings.lua`. It uses `o.bind` with `focus` and `launch`, matching Tauri's lowercase Linux WM_CLASS (`tasks`) rather than the reverse-DNS application identifier, so the shortcut focuses the existing Tasks window and launches it only when no matching window exists. Reload Hyprland after saving the file.

```bash
pnpm check
pnpm test
pnpm test:sidecar
pnpm dev:tauri:omarchy
```

`pnpm build:tauri` creates the MSI and NSIS installer after the development launch works. On Omarchy, the same build creates the Linux release binary and bundles; run the binary directly with `./src-tauri/target/release/tasks`, or launch the AppImage after it is built. The Linux binary applies the WebKitGTK compatibility setting internally, so no environment variable is required. The packaged sidecar is generated under `src-tauri/binaries/` and is intentionally ignored by Git. See [the Tauri shell notes](../src-tauri/README.md) when rebuilding native icons.

The checked Windows host has WebView2. Other Windows machines still need the normal WebView2 and Tauri prerequisites.

## Android status

The Android feasibility work now has the desktop/mobile configuration split, a generated Android project, a Tasks-owned native SQLite bridge with fixed storage operations, a TypeScript mobile command slice for runtime probes, task listing, task creation, task editing and single/batch status transitions, classifications, workspace info, built-in themes, and portable task export through Android's document picker, an Android SAF folder picker that persists a selected tree URI, and a canonical JSON import bridge. When a folder is selected, Android rescans `workspace.json`, `tasks/`, and `order/` on startup, foreground refreshes, and workspace polling, then rebuilds its private cache when the canonical content changes. New Android task captures write their canonical task and sibling-order files back through SAF. Edits and status transitions also write updated task files through SAF. Before writing, Android records the intended file contents and original bytes in its private SQLite cache; after an interrupted write it verifies the selected folder and completes missing or partially written files before importing, refusing unrelated file edits instead of overwriting them. Importing a selected workspace into a device with unsynced local tasks is blocked by default rather than deleting those tasks; the receive flow (`workspace.receive.prepare`, `workspace.receive.status`, `workspace.receive.abort`) lets the user safely adopt a different workspace by backing up the private cache first, adopting it when the folder still matches, and restoring the backup on abort. While a receive is pending, every other command is blocked with `RECEIVE_PENDING`. SAF does not provide a multi-file atomic commit, so other devices may see an intermediate state before recovery. Android Settings shares font-size and keyboard-help preferences with desktop, offers document export and folder selection, and identifies global shortcuts and permanent cleanup as unavailable rather than exposing nonfunctional controls. Android now records and can undo the latest edit, status, move, dependency, reorder, or creation operation if affected task versions and sibling scopes still match; undo also rejects relationship cycles introduced by external changes. Undoing a creation deletes the task file through the same staged-write path, writing the corrected sibling order before removing the file so an interrupted undo never leaves a dangling order reference. A non-empty purge is not undoable and invalidates the previous undo, including during interrupted-write recovery; an empty purge leaves undo intact. `workspace.sync`, `workspace.rebuild`, `task.purgeCanceled`, `workspace.archive`, `workspace.backup`, and `workspace.conflict.list`/`resolve` are supported. `task.purgeCanceled` permanently deletes canceled tasks, re-parents their children to the root, and removes their dependencies, writing the deletions and updates through the staged-write path. `workspace.archive` and `workspace.backup` export a portable JSON copy of the canonical files or the private cache through the document picker. The Android home screen reports Syncthing conflict copies found during task refresh. `workspace.conflict.list` scans the selected SAF folder and reports them unresolved; Android does not resolve or delete them, so use a desktop or CLI client. `workspace.sync` reports the unresolved conflict count when a folder is selected. The separate status-undo commands and on-device acceptance are still open; `workspace.restore` is not applicable because the SAF folder is the source of truth and the receive flow handles adoption.

The host uses Node 26.9.0, pnpm 11.22.0, Rust 1.98.1, Tauri 2.11.5, JDK 21.0.2, Android SDK command-line tools 23.0, platform-tools 37.0.1, platform/build tools 36, and NDK 27.2.12479018. The four Android Rust targets are installed. Activate the mise-managed paths with `eval "$(mise env --shell bash)"`, then use `pnpm tauri android build --debug --apk -t aarch64` for an arm64 debug APK or `-t x86_64` for an emulator APK. No emulator or physical Android device is currently connected to this host. A Pixel 10a run provided initial on-device SAF read evidence for a 68-file workspace; see the [Android SAF performance record](android-saf-performance.md) for the measurement and its limits. Lifecycle, full native UI, on-device SQLite acceptance, larger workspaces, and other SAF providers remain open. Web and Linux desktop checks are not Android acceptance evidence.

## WSL and agent access

The `bin/tasks` wrapper lets an agent in WSL call the Windows sidecar and Windows database instead of opening the database through `/mnt/c`. Set `TASKS_WINDOWS_ROOT`, `TASKS_WINDOWS_SIDECAR`, or `TASKS_WINDOWS_DATABASE` when the default paths do not match the checkout.

The current M0 evidence includes Linux backend and sidecar probes, Windows tests and packaged sidecar checks, a native Windows 11 long-lived desktop probe, the WSL CLI bridge with the app open and closed, sidecar recovery, and Windows MSI/NSIS builds. Omarchy remains a later native target.

Do not treat a browser preview as native desktop validation, and do not treat WSL as an Omarchy/Linux desktop pass. Keep those boundaries explicit in test reports.
