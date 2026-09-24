# Tasks

A local-first, keyboard-first task app for people and their existing agents. Tasks uses a TypeScript command path, a Tauri desktop shell, a standalone JSON-lines CLI, and a canonical JSON workspace with a rebuildable SQLite cache.

**Status:** M0 is complete and M1 is in progress. The current slice covers task capture and state changes, priorities, filters and search, shallow relationships, manual ordering, activity and idempotent agent writes, themes, export/restore, and canonical-workspace sync. Windows 11 packaging and desktop/WSL bridge checks pass; Omarchy/Linux desktop validation is later work.

## Start here

```bash
pnpm install
pnpm check
pnpm test
pnpm test:sidecar
pnpm dev:web
```

`pnpm dev:web` runs Vite with the real local backend and SQLite storage for fast UI work. It uses the shared workspace by default, so use a scratch `TASKS_DATABASE_PATH` and `TASKS_SYNC_ROOT` when you do not want to touch personal tasks. See [development and validation](docs/development.md) for the scratch setup, UI tests, native desktop checks, and release builds.

For the native shell, use `pnpm dev:tauri` on Windows 11 or Omarchy. On Linux, the Tauri entry point applies the WebKitGTK Wayland workaround automatically. `pnpm test:ui` is an optional Chromium check that creates its own scratch database and needs `agent-browser` with Linux Chromium.

## Data safety

Current task state lives in ordinary JSON files under `sync/`; SQLite is a local query cache and stores activity, receipts, and indexes. Sync only the canonical JSON root. Never sync `tasks.db`, its `-wal`/`-shm` files, or `.tasks-local/`.

If another device already has task history, use **Settings → Sync with another device…** on the new device before adding its folder to Syncthing. Tasks backs up and empties the local workspace, locks the UI, and waits for the existing workspace. Follow [the Syncthing setup](docs/syncthing.md) for the complete procedure.

## Documentation

- [Development and validation](docs/development.md): architecture reference, command/reliability rules, local loops, scratch data, native checks, and platform boundaries.
- [Keyboard and UI guide](docs/usage-guide.md): home-screen focus, mouse paths, shortcuts, filters, sorting, and agent-facing UI contract.
- [Canonical workspace](docs/canonical-workspace.md): JSON layout, cache rebuilds, archives, backups, and explicit conflict resolution.
- [Syncthing setup](docs/syncthing.md): safe initial seeding, folder modes, versioning, and recovery rules.
- [Android SAF performance](docs/android-saf-performance.md): bounded-read decision, device measurements, and how to repeat the investigation.
- [Themes](docs/themes.md): built-in palettes, workspace `colors.toml` files, and the preview page.
- [Plan](PLAN.md): product direction, confirmed decisions, milestones, and current open items.
- [Guidelines](GUIDELINES.md): product principles.
- [Agent instructions](AGENTS.md): repository starting points and development tracking.

## License

[MIT](LICENSE).
