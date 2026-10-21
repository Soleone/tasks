# Tasks

A local-first, keyboard-first task list for one person and their agents. Tasks live as plain JSON files, one file per task, in the sync folder of a Tasks home you choose, so they can be synced, backed up and edited by scripts. A React app, a CLI and a JSON-lines interface for agents all share one TypeScript backend; the desktop shell is Tauri with a bundled Node runtime.

The web, desktop and Android apps and `tasks-cli` share the current engine. The owner confirmed the native Windows 11 and Android apps work (2026-10-19). [PLAN.md](PLAN.md) has the state and remaining gates.

## Install and check

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm check && pnpm lint && pnpm test
```

Use disposable data while developing. Nothing below touches your personal workspace.

## Run the app

```bash
pnpm dev:web
```

This copies the fixture into a fresh temporary Tasks home, prints where it is, and opens the task list at the URL Vite prints. `C` captures, `Enter` edits, `Space` moves status forward, `Ctrl/⌘+K` lists every shortcut. The full keymap and behavior are in [the client spec](spec/client/README.md).

To try changes on your real tasks without touching them, run `pnpm dev:web:real`. The first run asks which folder to copy to `$DATA/apps/tasks/dev-web-real/` (without `DATA`, a `tasks-dev` folder in local app data, such as `%LOCALAPPDATA%` on Windows); Enter takes the suggestion (a `Documents/Tasks` folder if one exists, otherwise the test data). The copy becomes the sync folder of a Tasks home there. Later runs reuse it with everything you changed in it. `pnpm dev:web:real --refresh` asks again, with your last choice as the default, and replaces the copy. Nothing is written back, and the copy sits outside Syncthing. Agents never run it.

To keep data between runs in a home of your own, pick it yourself: `pnpm dev:web --home PATH`. The window asks before opening it.

## The Tasks home

Everything Tasks keeps for one device lives in one folder, its Tasks home:

```text
<home>/settings.json   this device's preferences
<home>/sync/           the tasks: add only this folder to Syncthing
<home>/local/          caches, writer lock, recovery files and undo records; never synced
```

Never add the home itself to a sync tool. Each device has its own home; Syncthing connects their `sync/` folders, and settings, caches and undo history stay on each device. `local/` isn't a throwaway cache: deleting it loses undo history, receipts and any recovery files.

For a full backup, close Tasks and the CLI and copy the whole home. When a copy is opened, the app asks to start a new history there; the tasks, settings and undo records are all in it, and the old history is kept aside in `local/retired/`. A home moved as a whole on the same drive keeps its history once you confirm the move. **Archive and restore tasks** in Settings copies only the tasks, not settings or history.

### Moving a task folder from before homes

On a device that used Tasks before homes, setup shows the old task folder and offers **Bring my tasks into this home**. Do this once on each device:

1. Close the CLI and pause the folder in Syncthing.
2. Choose a new, empty home outside the old folder and bring the tasks over. The app copies the tasks, the cache with its activity and undo history, the recovery files, the preferences and the undo records. The old folder and the old app data stay as they were.
3. Syncthing can't change a folder's path, so remove the folder there (its files stay) and add it again with the same folder ID, pointing at the new home's `sync/` folder, shared with the same devices. It finds the files already in sync.

To go back before making changes in the new home, install the previous version of Tasks: it still opens the untouched old folder. Changes made in the new home after the move aren't in the old folder.

## Use the CLI

The CLI has no default home, so give it a scratch one:

```bash
scratch=$(mktemp -d)
cp -R scripts/fixtures/workspace/root "$scratch/sync" && mkdir "$scratch/local"
pnpm build:backend
node dist/backend/tasks-cli.js --home "$scratch" list --sort manual
```

`tasks-cli --home PATH init` creates a new, empty home. The CLI keeps its own cache in the home's `local/` and shares the app's writer lock.

`--help` lists the verbs. Before each write the CLI prints a `tasks-cli retry: {...}` line to stderr; to retry an uncertain write, pass back its context, key and expected version unchanged. Agents can send JSON-lines requests directly:

```bash
printf '%s\n' '{"version":2,"command":"task.list","args":{"sort":"manual"}}' | \
  node dist/backend/cli.js --stdio --home "$scratch" --client cli
```

See [spec/ecosystem/cli.md](spec/ecosystem/cli.md) and [spec/backend/commands.md](spec/backend/commands.md).

## Desktop

The desktop app runs the same UI on the current engine. It opens the remembered Tasks home; the first launch asks to create or open one. Build it on the machine it should run on:

```powershell
pnpm install
pnpm build:tauri
```

`pnpm dev:native` runs it in development. Setup is in [docs/development.md](docs/development.md#desktop-development). The Android app runs the same UI and backend; `pnpm build:android` builds it ([details](docs/development.md#android)).

## Data safety

The JSON files own task state. The local SQLite cache also holds receipts, undo history and write authority, so deleting it is not a harmless rebuild. Never sync the home or its `local/` folder. A copied or restored home never inherits or wipes history silently: the app asks to start a new history. Converting the old version's tasks is an owner-only step: `pnpm migrate OLD NEW_HOME` ([runbook](docs/migration.md)).

## Documentation

- [Specification](spec/README.md): how the app works, in three layers (backend, ecosystem, client).
- [Development](docs/development.md): setup, validation, native tooling and signing.
- [Current support](docs/support.md): what runs where today, with evidence.
- [Plan](PLAN.md), [guidelines](GUIDELINES.md), [agent instructions](AGENTS.md).
- [Evidence](docs/evidence/README.md): dated reports, frozen.

## License

[MIT](LICENSE).
