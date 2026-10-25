# Development and validation

[PLAN.md](../PLAN.md) owns work order and gates. [Current support](support.md) owns the live client/platform matrix; [the client spec](../spec/client/README.md) owns keyboard, mouse and focus behavior. This guide covers development, not release acceptance.

## Architecture

The replacement route is:

```text
Established React App -> MainWorkspace -> selected transport -> gateway
Friendly CLI / JSON-lines CLI -------------------------------> gateway
                                                               -> domain rules
                                                               -> canonical JSON + local SQLite authority
```

The dev transport is an HTTP bridge to the Linux Node backend, not a browser storage engine. Windows native uses one bundled Node SEA through `JsonLineSession`. `WorkspaceSelection` confirms the selected Tasks home before opening `App`. `MainWorkspace` routes supported actions and refuses the rest.

`tasks-cli` requires `--home`, with verbs or with `--stdio` for JSON lines; there is no default home. (`--root` with `--database` selects a bare folder for tests and `pnpm migrate`.) `pnpm dev:web` without `--home` runs on a fresh copy of the fixture. Do not relabel browser checks as native acceptance.

Keep domain rules independent of React, Tauri and transport. The gateway owns validation, command execution and storage effects; clients own presentation and immutable request preparation. Reuse the existing UI instead of another workbench or a generic adapter/writer framework.

## Prerequisites

Node is pinned to **24.22.1** in `package.json` under `devEngines.runtime`; pnpm is pinned by `packageManager`. Install the project runtime and dependencies with:

```bash
pnpm install --frozen-lockfile
pnpm exec node --version
```

`pn` is the Vite+ alias for pnpm. Both run project scripts with the pinned Node, even if a different Node is first on `PATH`. Vite+ also reads this pin. pnpm may keep its own runtime copy; leave runtime management enabled here so scripts do not depend on shell setup. Global defaults and other projects are unchanged.

To deliberately upgrade Node, update `devEngines.runtime.version`, run `pnpm install` to refresh the runtime lock, and rerun validation. The first Android build for that version recompiles Node; later builds reuse it.

Native development additionally needs [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/). Windows is the first release platform; native validation is deferred to the owner's host. Linux/WSL backend success is not a desktop acceptance pass.

## Linux development on disposable data

Start the established UI on the replacement backend:

```bash
scratch=$(mktemp -d)
cp -R scripts/fixtures/workspace/root "$scratch/sync" && mkdir "$scratch/local"
printf 'Disposable Tasks home: %s\n' "$scratch"
pnpm dev:web --home "$scratch"
```

Confirm the displayed home before querying. Reload requires confirmation again. Preferences and undo records are saved in the home, as in the native app; they do not preserve selection or unresolved requests.

Vite flags go after `--`, for example `-- --port 5199`. The backend defaults to `127.0.0.1:5174`; `TASKS_DEV_BACKEND_PORT` changes its port. `pnpm dev:backend` runs only the bridge. `pnpm dev` runs only Vite; `VITE_DEV_BACKEND_URL` selects a separately started bridge. The development listener and per-process selection token are not a production hosting or filesystem security boundary.

## Validation

| Command | Scope |
| --- | --- |
| `pnpm check` | `vp check`: formatting, type-aware lint and types for backend and frontend |
| `pnpm lint` | `vp lint`, naming and spec-rule checks, and knip for dead code |
| `pnpm test` | File-backed backend regressions, then client tests (`vp test`, jsdom) that render the app over a disposable workspace and cite client rules; not native acceptance |
| `pnpm build` | Types, backend and frontend build |
| `pnpm build:test` | Prepare `test-dist`, the backend build tests run from, for focused script tests |
| `pnpm test:sidecar` | Bundled Node SEA smoke check on the actual host |
| `pnpm test:ui` | UI Chromium regression over the dev bridge on disposable data |
| `node --test scripts/mainClientRouting.test.mjs scripts/appearancePreferences.test.mjs` | Client routing and stored appearance checks |

`pnpm build` builds the backend before Vite clears `dist/`. Tests run from their own `test-dist` build, so they never replace the `dist/backend` a running dev server uses; run `pnpm build:test` before focused scripts that import it. `pnpm test` prepares its own build. Browser runners require `agent-browser` and runnable Chromium. Record missing tools/libraries as blockers, not passes. [Evidence](evidence/README.md) retains process/native reports and their original limits.

Vite pre-optimizes the checkbox dependency to avoid a late dependency reload dropping in-memory requests. HMR, source edits, browser/native close and crashes can still lose drafts and uncertain requests. Do not reload during unresolved work.

## UI work

