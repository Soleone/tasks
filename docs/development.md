# Development and validation

[PLAN.md](../PLAN.md) owns what is next; [the client spec](../spec/client/README.md) owns keyboard, mouse and focus behavior. This guide covers development, not release acceptance.

## Architecture

The replacement route is:

```text
Established React App -> MainWorkspace -> selected transport -> gateway
Friendly CLI / JSON-lines CLI -------------------------------> gateway
                                                               -> domain rules
                                                               -> canonical JSON + local SQLite authority
```

The dev transport is an HTTP bridge to the Linux Node backend, not a browser storage engine. Windows native uses one bundled Node SEA through `JsonLineSession`. `WorkspaceSelection` confirms a hand-picked `--home` before opening `App`; fixture and kept development copies open directly. `MainWorkspace` routes supported actions and refuses the rest.

`tasks-cli` requires `--home`, with verbs or with `--stdio` for JSON lines; there is no default home. (`--root` with `--database` selects a bare folder for tests.) `pnpm dev:web` without `--home` runs on a fresh copy of the fixture. Do not relabel browser checks as native acceptance.

Keep domain rules independent of React, Tauri and transport. The gateway owns validation, command execution and storage effects; clients own presentation and immutable request preparation. Reuse the existing UI instead of another workbench or a generic adapter/writer framework.

## Prerequisites

Node is pinned to **24.22.1** in `package.json` under `devEngines.runtime`; pnpm is pinned by `packageManager`. Install the project runtime and dependencies with:

```bash
pnpm install --frozen-lockfile
pnpm exec node --version
```

`pn` is the Vite+ alias for pnpm. Both run project scripts with the pinned Node, even if a different Node is first on `PATH`. Vite+ also reads this pin. pnpm may keep its own runtime copy; leave runtime management enabled here so scripts do not depend on shell setup. Global defaults and other projects are unchanged.

To deliberately upgrade Node, update `devEngines.runtime.version`, run `pnpm install` to refresh the runtime lock, publish the matching Android runtime as described below, and rerun validation. Android builds reject a runtime pin that differs from the Node preparing the executable.

Native development additionally needs [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/). Windows is the first release platform and Omarchy the second; native validation is deferred to the owner's hosts. Linux/WSL backend success is not a desktop acceptance pass.

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
| `pnpm lint` | `vp lint`, spec-rule checks, and knip for dead code |
| `pnpm test` | File-backed backend regressions, then client tests (`vp test`, jsdom) that render the app over a disposable workspace and cite client rules; not native acceptance |
| `pnpm build` | Types, backend and frontend build |
| `pnpm build:test` | Prepare `test-dist`, the backend build tests run from, for focused script tests |
| `pnpm test:sidecar` | Bundled Node SEA smoke check on the actual host |
| `pnpm test:ui` | UI Chromium regression over the dev bridge on disposable data |
| `node --test scripts/mainClientRouting.test.mjs scripts/appearancePreferences.test.mjs` | Client routing and stored appearance checks |

On high-core hosts, use `VITEST_MAX_WORKERS=4 pnpm test` to bound client-test concurrency. The current Vitest fork pool emits stream-listener warnings with too many concurrent workers; limiting workers avoids those warnings without suppressing them. The Actions workflow uses the same limit.

`pnpm build` builds the backend before Vite clears `dist/`. Tests run from their own `test-dist` build, so they never replace the `dist/backend` a running dev server uses; run `pnpm build:test` before focused scripts that import it. `pnpm test` prepares its own build. Browser runners require `agent-browser` and runnable Chromium. Record missing tools/libraries as blockers, not passes. The [animation inventory and WebKit audit](animation-compatibility.md) lists every motion family and the remaining native Mac checks. [Evidence](evidence/README.md) retains process/native reports and their original limits.

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

