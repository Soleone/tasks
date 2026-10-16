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

The dev transport is an HTTP bridge to the Linux Node backend, not a browser storage engine. Windows native uses one bundled Node SEA through `JsonLineSession`. `WorkspaceSelection` confirms the selected root, cache and profile before opening `App`. `MainWorkspace` routes supported actions and refuses withheld ones without legacy fallback.

`pnpm dev:web` and `tasks-cli` use the current engine and require `--root`; `--legacy` reaches the old app and CLI until cutover. Native desktop and Android builds still start the legacy app. Legacy code lives in `src/legacy/` (see [src/LEGACY.md](../src/LEGACY.md)) and is deleted at cutover. Do not relabel browser checks as native acceptance.

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

For a legacy regression, run `pnpm dev:web --legacy` with `TASKS_DATABASE_PATH`, `TASKS_SYNC_ROOT` and `XDG_DATA_HOME` pointing at scratch paths; without them the legacy app uses application defaults and may reach personal data.

## Validation

| Command | Scope |
| --- | --- |
| `pnpm check` | Backend and frontend types |
| `pnpm lint` | Repository lint |
| `pnpm test` | File-backed backend regressions, then client tests (Vitest, jsdom) that render the app over a disposable workspace and cite client rules; not native acceptance |
| `pnpm build` | Types, backend and frontend build |
| `pnpm build:backend` | Prepare `dist/backend` for focused script tests |
| `pnpm test:sidecar` | Bundled Node SEA probe on the actual host |
| `pnpm test:ui` | Default legacy UI Chromium regression on disposable data |
| `node --test scripts/mainClientRouting.test.mjs scripts/appearancePreferences.test.mjs` | Client routing and stored appearance checks |
| `pnpm test:native:argv` | Actual-Windows launch preparation/refusals, not a window launch |

`pnpm build` builds the backend before Vite clears `dist/`; rebuild the backend before focused scripts that import it. `pnpm test` prepares its own build. Browser runners require `agent-browser` and runnable Chromium. Record missing tools/libraries as blockers, not passes. [Evidence](evidence/README.md) retains process/native reports and their original limits.

Vite pre-optimizes the checkbox dependency to avoid a late dependency reload dropping in-memory requests. HMR, source edits, browser/native close and crashes can still lose drafts and uncertain requests. Do not reload during unresolved work.

## UI work

- Start UI checks from the task list. Wait for initial focus: `[role="listbox"]` with tasks, `[aria-label="Saved tasks"]` when empty. Never assume the New task button or an editor has focus.
- Drive the keyboard path first, then check the mouse path. A shortcut-only feature is incomplete.
- Buttons are mouse fallbacks with `tabIndex=-1`; clicking them must not take focus (mousedown default prevented). Don't add `autoFocus` to fix initial focus; it belongs in the list lifecycle after the first query renders.
- `src/components/TaskList.tsx` owns list focus, toolbar modes and home shortcuts. `src/navigation.ts` owns list entry and focus-steal prevention. The focus stack owns dialog return targets.
- Add every new keyboard action to `src/components/HelpPalette.tsx` and to the [client spec](../spec/client/README.md), with a rule slug a test can cite. Client tests live in `src/spec/`, one file per client spec page, using `src/testing/appWorkspace.tsx`.
- Refreshes come from the shared workspace revision and must keep focus and unsaved editor text.

## Windows native development

Use a local Windows NTFS checkout, not WSL-mounted task/cache files. Install Node, Rust's MSVC toolchain, Visual Studio C++ Build Tools/Windows SDK and WebView2 through the normal Tauri prerequisites. Do not install or repair owner-host dependencies without permission.

[The disposable native launch guide](evidence/windows-native-pilot.md#quickstart-windows-powershell) uses:

```powershell
pnpm dev:native --root ROOT --database CACHE --local-profile PROFILE
```

All three paths must be explicit, disposable, physically disjoint as required and within the launcher's supported short-path boundary. Project `shellEmulator: true` preserves Windows arguments; do not add `--`, normalize corrupted paths or use a fallback launch route. Confirm the displayed paths before any sidecar starts. The selected route uses one inline capability and one SEA session. Windows writers remain restricted to their proved profile.

`pnpm dev:tauri` still starts the legacy native route. `pnpm build:sidecar` builds target sidecar/CLI binaries; `pnpm build:tauri` creates native release bundles. Building is not release approval. See [Tauri shell notes](../src-tauri/README.md) for icons. Global focus, durable native preferences and the current Windows launch blocker remain governed by PLAN and support, not older proof instructions.

On Linux the Tauri entrypoint applies the WebKitGTK Wayland workaround. A browser or WSLg session does not establish Omarchy desktop/global-shortcut support. Separately approve native work before pursuing it.

## Android

Android is dropped until it is ported to the new engine. The old Android runtime in `src/legacy/platform/` is deleted at cutover; its emulator setup and release signing steps are in git history (`f568d2b:AGENTS.md`, `f568d2b:docs/development.md`).

## Storage and retry safety

The rules are in [spec/backend/safety.md](../spec/backend/safety.md). In practice: never delete or sync the SQLite cache, keep the original root, cache and profile together during uncertain work, keep task content out of shell commands and logs, and never open the Windows database from WSL.
