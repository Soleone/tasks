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

## Disposable v2 probe

The default app/CLI remains v1. Explicit protocol-2 Node mode supports info/get/list/category/tag. On Linux it additionally supports guarded task creation/content edits/status changes (including previews), local activity, verified archive/restore, guarded v1 migration to a separate folder, explicit empty-folder initialization, cache-only rebuild, and recovery of published task/copy/migration/init intents. Relationship edits, reorder/normalization, undo, purge and doctor remain unsupported. Use disposable copies, not personal data:

```bash
pnpm build:backend
scratch=$(mktemp -d)
cp -R scripts/fixtures/taskdb-v2/root "$scratch/root"
printf '%s\n' '{"version":2,"command":"task.list","args":{"sort":"manual"}}' | \
  XDG_DATA_HOME="$scratch/local-data" node dist/backend/cli.js --stdio --v2-root "$scratch/root" --database "$scratch/cache.db"
```

For `task.update`, retain the returned `writeContext`, task `version` as `args.expectedVersion`, and a stable `idempotencyKey` with the original payload. Supported fields are `title` (literal), `text` (shorthand replacement), `description`, `priority`, `category`, and `tags`. `workspace.info` reports an interrupted operation's `pendingOperationId`; explicitly execute `workspace.recovery.resume` with that `operationId`, current context and a new stable recovery key. Never refresh authority and blindly retry an uncertain original operation.

The cache must be outside the canonical tree. Root-scoped locks/pending intent live in the same user's app-data profile (`taskdb-v2/roots/`), outside the synced root, independently of the selected cache. Participating processes must share that profile; do not move it during pending work. Windows/Android writable commands are withheld. See [the evidence matrix](spec/v2/conformance.md) for WSL2-only execution, manual-inspection cases, race and power-loss limits. These controls are not native/provider acceptance or permission to migrate personal data.

### Initialize an empty experimental folder or rebuild its cache

Linux only. `workspace.init` creates a v2 descriptor and empty `tasks/` in an explicitly selected **existing empty directory**. It allows an already-empty `tasks/` and physical Syncthing markers/history/ignore files, but refuses task records, partial transfers, unrelated entries and existing descriptors. It never upgrades v1 or changes the app's selected folder. Reads do not initialize anything.

This standalone example needs `jq` and uses a disposable folder:

```bash
pnpm build:backend
initscratch=$(mktemp -d)
mkdir "$initscratch/root"
collection() {
  XDG_DATA_HOME="$initscratch/local-data" node dist/backend/cli.js \
    --stdio --v2-root "$initscratch/root" --database "$initscratch/cache.db"
}
context=$(printf '%s\n' '{"version":2,"command":"workspace.info"}' | collection | jq -r '.writeContext')
jq -nc --arg ctx "$context" \
  '{version:2,command:"workspace.init",writeContext:$ctx,idempotencyKey:"init-1"}' | collection
jq -nc --arg ctx "$context" \
  '{version:2,command:"workspace.rebuild",writeContext:$ctx,idempotencyKey:"rebuild-1"}' | collection
```

Expect schema 2 and zero tasks. Both commands support `dryRun`/`readOnly` with current context and no required key. For uncertain execution, retain the original context/key/payload.

`workspace.rebuild` validates the whole schema-2 tree and rebuilds only its local projection. It does not edit canonical files, import a v1 database or discard pending recovery. With the same retained cache, context, success receipts and activity survive; every task gets a fresh non-reused version. Old requests still replay their historical result, but old task versions cannot authorize a new edit. Re-read before further mutations. **Deleting the cache is not a rebuild:** lost cache means fresh authority and refusal of old requests.

