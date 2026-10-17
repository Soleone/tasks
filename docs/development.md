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

The dev transport is an HTTP bridge to the Linux Node backend, not a browser storage engine. Windows native uses one bundled Node SEA through `JsonLineSession`. `WorkspaceSelection` confirms the selected root, cache and profile before opening `App`. `MainWorkspace` routes supported actions and refuses the rest.

`pnpm dev:web`, `tasks-cli` and `tasks-backend` require `--root`; there is no default workspace. Do not relabel browser checks as native acceptance.

Keep domain rules independent of React, Tauri and transport. The gateway owns validation, command execution and storage effects; clients own presentation and immutable request preparation. Reuse the existing UI instead of another workbench or a generic adapter/writer framework.

## Prerequisites

Use Node with `node:sqlite` support and the repository's pinned pnpm:

```bash
corepack enable
corepack prepare pnpm@11.22.0 --activate
pnpm install --frozen-lockfile
```

Native development additionally needs [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/). Windows is the first release platform; native validation is deferred to the owner's host. Linux/WSL backend success is not a desktop acceptance pass.

## Linux development on disposable data

Start the established UI on the replacement backend:

```bash
scratch=$(mktemp -d)
cp -R scripts/fixtures/workspace/root "$scratch/root"
printf 'Disposable workspace: %s\n' "$scratch"
XDG_DATA_HOME="$scratch/profile" pnpm dev:web \
  --root "$scratch/root" --database "$scratch/cache.db"
```

Confirm the displayed root/cache/profile before querying. Reload requires confirmation again. Keep a stable browser origin and profile for display preferences; they do not preserve selection or unresolved requests.

Vite flags go after `--`, for example `-- --port 5199`. The backend defaults to `127.0.0.1:5174`; `TASKS_DEV_BACKEND_PORT` changes its port. `pnpm dev:backend` runs only the bridge. `pnpm dev` runs only Vite; `VITE_DEV_BACKEND_URL` selects a separately started bridge. The development listener and per-process selection token are not a production hosting or filesystem security boundary.

## Validation

| Command | Scope |
| --- | --- |
| `pnpm check` | `vp check`: formatting, type-aware lint and types for backend and frontend |
| `pnpm lint` | `vp lint`, naming and spec-rule checks, and knip for dead code |
| `pnpm test` | File-backed backend regressions, then client tests (`vp test`, jsdom) that render the app over a disposable workspace and cite client rules; not native acceptance |
| `pnpm build` | Types, backend and frontend build |
| `pnpm build:backend` | Prepare `dist/backend` for focused script tests |
| `pnpm test:sidecar` | Bundled Node SEA smoke check on the actual host |
| `pnpm test:ui` | UI Chromium regression over the dev bridge on disposable data |
| `node --test scripts/mainClientRouting.test.mjs scripts/appearancePreferences.test.mjs` | Client routing and stored appearance checks |

`pnpm build` builds the backend before Vite clears `dist/`; rebuild the backend before focused scripts that import it. `pnpm test` prepares its own build. Browser runners require `agent-browser` and runnable Chromium. Record missing tools/libraries as blockers, not passes. [Evidence](evidence/README.md) retains process/native reports and their original limits.

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

The app opens the remembered task folder and keeps one cache per folder in its app data folder (`%APPDATA%\com.soleone.tasks` on Windows, `~/.local/share/com.soleone.tasks` on Linux). The first launch asks for a folder. The old version's tasks are converted outside the app with `pnpm migrate` ([runbook](migration.md)). Building is not release approval. See [Tauri shell notes](../src-tauri/README.md) for icons.

On Linux the Tauri entrypoint applies the WebKitGTK Wayland workaround. A browser or WSLg session does not establish Omarchy desktop support. Global focus is deferred; the old implementation is in git (`src/platform/globalShortcut.ts` before the legacy removal). Separately approve native work before pursuing it.

## Android

The Android app is the desktop UI with the same backend. Node publishes no Android builds, so `pnpm build:android` compiles Node for Android once (about half an hour, cached in `~/.cache/tasks-android`), bakes the backend bundle into it and ships it as `libtasks_backend.so`. Android only runs executables from the app's native library folder, which is why it has a library name. The Rust shell starts it per task folder (`src-tauri/src/android_backend.rs`).

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

The script verifies the signature with `apksigner` and prints the APK path (`src-tauri/gen/android/app/build/outputs/apk/universal/release/`). It targets arm64 phones on Android 11 or later. On first launch the app asks for all files access, because the task folder is a plain path on shared storage that the backend and Syncthing both use. Keep the cache out of synced folders; the app keeps it in its private storage.

WSL has no emulator (no KVM). Install the APK on a phone, or use the emulator steps in git history (`f568d2b:AGENTS.md`).

## Storage and retry safety

The rules are in [spec/backend/safety.md](../spec/backend/safety.md). In practice: never delete or sync the SQLite cache, keep the original root, cache and profile together during uncertain work, keep task content out of shell commands and logs, and never open the Windows database from WSL.