The app opens the remembered Tasks home. Everything it keeps lives in that home (settings, `sync/`, and `local/` with its cache `app.db`, the writer lock, recovery files and undo records); the app's own config folder (`%APPDATA%\com.soleone.tasks` on Windows) holds only `home.json`, the pointer to the home, `.window-state.json`, the window's size and position, and the WebView's storage. The first launch asks to create a home (suggested: `Tasks` in the user folder, since Windows `Documents` is often inside OneDrive) or open an existing one. Uninstalling never touches the home. The Windows uninstaller also keeps the app's own data when its "Delete the application data" box is ticked and says so (`src-tauri/windows/installer-hooks.nsh`); on Android, uninstalling drops only the private pointer, and a reinstall opens the home on shared storage again. Building is not release approval. See [Tauri shell notes](../src-tauri/README.md) for icons.

On Linux the Tauri entrypoint applies the WebKitGTK Wayland workaround. The Linux release is an AppImage, now configured to build on Ubuntu 22.04 in Actions and still awaiting acceptance on Omarchy; started from anywhere, it writes its own app menu entry and icon under `~/.local/share` (`src-tauri/src/linux_launcher.rs`). If it refuses to start with a FUSE error, install `fuse2`. A browser or WSLg session does not establish Omarchy desktop support. Global hotkeys (`src-tauri/src/global_hotkeys.rs`) are registered by the app except on Hyprland, where the user binds keys that launch the AppImage again; the single-instance plugin hands that launch to the running window.

## Android

The Android app is the desktop UI with the same backend. Node publishes no official Android builds, so `pnpm build:android` downloads our own prebuilt runtime, verifies its archive and executable SHA-256 values against `scripts/android-runtime.json`, bakes the backend bundle into it and ships it as `libtasks_backend.so`. The verified executable is reused locally from `~/.cache/tasks-android`; a fresh runner downloads it without compiling Node. Android only runs executables from the app's native library folder, which is why it has a library name. The Rust shell starts it per Tasks home (`src-tauri/src/android_backend.rs`).

Setup on Linux or WSL: a JDK 17+ in `JAVA_HOME`, the Android command-line tools in `~/Android/Sdk` (or `ANDROID_HOME`) with `platform-tools`, `platforms;android-36`, `build-tools;35.0.0` and an NDK (`ndk;27.3.13750724`), and `rustup target add aarch64-linux-android`. Then:

