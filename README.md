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
pnpm test:ui
pnpm dev:web
```

`pnpm dev:web` is the fast UI iteration loop: it starts Vite plus a dev-only local backend (`src/backend/devServer.ts`) and opens the app in the browser with hot reload. The browser talks to the same typed commands and real SQLite storage as the desktop sidecar and CLI, so UI work iterates in milliseconds with no Tauri rebuild. The header shows "Browser preview" in this mode. The dev backend defaults to port 5174 and the shared workspace database; override with `TASKS_DEV_BACKEND_PORT`, `TASKS_DATABASE_PATH` (use a scratch file to keep test tasks out of real data), and `VITE_DEV_BACKEND_URL`. Extra args after `--` go to Vite, e.g. `pnpm dev:web -- --port 5199`. `pnpm dev:backend` runs the dev backend alone. The bridge binds 127.0.0.1, only answers local-page origins, and is never packaged; it is iteration tooling, not a PWA or sync path. `pnpm dev` (Vite alone) still works but shows a connection error until a backend is running.

The primary native test environment is the Windows 11 host. WSL is for backend and packaging checks, not desktop acceptance. The browser preview exercises the real command path and SQLite storage but is UI iteration tooling, not desktop acceptance and not evidence of PWA support. On Windows, install the Tauri prerequisites from the [official guide](https://v2.tauri.app/start/prerequisites/) and run `pnpm dev:tauri` from the project. `dev:tauri` reuses the packaged sidecar when backend sources are unchanged (sub-second check) and only pays the full SEA rebuild after backend edits; run `pnpm build:sidecar` for an explicit rebuild. Omarchy/Linux is the secondary native target after the core workflow is stable. The checked Windows host already has WebView2, but still needs Windows Node, pnpm, Rust/Cargo, and Visual Studio C++ Build Tools. The current WSL machine is missing `libdbus-1-dev`, WebKitGTK 4.1, GTK/RSVG, and related development packages, so native launch is not available there.

`pnpm test:sidecar` builds a target-specific Node SEA executable and runs it with a minimal environment, demonstrating that the probe does not require a system Node installation. The binary is generated under `src-tauri/binaries/` and is intentionally ignored by Git.

`pnpm test:ui` drives the keyboard-first UI end to end in headless Chromium through `agent-browser`: capture, Tab-to-description, Ctrl/Cmd+Enter, the Ctrl/Cmd+K shortcut palette, editing, stale-edit conflicts, lost-reply receipt retry, validation, reload persistence, responsive overflow, and axe. It starts its own Vite plus dev backend on free ports against a temporary scratch database, so it never touches the shared workspace. It needs `agent-browser` with Linux Chromium installed (see the WSL browser guidance); without it, rely on `pnpm dev:web` plus manual checks and say so.

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

## Theming

The app renders through a small set of region tokens, and themes are palettes in the [omarchy](https://omarchy.org) `colors.toml` format. A palette says which color is the canvas, the surface, the raised chip, the selection, the dividers, the ink ramp, and the accent:

| Region | Palette slot | Used for |
| --- | --- | --- |
| Canvas | `dark_background` | page behind the surfaces |
| Surface | `background` | cards, dialogs, the command palette |
| Raised | `lighter_background` | chips, hover, the selected row |
| Selection | `selection` | text selection and quiet hover |
| Dividers | `muted` | borders and input edges |
| Ink | `foreground`, `muted_foreground`, `bright_foreground` | body, secondary, and strong text |
| Accent | `accent` | primary buttons and the focus ring |

Two names collide with omarchy and are mapped deliberately: omarchy `accent` is the brand color, so it becomes the primary button and the focus ring, while shadcn's `--accent` is a quiet hover surface and takes omarchy `selection`. Omarchy `muted` is a de-emphasized ink, so it becomes dividers rather than a surface.

Built-in themes ship with the app: Default (neutral, follows the system appearance), Tokyo Night, Catppuccin Mocha, Gruvbox, Nord, Catppuccin Latte, Rose Pine Dawn, and Matte Black. Choose one from the Theme group in the Ctrl/Cmd+K palette, or over the shared command path with `theme.list` and `theme.set`; the choice is stored in the workspace database. Rose Pine Dawn ships a mid-tone accent whose button ink clears the 3:1 non-text floor rather than 4.5:1; themes stay faithful to their author over corrected.

To use any other omarchy theme, copy its `colors.toml` into the workspace `themes/` folder beside `tasks.db` (for example `%APPDATA%\com.soleone.tasks\themes` on Windows or `~/.local/share/com.soleone.tasks/themes` on Linux) and name it `<theme-name>.toml`. It appears in the palette the next time it opens, and a file named after a built-in overrides it. A file may set only the slots it cares about: anything it leaves out falls back to the neutral ramp for its `mode`, so a short file with just an `accent` is a valid theme. Parse problems show up as the item's hint instead of breaking the list.

Slots the regions need but a palette omits are derived from the ones it declares, and text roles are corrected toward readability because palettes arrive from theme authors: secondary ink is pulled toward the body ink until it clears 4.5:1 on every surface it can sit on, and ink on an accent fill comes from the theme's own darkest or lightest stop.

## Data and export

SQLite is the only source of truth. The desktop shell, the CLI, and the browser preview all run the same typed commands against the same database file; the browser keeps no task storage of its own.

The gear button in the header, or “Settings” in the Ctrl/Cmd+K palette, opens the settings dialog. Its Data section shows where the workspace database lives and exports your tasks as readable JSON: `workspace.exportTasks` writes `exports/tasks-<UTC stamp>.json` beside the database, one new file per export, shaped for another app to import:

```json
{
  "format": "tasks.tasks-export",
  "formatVersion": 1,
  "exportedAt": "2026-09-08T20:51:04.113Z",
  "taskCount": 1,
  "tasks": [
    {
      "id": "…",
      "title": "Book venue @launch #planning",
      "status": "open",
      "category": "launch",
      "tags": ["planning"],
      "notesMarkdown": "- ask about capacity\n",
      "createdAt": "…",
      "updatedAt": "…",
      "completedAt": null,
      "canceledAt": null
    }
  ]
}
```

The portable file is a view, not a backup: `workspace.export` (lossless snapshot) and `workspace.backup` (consistent SQLite copy) remain the restore path over the same command surface, and the CLI can call all of them while the app is closed.

## License

[MIT](LICENSE).
