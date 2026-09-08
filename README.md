# Tasks

A local-first, keyboard-friendly task app for people and their existing agents. Built for Windows 11 and Omarchy/Linux, with a TypeScript core, Tauri desktop shell, and SQLite storage.

**Status:** M0 scaffold in progress. The web shell, TypeScript backend, JSON-lines CLI, SQLite/FTS5 probe, and Linux SEA sidecar are working. Native Tauri compilation is currently blocked by missing Linux system libraries in this WSL environment.

- [Kickoff plan](PLAN.md): decisions, scope, architecture, milestones, and known setup gaps.
- [Guidelines](GUIDELINES.md): a few principles for building the product.
- [Agent instructions](AGENTS.md): where to start and how development work is tracked.

## Local development

```bash
pnpm install
pnpm check
pnpm test
pnpm test:sidecar
pnpm dev:web
```

`pnpm dev:web` is the fast UI iteration loop: it starts Vite plus a dev-only local backend (`src/backend/devServer.ts`) and opens the app in the browser with hot reload. The browser talks to the same typed commands and real SQLite storage as the desktop sidecar and CLI, so UI work iterates in milliseconds with no Tauri rebuild. The header shows "Browser preview" in this mode. The dev backend defaults to port 5174 and the shared workspace database; override with `TASKS_DEV_BACKEND_PORT`, `TASKS_DATABASE_PATH` (use a scratch file to keep test tasks out of real data), and `VITE_DEV_BACKEND_URL`. Extra args after `--` go to Vite, e.g. `pnpm dev:web -- --port 5199`. `pnpm dev:backend` runs the dev backend alone. The bridge binds 127.0.0.1, only answers local-page origins, and is never packaged; it is iteration tooling, not a PWA or sync path. `pnpm dev` (Vite alone) still works but shows a connection error until a backend is running.

The primary native test environment is the Windows 11 host. WSL is for backend and packaging checks, not desktop acceptance. The browser preview exercises the real command path and SQLite storage but is UI iteration tooling, not desktop acceptance and not evidence of PWA support. On Windows, install the Tauri prerequisites from the [official guide](https://v2.tauri.app/start/prerequisites/) and run `pnpm dev:tauri` from the project. `dev:tauri` reuses the packaged sidecar when backend sources are unchanged (sub-second check) and only pays the full SEA rebuild after backend edits; run `pnpm build:sidecar` for an explicit rebuild. Omarchy/Linux is the secondary native target after the core workflow is stable. The checked Windows host already has WebView2, but still needs Windows Node, pnpm, Rust/Cargo, and Visual Studio C++ Build Tools. The current WSL machine is missing `libdbus-1-dev`, WebKitGTK 4.1, GTK/RSVG, and related development packages, so native launch is not available there.

`pnpm test:sidecar` builds a target-specific Node SEA executable and runs it with a minimal environment, demonstrating that the probe does not require a system Node installation. The binary is generated under `src-tauri/binaries/` and is intentionally ignored by Git.

### Windows 11 first run

From an elevated PowerShell, install Node LTS, Rustup, and Visual Studio Build Tools. In the Build Tools installer, select **Desktop development with C++** and a Windows SDK. WebView2 is also required; it is already present on the currently checked host.

```powershell
winget install --id OpenJS.NodeJS.LTS -e
winget install --id Rustlang.Rustup -e
winget install --id Microsoft.VisualStudio.2022.BuildTools -e
```

Then use a Windows filesystem checkout, not the WSL path, and run:

```powershell
robocopy "\\wsl.localhost\Ubuntu\home\soleone\src\products\tasks" "C:\src\products\tasks" /E /XD node_modules dist target binaries
cd C:\src\products\tasks
corepack enable
corepack prepare pnpm@11.22.0 --activate
rustup default stable-msvc
pnpm install
pnpm check
pnpm test
pnpm test:sidecar
pnpm dev:tauri
```

`pnpm dev:tauri` should launch the current M0 shell. `pnpm build:tauri` creates a release bundle after the development launch works.

## License

[MIT](LICENSE).
