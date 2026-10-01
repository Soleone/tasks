# Tasks

A local-first, keyboard-first task app for people and their existing agents. Tasks uses a TypeScript command path, a Tauri desktop shell, a standalone JSON-lines CLI, and a canonical JSON workspace with a rebuildable SQLite cache.

**Status:** M0 is complete; M1 native acceptance remains open even though the app already implements capture, state changes, priorities, filters and search, shallow relationships, manual ordering, activity and idempotent agent writes, themes, export/restore, and canonical-workspace sync. Windows 11 packaging and desktop/WSL bridge checks pass; Omarchy/Linux desktop validation is later work. The [current plan](PLAN.md) prioritizes a spec-driven, single-directory TaskDB v2 contract and safe migration. [V2 contracts](spec/v2/overview.md) are accepted targets with declarative fixtures, not shipped behavior or a public standard; the opt-in multi-source controller is a Node-only prototype, not the next release path.

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

- [Current system specification](spec/overview.md): the implemented v1 task model, storage, protocol, queries, mutations, CLI, sources, and UI behavior.
- [V2 accepted target](spec/v2/overview.md): versioned single-root contracts and expected conformance cases, not a production reader/writer.
- [Development and validation](docs/development.md): architecture, developer workflows, packaging, scratch data, and platform checks.
- [Ideas and proposals](ideas/overview.md): aspirational designs and the earlier TaskDB 2.0 roadmap.
- [Keyboard and UI guide](docs/usage-guide.md): home-screen focus, mouse paths, shortcuts, filters, sorting, and agent-facing UI contract.
- [Canonical workspace](docs/canonical-workspace.md): JSON layout, cache rebuilds, archives, backups, and explicit conflict resolution.
- [Syncthing setup](docs/syncthing.md): safe initial seeding, folder modes, versioning, and recovery rules.
- [Android SAF performance](docs/android-saf-performance.md): bounded-read decision, device measurements, and how to repeat the investigation.
- [Themes](docs/themes.md): built-in palettes, workspace `colors.toml` files, and the preview page.
- [Current plan and previous milestone baseline](PLAN.md): the single-root TaskDB reset, next gates, and open native M1 obligations.
- [Guidelines](GUIDELINES.md): product principles.
- [Agent instructions](AGENTS.md): repository starting points and development tracking.

## License

[MIT](LICENSE).