- Start UI checks from the task list. Wait for initial focus: `[role="listbox"]` with tasks, `[aria-label="Saved tasks"]` when empty. Never assume the New task button or an editor has focus.
- Drive the keyboard path first, then check the mouse path. A shortcut-only feature is incomplete.
- Buttons are mouse fallbacks with `tabIndex=-1`; clicking them must not take focus (mousedown default prevented). Don't add `autoFocus` to fix initial focus; it belongs in the list lifecycle after the first query renders.
- `src/components/TaskList.tsx` owns list focus, toolbar modes and home shortcuts. `src/navigation.ts` owns list entry and focus-steal prevention. The focus stack owns dialog return targets.
- Add every new keyboard action to `src/components/HelpPalette.tsx` and to the [client spec](../spec/client/README.md), with a rule slug a test can cite. Client tests live in `src/spec/`, one file per client spec page, using `src/testing/appWorkspace.tsx`.
- Refreshes come from the shared workspace revision and must keep focus and unsaved editor text.

## Desktop development

Build on the machine the app runs on, from a local checkout (on Windows an NTFS checkout, not WSL-mounted files). Install Node, pnpm, Rust (MSVC toolchain on Windows), and the Tauri prerequisites (on Windows the C++ Build Tools and WebView2). Do not install or repair owner-host dependencies without permission.

- `pnpm dev:native` builds the sidecar if needed and runs `tauri dev` with hot reload.
- `pnpm build:tauri` builds the sidecar and the release app. The app is `src-tauri/target/release/tasks(.exe)`; installers land in `src-tauri/target/release/bundle/`.

The app opens the remembered Tasks home. Everything it keeps lives in that home (settings, `sync/`, and `local/` with its cache `app.db`, the writer lock, recovery files and undo records); the app's own config folder (`%APPDATA%\com.soleone.tasks` on Windows) holds only `home.json`, the pointer to the home, `.window-state.json`, the window's size and position, and the WebView's storage. The first launch asks to create a home (suggested: `Tasks` in the user folder, since Windows `Documents` is often inside OneDrive) or open an existing one. The old version's tasks are converted outside the app with `pnpm migrate` ([runbook](migration.md)). Uninstalling never touches the home. The Windows uninstaller also keeps the app's own data when its "Delete the application data" box is ticked and says so (`src-tauri/windows/installer-hooks.nsh`); on Android, uninstalling drops only the private pointer, and a reinstall opens the home on shared storage again. Building is not release approval. See [Tauri shell notes](../src-tauri/README.md) for icons.

On Linux the Tauri entrypoint applies the WebKitGTK Wayland workaround. A browser or WSLg session does not establish Omarchy desktop support. Global focus is deferred; the old implementation is in git (`src/platform/globalShortcut.ts` before the legacy removal). Separately approve native work before pursuing it.

## Android

The Android app is the desktop UI with the same backend. Node publishes no Android builds, so `pnpm build:android` compiles Node for Android once (about half an hour, cached in `~/.cache/tasks-android`), bakes the backend bundle into it and ships it as `libtasks_backend.so`. Android only runs executables from the app's native library folder, which is why it has a library name. The Rust shell starts it per Tasks home (`src-tauri/src/android_backend.rs`).

Setup on Linux or WSL: a JDK 17+ in `JAVA_HOME`, the Android command-line tools in `~/Android/Sdk` (or `ANDROID_HOME`) with `platform-tools`, `platforms;android-36`, `build-tools;35.0.0` and an NDK (`ndk;27.3.13750724`), and `rustup target add aarch64-linux-android`. Then:

Release APKs are signed with your own key, so each build installs over the last. Create the key once, in a private place, and enter the passwords when `keytool` asks (never on the command line):

```bash
keytool -genkeypair -v -keystore "$HOME/.android/tasks-release.jks" \
  -alias tasks-release -keyalg RSA -keysize 4096 -validity 10000
```

Then create `src-tauri/gen/android/keystore.properties` (ignored by git) with `storeFile` (absolute, or relative to `src-tauri/gen/android/app`), `storePassword`, `keyAlias` and `keyPassword`, and `chmod 600` it. Back the keystore up somewhere safe: an APK signed with a different key won't install over the old one. Then:

```bash
pnpm build:android
```

The script verifies the signature with `apksigner` and prints the APK path (`src-tauri/gen/android/app/build/outputs/apk/universal/release/`). It targets arm64 phones on Android 11 or later. On first launch the app asks for all files access, because the Tasks home is a plain path on shared storage (suggested: `/storage/emulated/0/Tasks`) that the backend and Syncthing both use. Its cache, lock and recovery files live in the home's `local/`; add only `sync/` to Syncthing.

WSL has no emulator (no KVM). An emulator runs on the Windows side: the SDK is in `%LOCALAPPDATA%\Android\Sdk`, with the AVD `medium_phone` on the Google APIs image, so `adb` needs no on-screen approval. Start it with `emulator.exe -avd medium_phone -no-window`, and call `adb.exe` from WSL. It translates arm64, so the release APK and the arm64 Node build run on it, slowly.

## Storage and retry safety

The rules are in [spec/backend/safety.md](../spec/backend/safety.md). In practice: never delete or sync the SQLite cache, keep the original root, cache and profile together during uncertain work, keep task content out of shell commands and logs, and never open the Windows database from WSL.
