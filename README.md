# Tasks

A local-first, keyboard-first task app for one person and their external agents. The established React UI, CLI and agents share concrete task rules through a TypeScript backend, with a Tauri desktop shell and bundled Node runtime.

**Migration in progress:** the replacement engine is implemented for the agreed Linux/web workflows. Windows/native and owner acceptance remain open; the unflagged app and CLI still use the legacy engine until the approved clean cut. There will be one application, not permanent v1/v2 coexistence. [PLAN.md](PLAN.md) owns the next action and gates; [current support](docs/support.md) lists actual capabilities and blockers.

## Start here

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm lint
pnpm test
```

Use disposable data for development. Unflagged launches may select personal application defaults; do not use them to test migration.

## Main client on the Linux backend

Run the established task list, inline editor, toolbar and Settings on the replacement backend:

```bash
scratch=$(mktemp -d)
cp -R scripts/fixtures/taskdb-v2/root "$scratch/root"
printf 'Disposable workspace: %s\n' "$scratch"
XDG_DATA_HOME="$scratch/profile" pnpm dev:web \
  --v2-root "$scratch/root" --database "$scratch/cache.db" --v2-edit
```

Open Vite's URL and confirm the displayed root/cache/profile before querying. Reload requires confirmation again; selection is not saved.

- **C / Enter** capture and edit; **0–4** set priority; **Space / Shift+Space / P / Delete** change status.
- **Shift+C**, **M** and **B** capture children, change parents and manage blockers. Done dependencies still block; canceled ones do not.
- **Ctrl/⌘+↑/↓/Home/End** reorder selected siblings under the existing filter preconditions. Multi-select status actions execute as one all-or-refuse batch.
- **Ctrl+Z** walks back through about 50 of this client's own operations, retained across reopen of the same root/cache/profile. One batch is one undo entry. The backend checks eligibility; redo is unavailable.
- Settings offers separately confirmed canonical backup/restore to new destinations. Copies neither switch selection nor transfer receipts/history/undo authority.
- Built-in themes and view preferences persist in the same browser origin/profile. Global focus is native-only; unsupported actions are refused, not sent to the legacy engine.

Filters/search and external CLI changes refresh the list. Follow [the interaction guide](spec/client/README.md) for focus, picker and undo details. This is a development bridge to the Linux backend, not a browser storage engine or native acceptance.

## Opt-in v2 browser reader

Omit `--v2-edit` from the command above for query-only inspection. Confirm the paths, navigate with arrows/J/K, and open literal details with Enter or Show details. Search is applied explicitly. Pending/invalid evidence blocks normal rows; the reader does not repair it. Reload and reconfirm after a bridge restart. See [reader behavior](docs/evidence/conformance-history.md#explicit-read-only-app-reader).

## Opt-in v2 human CLI

Build the backend, then use the same explicit root, outside-root cache and profile as the selected Linux UI:

```bash
pnpm build:backend
XDG_DATA_HOME="$scratch/profile" node dist/backend/tasks-cli.js \
  --v2-root "$scratch/root" --database "$scratch/cache.db" list --sort manual
```

Run the same entrypoint with `--help` for verbs and arguments; [the CLI contract](spec/ecosystem/cli.md) defines input/output and retry behavior. Friendly writes are Linux-only: this entrypoint does not select the Windows proof profile. Omitting `--v2-root` still selects legacy behavior.

For new operations the CLI can prepare context/version and a key. Before an executing write it prints `tasks-cli retry: {...}` metadata to stderr. Save it privately with the exact original arguments. An uncertain retry must retain context, key, expected version, actor, flags, payload and root/cache/profile; the reported request hash detects changed arguments before dispatch. Do not refresh authority and guess a replacement request. Previews consume no effects or key.

Ordering, batch and doctor controls use [JSON-lines protocol commands](spec/backend/commands.md), not invented friendly verbs. For example, on the disposable root:

```bash
printf '%s\n' '{"version":2,"command":"task.list","args":{"sort":"manual"}}' | \
  XDG_DATA_HOME="$scratch/profile" node dist/backend/cli.js --stdio \
    --v2-root "$scratch/root" --database "$scratch/cache.db"
```

## Windows and Android

The selected Windows native route uses the same main UI over one embedded SEA session with a smaller, explicitly proved command set. Use [the disposable Windows launch recipe](docs/evidence/windows-native-pilot.md#quickstart-windows-powershell) and [development prerequisites](docs/development.md#windows-native-development):

```powershell
pnpm dev:native --v2-root ROOT --database CACHE --local-profile PROFILE
```

Do not add `--` or substitute an unflagged launch. `pnpm dev:tauri` still starts legacy. Further automated Windows diagnosis is owner-deferred; a manual main-WebView launch is the next native gate. Existing process proofs are not full native parity, durable-preference acceptance or release approval.

Android is maintained, with replacement integration/migration deferred on tooling/provider blockers. Its legacy SAF engine is not schema-2 support. [Android setup](AGENTS.md#android-emulator) and [signing instructions](docs/development.md#signed-android-release-apk) remain available; emulator, physical-device and third-party-provider acceptance are distinct.

## Data safety and one-time migration

Canonical JSON owns task state. Local SQLite also owns receipts/history/undo authority: **deleting the cache is not a rebuild**. Keep original root/cache/profile bindings, journals, exact retry envelopes and raw recovery copies during uncertainty. Canonical copies do not preserve old retry authority. Never sync SQLite, WAL/SHM or local recovery state.

Use the [isolated migration runbook](docs/migration-rehearsal.md) to preview and convert a frozen legacy snapshot into a separate schema-2 folder on the rehearsed Linux host. It preserves source/independent backups and does not switch selection, migrate old undo/history or reverse-convert later edits. Reading, converting and selecting personal data each need explicit permission. Do not follow old receive/seeding recipes on the new engine or invent a sharing feature during cleanup.

## Documentation

- [Current support](docs/support.md): live routes, platform limits and acceptance blockers.
- [Development](docs/development.md): scratch setup, validation, native tooling and signing.
- [Client spec](spec/client/README.md): keymap, focus and every UI behavior.
- [Themes](docs/themes.md): built-in palettes and persistence.
- [Migration](docs/migration-rehearsal.md): isolated one-time conversion and retained authority.
- [Evidence index](docs/evidence/README.md): dated reports and original machine-readable artifacts, not another roadmap.
- [Specification](spec/README.md): how the app works, in three layers (backend, ecosystem, client).
- [Plan](PLAN.md), [guidelines](GUIDELINES.md) and [agent instructions](AGENTS.md): direction, principles and working rules.

## License

[MIT](LICENSE).
