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

The dev transport is an HTTP bridge to the Linux Node backend, not a browser storage engine. Windows native uses one bundled Node SEA through `JsonLineSession`. `V2App` confirms the selected root, cache and profile before opening `App`. `MainWorkspace` routes supported actions and refuses withheld ones without legacy fallback. The query-only reader remains available without `--v2-edit`.

The unflagged UI/CLI/native entrypoints still use the legacy engine. They are temporary implementation state, not a second product to maintain. Removing that runtime, versioned production names and the temporary specification split belongs to the gated clean cut in PLAN. Do not relabel browser checks as native acceptance.

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
cp -R scripts/fixtures/taskdb-v2/root "$scratch/root"
printf 'Disposable workspace: %s\n' "$scratch"
XDG_DATA_HOME="$scratch/profile" pnpm dev:web \
  --v2-root "$scratch/root" --database "$scratch/cache.db" --v2-edit
```

Confirm the displayed root/cache/profile before querying. Leave off `--v2-edit` for query-only inspection. Reload requires confirmation again. Keep a stable browser origin and profile for display preferences; they do not preserve selection or unresolved requests.

The selected bridge exposes capture/content/status, relationships, manual reorder, same-client durable undo, status batches and Settings backup/restore. See [current support](support.md) for exact limits and the smaller Windows command set. Do not copy a historical command count into another allowlist.

Vite flags go after `--`, for example `-- --port 5199`. The backend defaults to `127.0.0.1:5174`; `TASKS_DEV_BACKEND_PORT` changes its port. `pnpm dev:backend` runs only the bridge. `pnpm dev` runs only Vite; `VITE_DEV_BACKEND_URL` selects a separately started bridge. The development listener and per-process selection token are not a production hosting or filesystem security boundary.

For a necessary legacy regression only, select both scratch paths explicitly:

```bash
scratch=$(mktemp -d)
TASKS_DATABASE_PATH="$scratch/tasks.db" TASKS_SYNC_ROOT="$scratch/sync" \
  XDG_DATA_HOME="$scratch/profile" pnpm dev:web
