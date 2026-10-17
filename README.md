# Tasks

A local-first, keyboard-first task list for one person and their agents. Tasks live as plain JSON files in a folder you choose, one file per task, so they can be synced, backed up and edited by scripts. A React app, a CLI and a JSON-lines interface for agents all share one TypeScript backend; the desktop shell is Tauri with a bundled Node runtime.

The move to the new engine is under way. `pnpm dev:web` and `tasks-cli` already use it; native desktop builds still start the old app until cutover. [PLAN.md](PLAN.md) has the state and the gates.

## Install and check

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm check && pnpm lint && pnpm test
```

Use disposable data while developing. Nothing below touches your personal workspace.

## Run the app

```bash
scratch=$(mktemp -d)
cp -R scripts/fixtures/workspace/root "$scratch/root"
XDG_DATA_HOME="$scratch/profile" pnpm dev:web \
  --root "$scratch/root" --database "$scratch/cache.db"
```

Open the URL Vite prints, confirm the folder, cache and profile, and the task list opens. `C` captures, `Enter` edits, `Space` moves status forward, `Ctrl/⌘+K` lists every shortcut. The full keymap and behavior are in [the client spec](spec/client/README.md).

The cache must sit outside the task folder. There is no default workspace; `pnpm dev:web --legacy` runs the old app until cutover.

## Use the CLI

```bash
pnpm build:backend
XDG_DATA_HOME="$scratch/profile" node dist/backend/tasks-cli.js \
  --root "$scratch/root" --database "$scratch/cache.db" list --sort manual
```

`--help` lists the verbs. Before each write the CLI prints a `tasks-cli retry: {...}` line to stderr; to retry an uncertain write, pass back its context, key and expected version unchanged. Agents can send JSON-lines requests directly:

```bash
printf '%s\n' '{"version":2,"command":"task.list","args":{"sort":"manual"}}' | \
  XDG_DATA_HOME="$scratch/profile" node dist/backend/cli.js --stdio \
    --root "$scratch/root" --database "$scratch/cache.db"
```

See [spec/ecosystem/cli.md](spec/ecosystem/cli.md) and [spec/backend/commands.md](spec/backend/commands.md).

## Desktop

The desktop app runs the same UI on the current engine. It opens the remembered task folder; the first launch asks for one. Build it on the machine it should run on:

```powershell
pnpm install
pnpm build:tauri
```

`pnpm dev:native` runs it in development. Setup is in [docs/development.md](docs/development.md#desktop-development). Android is dropped until it is ported to the new engine.

## Data safety

The JSON files own task state. The local SQLite cache also holds receipts, undo history and write authority, so deleting it is not a harmless rebuild. Never sync the cache. Converting the old version's tasks is an owner-only step: `pnpm migrate OLD NEW` ([runbook](docs/migration.md)).

## Documentation

- [Specification](spec/README.md): how the app works, in three layers (backend, ecosystem, client).
- [Development](docs/development.md): setup, validation, native tooling and signing.
- [Current support](docs/support.md): what runs where today, with evidence.
- [Plan](PLAN.md), [guidelines](GUIDELINES.md), [agent instructions](AGENTS.md).
- [Evidence](docs/evidence/README.md): dated reports, frozen.

## License

[MIT](LICENSE).