Release APKs are signed with your own key, so each build installs over the last. It lives with the other [release secrets](#release-secrets) as `android.jks` and `android.properties`. To create it once, enter the passwords when `keytool` asks (never on the command line):

```bash
keytool -genkeypair -v -keystore "$DATA/secrets/tasks/android.jks" \
  -alias tasks-release -keyalg RSA -keysize 4096 -validity 10000
```

Then create `android.properties` beside it with `storeFile=android.jks`, `storePassword`, `keyAlias` and `keyPassword`, and `chmod 600` both. `build:android` passes its path to Gradle as `TASKS_ANDROID_SIGNING`. Then:

```bash
pnpm build:android
```

The script verifies the signature with `apksigner` and prints the APK path (`src-tauri/gen/android/app/build/outputs/apk/universal/release/`). It targets arm64 phones on Android 11 or later. On first launch the app asks for all files access, because the Tasks home is a plain path on shared storage (suggested: `/storage/emulated/0/Tasks`) that the backend and Syncthing both use. Its cache, lock and recovery files live in the home's `local/`; add only `sync/` to Syncthing.

WSL has no emulator (no KVM). An emulator runs on the Windows side: the SDK is in `%LOCALAPPDATA%\Android\Sdk`, with the AVD `medium_phone` on the Google APIs image, so `adb` needs no on-screen approval. Start it with `emulator.exe -avd medium_phone -no-window`, and call `adb.exe` from WSL. It translates arm64, so the release APK and the arm64 Node build run on it, slowly.

## Releasing

### macOS test builds on GitHub Actions

The manually triggered **macOS test build** workflow (`.github/workflows/macos-build.yml`) builds an experimental Apple Silicon DMG for macOS 13.5 or later (the bundled Node runtime's minimum), not a public GitHub release. It remains available for testing a branch without signing secrets or publishing. Tagged releases use the cross-platform workflow below.

Once the workflow is pushed to `main`:

1. Open the repository's **Actions → macOS test build → Run workflow** and select the branch to build. Or run `gh workflow run macos-build.yml --ref main`.
2. Actions installs the Node and pnpm versions pinned in `package.json`, then runs `pnpm check`, `pnpm lint` and `pnpm test` on Linux. The suite exercises the Linux-only development bridge, so it does not run on macOS.
3. A native Apple Silicon runner (`macos-15`) builds the app and DMG. It verifies the packaged app's signatures and architectures, then runs the bundled backend without Node on `PATH`, creating and searching a task in a disposable home.
4. When the run succeeds, download `tasks-macos-apple-silicon-<commit>` from its **Artifacts** section and extract the DMG. Artifacts expire after 14 days; rerun the workflow to rebuild.

The workflow does not bump versions, publish releases or change updater manifests. It needs no signing secrets. The app and backend use **ad-hoc signatures**, not an Apple Developer ID, and are **not notarized**. Hardened runtime stays enabled, with the JIT entitlement needed by the bundled Node backend (`src-tauri/entitlements.plist`). On a test Mac, open the DMG and drag Tasks to Applications. If macOS blocks it, attempt to open it, then allow Tasks in **System Settings → Privacy & Security → Open Anyway**. Only override Gatekeeper for a build you trust; do not disable it globally.

Start with a new disposable Tasks home, not your personal one. CI proves packaging and a backend smoke check, not that the Mac interface works. Manually check first launch, task creation/editing/completion, quit/reopen, keyboard shortcuts, global hotkeys, image paste/copy and folder reveal before treating it as supported. Intel Macs, notarization and macOS auto-updates are not part of this first build.

### One-command releases

Once `.github/workflows/release.yml` is on `main` and the Actions secrets below are configured:

```bash
pnpm release
# Equivalent: npm run release
```

Run on `main` with a clean tree and authenticated Git push access. The command asks for patch, minor or major, prepends the `feat`, `fix` and `perf` commits since the last tag to `CHANGELOG.md`, commits, tags `vX.Y.Z` and pushes. `pnpm release --dry-run` previews the local steps without pushing. The command finishes after the push; follow **Actions → Release** for build progress.

Actions validates that the tag matches `package.json`, checks signing secrets, then runs checks, lint and tests on Linux. Native jobs build these downloads in parallel:

| Platform | Runner | Download |
| --- | --- | --- |
| Windows x64 | Windows 2022 | NSIS setup `.exe` |
| Linux x64 | Ubuntu 22.04 | `.AppImage` |
| macOS Apple Silicon | macOS 15 | `.dmg` and updater `.app.tar.gz` |
| Android arm64 | Ubuntu 24.04 | Signed `.apk` |

The desktop jobs smoke-test the bundled backend on disposable data; the Mac job also verifies packaged signatures and architectures. Android verifies its APK signature.

Android downloads the versioned runtime dependency pinned in `scripts/android-runtime.json`. It is stored as an infrastructure **prerelease**, never the latest app release, and uses an `android-node-*` tag that does not trigger app releases. Both the compressed archive and executable are checksum-verified; a changed local cache is refused too. This dependency does not expire with Actions caches or build artifacts. Normal app releases never compile Node, and a missing download fails explicitly rather than starting an hour-long fallback build.

Only after every build succeeds does one publishing job assemble `latest.json`, create a draft GitHub release with the version's changelog notes, attach every installer, updater archive and signature, then publish. No per-platform release commands are needed. A failed build leaves the previous public release and updater manifest unchanged. Re-run failed jobs in Actions; a failed upload can resume its draft, but the workflow refuses to overwrite a published release. Build artifacts expire after 14 days, so re-run the full workflow if they have expired.

One version covers every platform. It lives in `package.json`; Tauri reads it from there and derives the Android `versionCode` from it. Only push `v*` tags from trusted commits: their workflows run with the signing secrets. The release command must push using your credentials, not an Actions `GITHUB_TOKEN`, whose pushes do not trigger another workflow.

Windows installers are not code signed yet, so SmartScreen warns on manual installation. Mac builds remain experimental, ad-hoc signed and unnotarized, with macOS 13.5 as the minimum; Gatekeeper can require **Open Anyway** as described above. Intel Macs and iOS are not built. Hosted Linux packaging still needs acceptance on Omarchy; successful CI is not native UI or update acceptance on any platform.

### Updating the Android runtime

Only a deliberate Node or runtime build change needs source compilation. The manually triggered **Build Android Node runtime** workflow (`.github/workflows/android-runtime.yml`) compiles the version pinned in `package.json` on `main`, without signing keys or an APK build, then publishes a checksum-addressed, non-latest runtime prerelease. This can take over an hour. It refuses to replace an existing dependency.

```bash
gh workflow run android-runtime.yml --ref main
```

When it succeeds, download that dependency's `android-runtime.json` and commit it as `scripts/android-runtime.json` before releasing the app. Pin selection is deliberate; the maintenance workflow does not move app tags or silently change which binary releases trust.

For a trusted local build, run `NDK_HOME=/path/to/ndk node scripts/build-android-node.mjs`, then `node scripts/package-android-runtime.mjs /path/to/compiled/node /tmp/runtime-assets`. The packaging command prints the checksum-addressed tag and creates the gzip archive plus `android-runtime.json`. Publish those files as a prerelease with `--latest=false` before committing the pin. The initial Node v24.22.1 dependency came from the owner's existing Android ARM64/API 28/NDK 27d build, with built-in SQLite and an unused SEA fuse.

### Updates

Installed desktop apps check `releases/latest/download/latest.json` on GitHub once per start and offer the newer version (`platform.update`). One manifest contains Windows x64, Linux x64 and Mac arm64 entries; the Mac updater downloads the `.app.tar.gz`, not the DMG. The earlier Mac test DMG has no published update entry until the first automated release exists. Android is installed manually from the signed APK.

On Windows the installer runs in update mode: no pages, no uninstall, and Tasks restarts. On Linux the AppImage replaces itself and the app relaunches. The update signing key and password are [release secrets](#release-secrets) (`updater.key`, `updater.password`). Actions uses the same key, so existing installed apps still trust the public key in `src-tauri/tauri.conf.json`.

### Release secrets

Every signing key and password lives in one folder outside the repo, `$DATA/secrets/tasks/` (or `~/data/secrets/tasks/` without `DATA`; `scripts/releaseSecrets.mjs`). It stays out of the repo on purpose: `git clean -fdx` would delete an ignored folder, worktrees wouldn't share it, and win-sync would copy it to Windows. Its `README.md` lists each file and what losing it costs. Back up the whole folder (the owner keeps it in 1Password) and restore it by putting the folder back. Keep it private: `chmod 700` on the folder, `chmod 600` on the files. Actions uses encrypted copies in repository secrets; Android files are restored only into the runner's temporary directory and removed after the build.

Before the first automated release, set these four repository Actions secrets from WSL with `gh` authenticated. These commands send the existing files without printing their contents or generating replacement keys:

```bash
secrets="${DATA:-$HOME/data}/secrets/tasks"
gh secret set TAURI_SIGNING_PRIVATE_KEY --repo Soleone/tasks < "$secrets/updater.key"
gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD --repo Soleone/tasks < "$secrets/updater.password"
base64 -w0 "$secrets/android.jks" | gh secret set ANDROID_KEYSTORE_BASE64 --repo Soleone/tasks
gh secret set ANDROID_KEYSTORE_PROPERTIES --repo Soleone/tasks < "$secrets/android.properties"
```

The properties must use `storeFile=android.jks` beside the properties file, not a path on your own machine. No Apple certificate or Windows code-signing secret is required for the current builds. Keep GitHub Actions enabled with permission for the publishing job to write repository contents.

Losing the update key means no installed desktop app accepts a new update, and each needs a manual install of a build with a new key. Losing the Android key means new APKs won't install over the old app.

## Storage and retry safety

The rules are in [spec/backend/safety.md](../spec/backend/safety.md). In practice: never delete or sync the SQLite cache, keep the original root, cache and profile together during uncertain work, keep task content out of shell commands and logs, and never open the Windows database from WSL.