```

Unflagged launches otherwise use application defaults and may access personal data. Source-registry/multi-root experiments are not the release direction; their old recipes are retired to Git history.

## Validation

| Command | Scope |
| --- | --- |
| `pnpm check` | Backend and frontend types |
| `pnpm lint` | Repository lint |
| `pnpm test` | File-backed backend regressions; not native acceptance |
| `pnpm build` | Types, backend and frontend build |
| `pnpm build:backend` | Prepare `dist/backend` for focused script tests |
| `pnpm test:sidecar` | Bundled Node SEA probe on the actual host |
| `pnpm test:ui` | Default legacy UI Chromium regression on disposable data |
| `node scripts/check-v2-ui.mjs` | Query-only replacement browser reader checks |
| `node --test scripts/mainClientRouting.test.mjs scripts/mainClientPreferences.test.mjs` | Replacement bridge/client and preference checks |
| `pnpm test:native:argv` | Actual-Windows launch preparation/refusals, not a window launch |

`pnpm build` builds the backend before Vite clears `dist/`; rebuild the backend before focused scripts that import it. `pnpm test` prepares its own build. Browser runners require `agent-browser` and runnable Chromium. Record missing tools/libraries as blockers, not passes. [Evidence](evidence/README.md) retains process/native reports and their original limits.

Vite pre-optimizes the checkbox dependency to avoid a late dependency reload dropping in-memory requests. HMR, source edits, browser/native close and crashes can still lose drafts and uncertain requests. Do not reload during unresolved work.

## UI work

- Start UI checks from the task list. Wait for initial focus: `[role="listbox"]` with tasks, `[aria-label="Saved tasks"]` when empty. Never assume the New task button or an editor has focus.
- Drive the keyboard path first, then check the mouse path. A shortcut-only feature is incomplete.
- Buttons are mouse fallbacks with `tabIndex=-1`; clicking them must not take focus (mousedown default prevented). Don't add `autoFocus` to fix initial focus; it belongs in the list lifecycle after the first query renders.
- `src/components/TaskList.tsx` owns list focus, toolbar modes and home shortcuts. `src/navigation.ts` owns list entry and focus-steal prevention. The focus stack owns dialog return targets.
- Add every new keyboard action to `src/components/HelpPalette.tsx` and to the [client spec](../spec/client/README.md), with a rule slug a test can cite.
- Refreshes come from the shared workspace revision and must keep focus and unsaved editor text.

## Windows native development

Use a local Windows NTFS checkout, not WSL-mounted task/cache files. Install Node, Rust's MSVC toolchain, Visual Studio C++ Build Tools/Windows SDK and WebView2 through the normal Tauri prerequisites. Do not install or repair owner-host dependencies without permission.

[The disposable native launch guide](evidence/windows-native-pilot.md#quickstart-windows-powershell) uses:

```powershell
pnpm dev:native --v2-root ROOT --database CACHE --local-profile PROFILE
```

All three paths must be explicit, disposable, physically disjoint as required and within the launcher's supported short-path boundary. Project `shellEmulator: true` preserves Windows arguments; do not add `--`, normalize corrupted paths or use a fallback launch route. Confirm the displayed paths before any sidecar starts. The selected route uses one inline capability and one SEA session. Windows writers remain restricted to their proved profile.

`pnpm dev:tauri` still starts the legacy native route. `pnpm build:sidecar` builds target sidecar/CLI binaries; `pnpm build:tauri` creates native release bundles. Building is not release approval. See [Tauri shell notes](../src-tauri/README.md) for icons. Global focus, durable native preferences and the current Windows launch blocker remain governed by PLAN and support, not older proof instructions.

On Linux the Tauri entrypoint applies the WebKitGTK Wayland workaround. A browser or WSLg session does not establish Omarchy desktop/global-shortcut support. Separately approve native work before pursuing it.

## Android tooling and signing

Android is maintained, but its current engine uses the legacy format; schema-2 integration and provider acceptance remain deferred. Preserve its useful tooling without treating old SAF evidence as replacement acceptance. Use [AGENTS.md](../AGENTS.md#android-emulator) for the current Google `android` CLI, SDK/emulator setup and disposable standard-picker checks.

After `eval "$(mise env --shell bash)"`, build an x86_64 emulator APK with `pnpm tauri android build --debug --apk -t x86_64`. Use `-t aarch64` for an arm64 target. Standard-picker emulator, physical-device and third-party-provider evidence are distinct.

### Signed Android release APK

`pnpm build:android` requires signing, builds an arm64 release APK and verifies it with `apksigner`. Set `ANDROID_HOME` or `ANDROID_SDK_ROOT` and install SDK Build-Tools. Missing/incomplete properties are rejected before Tauri; Gradle validates the keystore, passwords and private-key alias.

Create a keystore in a private location, for example:

```bash
keytool -genkeypair -v -keystore "$HOME/.android/tasks-release.jks" \
  -alias tasks-release -keyalg RSA -keysize 2048 -validity 10000
```

Enter passwords interactively, never on the command line. Create the ignored local `src-tauri/gen/android/keystore.properties` with `storeFile`, `storePassword`, `keyAlias` and `keyPassword`. `storeFile` may be absolute or relative to `src-tauri/gen/android/app`. Restrict permissions (for example `chmod 600`), never commit credentials/keystores and keep an independent secure backup. Build/signing validation does not print property values. `pnpm build:android:debug` uses debug signing without release credentials.

## Storage and retry safety

Canonical JSON owns task state. SQLite also owns receipts/history/undo authority; it is not disposable just because queries can be rebuilt. Preserve the original root/cache/profile, journals, raw recovery copies and exact request envelope during uncertainty. Restarting a sidecar does not authorize replay with renewed context/key/version. Rebuild means re-observing canonical files with retained local authority, not deleting the database.

Only sync canonical files, never SQLite, WAL/SHM or local recovery authority. Canonical backup/restore does not transfer old retry/undo authority and does not switch selection. The old receive/seeding instructions are not a replacement-engine sharing guide. Personal read/conversion/selection remain separately permissioned; use [the isolated migration runbook](migration-rehearsal.md) for the rehearsed Linux route.

Keep task content out of shell commands/logs, sanitize Markdown/links, and expose only concrete native permissions. The legacy `bin/tasks` WSL wrapper is not the replacement Windows writer route; never open the Windows database directly from WSL.