Interrupted init is recovered through the original selected folder/cache/profile using `workspace.recovery.resume`. Unbound directory creation, unpublished/partial progress, changed entries or a divergent/missing recorded descriptor require preserved inspection, not adoption or recreation. Descriptor publication cannot overwrite an arriving file. This is Linux/WSL2 process evidence, not native/provider or hardware power-loss acceptance. See [lifecycle evidence](spec/v2/conformance.md#explicit-initialization-and-retained-cache-rebuild).

### Capture and complete an experimental task

Linux only, with `jq`. This creates a fresh disposable collection, captures a shorthand title, then completes the returned task:

```bash
pnpm build:backend
capturescratch=$(mktemp -d)
mkdir "$capturescratch/root"
capture() {
  XDG_DATA_HOME="$capturescratch/local-data" node dist/backend/cli.js \
    --stdio --v2-root "$capturescratch/root" --database "$capturescratch/cache.db"
}
context=$(printf '%s\n' '{"version":2,"command":"workspace.info"}' | capture | jq -r '.writeContext')
jq -nc --arg ctx "$context" \
  '{version:2,command:"workspace.init",writeContext:$ctx,idempotencyKey:"init-1"}' | capture
created=$(jq -nc --arg ctx "$context" \
  '{version:2,command:"task.create",writeContext:$ctx,idempotencyKey:"capture-1",args:{text:"Plan @Work #TODO"}}' | capture)
printf '%s\n' "$created"
id=$(printf '%s\n' "$created" | jq -r '.result.task.id')
version=$(printf '%s\n' "$created" | jq -r '.result.task.version')
jq -nc --arg ctx "$context" --arg id "$id" --argjson version "$version" \
  '{version:2,command:"task.complete",writeContext:$ctx,idempotencyKey:"complete-1",args:{id:$id,expectedVersion:$version}}' | capture
```

`task.create` requires exactly one literal `title` or shorthand `text`, and may supply `description`, `priority`, `category`/`tags` with literal title, and `parentId`. New IDs are generated UUIDv4; defaults are open/P2, empty notes, no classification/links, and first in the complete sibling scope. A new parent must exist and not be canceled. Caller IDs, status, dependency/key/time fields and v1 aliases are rejected.

`task.start`, `task.pause`, `task.complete`, `task.reopen`, `task.cancel` and `task.delete` take only `id`/`expectedVersion` plus envelope context/key. Delete means **cancellation, not file removal**, even for done tasks; cancel itself refuses done. See the [transition matrix](spec/v2/mutations.md#states-and-relationships). Status changes preserve edit time/order/relationships, set closure on done/canceled and clear it on active states. No cascades. Same-state requests are receipt-only no-ops.

Previews consume no key or canonical effects. Creation preview IDs/times/versions are hypothetical, not reserved authority or a prepared executing request. Keep the **original** context/key/payload/version for an uncertain execution; re-read only before a genuinely new edit. Historical replay can return an old version, including after a task disappears, without recreating it.

Capture recovery uses a fixed UUID/time/key and a no-clobber publication. After publication start is durably recorded, a missing target is uncertain: preserve the task/stage/journal for inspection rather than recreate it. Missing/partial progress, late membership, changed bytes or wrong cache location also refuse. Resume through the original root/cache/profile only. These remain disposable Linux/WSL2 controls, not native/provider or personal-rollout acceptance. See [capture/status evidence](spec/v2/conformance.md#recoverable-capture-and-status).

### Back up or restore an experimental v2 folder

`workspace.archive` copies the selected schema-2 folder to a separate destination. `workspace.restore` copies a named schema-2 backup into a new destination. Neither switches your selected folder or converts v1 data. Both require current context and a stable key; `readOnly`/`dryRun` previews require context but no key. Destinations must be absent or explicitly empty, disjoint from the source/selected root, with an existing parent. Cache and app-data must stay outside them.

After the disposable probe above, this example needs `jq`:

```bash
v2() {
  XDG_DATA_HOME="$scratch/local-data" node dist/backend/cli.js \
    --stdio --v2-root "$scratch/root" --database "$scratch/cache.db"
}
context=$(printf '%s\n' '{"version":2,"command":"workspace.info"}' | v2 | jq -r '.writeContext')
jq -nc --arg ctx "$context" --arg dest "$scratch/archive" \
  '{version:2,command:"workspace.archive",writeContext:$ctx,idempotencyKey:"backup-1",args:{destinationDirectory:$dest}}' | v2
jq -nc --arg ctx "$context" --arg src "$scratch/archive" --arg dest "$scratch/restored" \
  '{version:2,command:"workspace.restore",writeContext:$ctx,idempotencyKey:"restore-1",args:{sourceDirectory:$src,destinationDirectory:$dest}}' | v2
```

Copies preserve exact canonical/known task conflict bytes, not SQLite or transport history. They are verified before publication; pending destinations stay blocked until receipt completion. If interrupted, resume through the **original selected root and cache**, not the new destination. Keep the original context/key/payload for an uncertain retry. Malformed/partial evidence, unrecorded directory creation and changed files/bindings require inspection rather than automatic repair. Do not select/share a private `.stage` folder. The earlier [stage-only primitive](src/backend/v2CopyStage.ts) still deliberately leaves destinations unpublished; its artifacts are not public-command receipts. All this remains experimental Linux/WSL2 evidence, not native/provider acceptance or v1 migration.

### Check a disposable v1 conversion

The read-only developer helper checks a complete v1 copy and plans its v2 files in memory. It refuses missing orders, unresolved conflicts, unknown fields or lossy timestamps rather than guessing. This is **not a migration command**: it writes no files and does not switch collections.

```bash
pnpm build:backend
v1scratch=$(mktemp -d)
cp -R scripts/fixtures/taskdb-v1/sync "$v1scratch/source"
node --input-type=module - "$v1scratch/source" <<'NODE'
import { planV1ToV2Conversion } from './dist/backend/v2V1Conversion.js';
const plan = planV1ToV2Conversion(process.argv[2]);
console.log(`${plan.tasks.length} tasks checked; ${plan.files.length} v2 files planned in memory. No files written.`);
NODE
```

Expect four tasks and five planned files. IDs, notes, relationships, complete sibling order and timestamp instants are retained. Legacy title metadata becomes category/tag fields without new escape decoding. This helper remains read-only; the separate Linux command below handles verified staging. Keep using disposable copies; do not use personal data. See [conversion evidence](spec/v2/conformance.md#read-only-v1-conversion-component).

### Migrate a disposable v1 copy, then choose a version explicitly

Linux only. Pause all v1 writers and sharing yourself, and use a disconnected destination. The new lock does **not** stop legacy writers or Syncthing. This example uses only committed synthetic fixtures and needs `jq`:

```bash
pnpm build:backend
migscratch=$(mktemp -d)
cp -R scripts/fixtures/taskdb-v1/sync "$migscratch/v1"
migrate() {
  XDG_DATA_HOME="$migscratch/local-data" node dist/backend/cli.js \
    --stdio --v2-root "$migscratch/v1" --database "$migscratch/control.db"
}
context=$(printf '%s\n' '{"version":2,"command":"workspace.info"}' | migrate | jq -r '.writeContext')
jq -nc --arg ctx "$context" --arg dest "$migscratch/v2" \
  '{version:2,command:"workspace.migrateV1",writeContext:$ctx,dryRun:true,args:{destinationDirectory:$dest}}' | migrate
jq -nc --arg ctx "$context" --arg dest "$migscratch/v2" \
  '{version:2,command:"workspace.migrateV1",writeContext:$ctx,idempotencyKey:"migration-1",args:{destinationDirectory:$dest}}' | migrate
```

Expect four tasks. Success publishes the separate v2 folder, retains the untouched v1 folder and an independent raw-byte recovery archive under local app-data, and returns their locations plus a rollback warning. It does not switch the app, enable sharing or import the old database. The raw archive is recovery data, not another selectable workspace; keep it and the original v1 folder. Partial/unpublished evidence and changed sources/stages/backups require inspection. To resume, use the original **v1 root, control cache and app-data profile** with `workspace.recovery.resume`; retain the original context/key/payload for uncertain retries.

Only after success, explicitly inspect/select v2 with a **fresh cache**:

```bash
printf '%s\n' '{"version":2,"command":"workspace.info"}' | \
  XDG_DATA_HOME="$migscratch/local-data" node dist/backend/cli.js \
    --stdio --v2-root "$migscratch/v2" --database "$migscratch/fresh-v2.db"
```

**Rollback restores pre-migration v1 state. Later v2 edits are not brought back.** Keep the v2 folder separately, and explicitly reopen the preserved v1 folder with the v1 client:

```bash
printf '%s\n' '{"version":1,"requestId":"rollback-check","command":"task.list","args":{"sort":"manual"}}' | \
  TASKS_SYNC_ROOT="$migscratch/v1" XDG_DATA_HOME="$migscratch/local-data" \
  node dist/backend/cli.js --stdio --database "$migscratch/fresh-v1.db"
```

This changes only the root/client selected for that invocation, not the default UI or registry. No reverse conversion or automatic rollback command exists. Native/UI migration and personal-data rollout remain unaccepted. See [migration evidence](spec/v2/conformance.md#guarded-v1-migration-and-explicit-rollback).

## Documentation

- [Current system specification](spec/overview.md): the implemented v1 task model, storage, protocol, queries, mutations, CLI, sources, and UI behavior.
- [V2 accepted target](spec/v2/overview.md): versioned single-root contracts and expected conformance cases, with a bounded opt-in Node task/control subset; the complete target is not implemented.
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
