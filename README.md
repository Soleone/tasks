# Tasks

A local-first, keyboard-first task app for people and their existing agents. Tasks uses a TypeScript command path, a Tauri desktop shell, a standalone JSON-lines CLI, and a canonical JSON workspace with a local SQLite cache that also keeps receipts and history.

**Status:** M0 is complete; replacement native/owner acceptance and release remain open. [Current support and evidence](docs/support.md) distinguishes the legacy defaults, broad Linux replacement backend and bounded Windows native main client. Cache growth is fixed, the technical native loop/restored UI and disposable Linux migration rehearsal are complete, but Windows child/relationship/order/batch/general-undo integration and other essentials remain unresolved. Automation is not owner dogfood or full native parity.

The [current plan](PLAN.md) targets one publishable application, isolated one-time conversion and removal of legacy/runtime-version dispatch. The defaults and opt-in modes below are temporary implementation state, not permanent coexistence. [Replacement contracts](spec/v2/overview.md) have bounded implementation and declarative fixtures, not full supported-surface/native acceptance or a public-standard claim. The opt-in multi-source controller remains a Node-only prototype, not the release direction.

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

For the **legacy default**, if another device already has task history, use **Settings → Sync with another device…** on the new device before adding its folder to Syncthing. That flow backs up and empties the local workspace, locks the UI, and waits for the existing workspace; follow [the Syncthing setup](docs/syncthing.md). It is not supported on the selected Windows replacement route. See [current receive/migration limits](docs/support.md#main-client-gaps-that-remain).

## Opt-in v2 browser reader

The default app stays v1. A separate, **read-only** v2 browser mode now lets you inspect a disposable schema-2 folder, watch CLI changes, search/filter by status and open literal task details. It is an unfinished client milestone, not the full v2 app or native acceptance.

Start it from the project root:

```bash
viewscratch=$(mktemp -d)
cp -R scripts/fixtures/taskdb-v2/root "$viewscratch/root"
printf 'Disposable reader workspace: %s\n' "$viewscratch"
XDG_DATA_HOME="$viewscratch/local-data" pnpm dev:web \
  --v2-root "$viewscratch/root" --database "$viewscratch/cache.db"
```

1. Open the URL Vite prints. Check the displayed task folder and outside-root cache, then choose **Browse this v2 folder**. No task query or cache creation occurs before confirmation.
2. The task list receives initial focus. Use arrows or J/K while the list is focused; Enter or **Show details** opens a read-only snapshot, and Escape returns to the list. Titles such as `Call @alice` stay literal. Category/tag badges show canonical slugs, not inferred labels.
3. In another terminal, use the [opt-in human CLI](#opt-in-v2-human-cli) with the **same printed root, cache and `XDG_DATA_HOME`**. New CLI changes appear during visible-page refresh without stealing search or dialog focus.
4. Pending recovery pauses browsing. Preserve the original root/cache/profile/evidence and use the CLI's explicit recovery controls or manual inspection. Refresh does not repair, retry writes or switch folders.
5. **Leave folder** returns to confirmation. Reloads also require confirmation; this mode saves no selection. Stop the server and run the ordinary v1 app with your separately preserved v1 folder to return to v1. Later v2 edits are not reverse-converted.

Both directory flags are required; v1 environment/registry/database defaults are never used in this mode. Put optional Vite flags after `--`. The dev bridge accepts only v2 queries and uses a per-process selection token to refuse a restarted/replaced backend until you reload and confirm again. This is a local development guard, not a filesystem sandbox or distributed authority. Reads can update the **local** query cache; they never initialize or edit canonical tasks.

Capture, status changes, editing, relationships, ordering, undo, purge, doctor, migration/adoption/rollback and recovery controls remain unavailable in this UI. This browser command does not select the native pilot; Android v2 integration remains withheld. The separate [disposable Windows native pilot](docs/windows-native-pilot.md) selects one explicit inline capability, not a second same-name scope. Default native permissions and the default v1 sidecar remain unchanged. See [reader evidence](spec/v2/conformance.md#explicit-read-only-app-reader) and [the interaction subset](docs/usage-guide.md#experimental-v2-browser-reader). Run `node scripts/check-v2-ui.mjs` for the isolated Chromium check; it requires `agent-browser` and is not native acceptance.

## Disposable Windows native pilot

On the declared Windows/NTFS host, run `pnpm dev:native --v2-root ROOT --database CACHE --local-profile PROFILE` with three explicit disposable paths, then confirm them in the actual window. This now opens the **existing main Tasks client**, not the experimental reader/editor workbench: the original task list, compact toolbar, inline capture/editing, themes and keyboard/mouse flows. It uses the selected new-format workspace through one embedded SEA session, with direct save/status actions and retained exact-request retry. Relationships, reordering, batch/general undo and other unproven native writes remain withheld; no legacy fallback is used. See [restored-client evidence](docs/restored-main-client.md). It does not change the default app or select personal tasks.

[Runnable PowerShell setup, native evidence, retry/reload limits and backup/restore walkthrough](docs/windows-native-pilot.md). `pnpm dev:tauri` is still v1, not this pilot. Owner dogfood and single-codebase cutover remain open.

## Opt-in v2 capture and editing

Linux development only, on disposable data. The reader stays read-only unless you add **`--v2-edit`**. This bounded browser mode enables literal capture/content editing and six single-task status commands, but not status undo, relationship editing, the full v2 app or native acceptance. Status undo in the existing main Tasks client is unchanged.

```bash
editscratch=$(mktemp -d)
cp -R scripts/fixtures/taskdb-v2/root "$editscratch/root"
printf 'Disposable editor workspace: %s\n' "$editscratch"
XDG_DATA_HOME="$editscratch/local-data" pnpm dev:web \
  --v2-root "$editscratch/root" --database "$editscratch/cache.db" --v2-edit
```

1. Confirm the displayed folder, cache and retained local profile, then choose **Enable editing and status changes in this folder**. The list still receives initial focus.
2. Press **C** or choose **New task** to capture a root task. Press **Enter** on the active row or choose **Edit content** to edit it. Title is literal; category is a separate slug and tags are comma-separated slugs. Empty category/tags/description clear those fields. These fields do not accept shorthand. For status, press **T** on the list or choose **Change status**. Pick Start or resume, Pause, Complete, Reopen, Cancel except done, or Cancel any state (delete alias), then preview and apply. These are explicit commands, not direct editing of the stored status field.
3. Choose **Preview changes**. No canonical changes, receipt or activity are made. Creation IDs/time/versions are hypothetical, not reserved. Editing a field invalidates the preview. **Apply original request** sends the prepared context, key, payload, actor, flags and original task version; changed authority is refused, not silently refreshed.
4. A failed executing reply locks the editor and retains that exact request **only in this page**. **Retry same request** sends no authority-negotiating query, new key, new payload or automatic recovery. A successful replay is historical: the app refreshes current tasks separately instead of treating the returned version as fresh authority.
5. For pending work, preserve the original root/cache/profile/evidence and use explicit CLI recovery. If the backend restarts/replaces selection, the retained token is refused; the editor does not reconnect automatically. Use **Copy original request**, also retain the displayed paths, and reconcile through the original CLI context. The collapsible **Original request and local paths** section is a manual-copy fallback. Closing for manual reconciliation requires explicit acknowledgment and does not claim completion.

**Do not reload, change roots/profiles, restart the frontend or edit source files while a write is unresolved.** Retry state is memory-only; a reload/tab loss discards it. The page asks before leaving, but that prompt is not durable recovery. There is no plaintext retry log, saved selection or second success ledger. Copying an envelope is an explicit user action and includes task content; keep it private, outside the synced root. The profile path/token guard is lexical/development evidence, not proof of physical-profile continuity, a filesystem sandbox or distributed exactly-once. Cache loss rejects the old context even if a matching title exists.

Status commands preserve content, creation/edit time, ordering and relationships. Closing sets closure time; reopening/starting clears it. Same-state actions are receipt-only no-ops. No status cascades occur; a done dependency still blocks, while cancellation stops blocking without removing the link. **Cancel except done** refuses done tasks; **Cancel any state (delete alias)** accepts them. Neither removes a file. Status previews show hypothetical new closure times, not a reserved plan. If another process changes the task, the old version is refused and the exact executing request remains locked for reconciliation.

The bridge still refuses relationship edits, single-status and batch undo, grouped/operation/deletion undo, status batches, general ordering, purge, doctor, initialization, migration/adoption/rollback and recovery commands. This browser bridge is not the [disposable Windows native pilot](docs/windows-native-pilot.md), which supports the smaller proven command subset. Android v2 UI remains withheld. Read-only and editable handshakes cannot silently cross modes; unflagged `pnpm dev:web` stays v1. See [editor evidence](spec/v2/conformance.md#explicit-browser-capture-and-content-editing) and [interaction details](docs/usage-guide.md#experimental-v2-content-editor). Run `node scripts/check-v2-editor-ui.mjs` for the disposable Chromium check.

## Opt-in v2 human CLI

The default app and `tasks-cli` **without `--v2-root` remain v1**. The friendly Node CLI now has an explicitly selected v2 mode over the same protocol gateway. Linux writes only: this friendly entry point does not select the Windows task-proof profile. The separate Windows proofs use the raw backend JSON-lines route, not friendly writes. Use disposable copies and pause other writers/sharing before destructive work. It requires both a root and a separate cache, with no v1 environment or registry fallback.

This example needs `jq`. It adds a literal title with explicit classification, replays the exact capture once, clears classification/notes, and previews shorthand capture:

```bash
pnpm build:backend
humanscratch=$(mktemp -d)
cp -R scripts/fixtures/taskdb-v2/root "$humanscratch/root"
v2tasks() {
  XDG_DATA_HOME="$humanscratch/local-data" node dist/backend/tasks-cli.js \
    --v2-root "$humanscratch/root" --database "$humanscratch/cache.db" "$@"
}
created=$(v2tasks add --title 'Call @alice' --category WORK --tag TODO \
  --description '**Markdown** notes' --json 2>"$humanscratch/create.stderr")
id=$(printf '%s\n' "$created" | jq -r '.task.id')
retry=$(jq -Rc 'select(startswith("tasks-cli retry: ")) | ltrimstr("tasks-cli retry: ") | fromjson' \
  "$humanscratch/create.stderr")
replayed=$(v2tasks add --title 'Call @alice' --category WORK --tag TODO \
  --description '**Markdown** notes' --json \
  --write-context "$(printf '%s\n' "$retry" | jq -r '.writeContext')" \
  --idempotency-key "$(printf '%s\n' "$retry" | jq -r '.idempotencyKey')" \
  --request-hash "$(printf '%s\n' "$retry" | jq -r '.requestHash')")
test "$id" = "$(printf '%s\n' "$replayed" | jq -r '.task.id')"
v2tasks update "$id" --clear-category --clear-tags --description ''
v2tasks add 'Review @Work #TODO' --dry-run
v2tasks list --sort manual
```

`--title` is literal; positional `add` or `--text` is replacement shorthand. `update --title` preserves omitted classification; `update --text` replaces title/category/tags together. Repeated `--tag` replaces tags, `--clear-tags` empties them, and `--clear-category` removes the category. Conflicting/mixed forms are rejected. `--description` maps the canonical `description` field, including empty strings and Markdown. `--source-key`/`sources` remain v1-only. `--json` prints a result or error, not a protocol envelope; `info --json` also exposes the current `writeContext`. See `v2tasks --help` for task/query/undo/link/purge verbs and exits (stale task version is still exit 3).

For a **new** operation the CLI may fetch context/version and generate a key. Before an executing write it synchronously reports `tasks-cli retry: {...}` to stderr, without title/description/classification payload text. Save that line and the exact original arguments. A supplied key requires original `--write-context`; existing-task writes also require original `--expected-version`. Reuse original actor/preview flags, directory arguments, root/cache and retained app-data profile. Include the reported `--request-hash` to reject changed payload, actor, flags, placement or selected root/cache/profile paths **before dispatch**. This is a client guard over lexical paths and protocol identity, not physical-profile recovery or distributed exactly-once. A failed or incomplete retry-metadata report prevents execution, but saving terminal output is your responsibility. No automatic retry, authority refresh, plaintext payload log or second success ledger is added.

If `info` reports `recovery_pending`, preserve everything and use `recover OPERATION_ID` explicitly through the original root/cache/profile. That is a separate recovery operation with current authority, not permission to reissue an uncertain original with a new key or version. Lost profile/evidence can require manual reconciliation; deleting the cache is not a rebuild. Previews consume no effects/key and their IDs/times/versions are hypothetical.

Lifecycle verbs are `init`, `rebuild`, `archive DESTINATION`, `restore SOURCE DESTINATION`, and `migrate-v1 DESTINATION`. `init` requires a selected existing empty folder; `rebuild` changes only the retained cache. Archive copies the selected v2 root; restore uses the named v2 source plus a separate selected v2 control root; migration selects the preserved v1 source with a separate v2 control cache. Destinations must be disjoint/empty with existing parents. None switches selection or enables sharing. Rollback means opening preserved pre-migration v1 state with a v1 client; later v2 edits stay separate. Ordering, status batches and reviewed doctor remain [advanced JSON-lines controls](#disposable-v2-probe), not invented friendly verbs. The [human CLI evidence](spec/v2/conformance.md#explicit-opt-in-human-cli) is WSL2 Node process proof, not UI/native/provider or personal-rollout acceptance.

## Disposable v2 probe

The default app and CLI without `--v2-root` remain v1. Explicit protocol-2 Node mode supports info/get/list/category/tag. On Linux it additionally supports guarded task creation/content/status/parent/dependency edits and ordering/normalization (including previews), local activity, verified archive/restore, guarded v1 migration to a separate folder, explicit empty-folder initialization, cache-only rebuild, and recovery of published task/order/batch/copy/migration/init intents. Guarded status/grouped undo, status batches and verified canceled-task purge are now supported. Reviewed doctor inspection, fixed local planning, guarded apply/conflict cleanup and published-intent recovery are now supported. Use disposable copies, not personal data:

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

Previews consume no key or canonical effects. Creation preview IDs/times/versions are hypothetical, not reserved authority or a prepared executing request. New captures use a hidden sibling stage and native rename, without pending/progress evidence. If a call is uncertain, inspect the root before retrying: publication before the local receipt can result in a duplicate. Existing pending intents, including older create intents and interrupted status writes, can be resumed through the original root/cache/profile. Historical receipt replay can return an old version, including after a task disappears, without recreating it. These remain disposable Linux/WSL2 controls, not native/provider or personal-rollout acceptance. See [capture/status evidence](spec/v2/conformance.md#recoverable-capture-and-status).

### Move a task or change its blockers

Linux only, with `jq`, using a disposable copy of the example collection. This moves its child task to another parent, adds a done task as a blocker, then explicitly removes that blocker:

```bash
pnpm build:backend
relscratch=$(mktemp -d)
cp -R scripts/fixtures/taskdb-v2/root "$relscratch/root"
relationships() {
  XDG_DATA_HOME="$relscratch/local-data" node dist/backend/cli.js \
    --stdio --v2-root "$relscratch/root" --database "$relscratch/cache.db"
}
id=6e1bf023-da3c-4785-b8a9-a696ac1fa5c1
parent=62f159c1-22a7-45cb-89a0-c0c35aaeb1ed
blocker=f3e5499b-402e-4d7d-8b61-eefc4409ca32
current=$(jq -nc --arg id "$id" '{version:2,command:"task.get",args:{id:$id}}' | relationships)
context=$(printf '%s\n' "$current" | jq -r '.writeContext')
version=$(printf '%s\n' "$current" | jq -r '.result.task.version')
moved=$(jq -nc --arg ctx "$context" --arg id "$id" --arg parent "$parent" --argjson version "$version" \
  '{version:2,command:"task.move",writeContext:$ctx,idempotencyKey:"move-1",args:{id:$id,expectedVersion:$version,parentId:$parent}}' | relationships)
printf '%s\n' "$moved"
version=$(printf '%s\n' "$moved" | jq -r '.result.task.version')
added=$(jq -nc --arg ctx "$context" --arg id "$id" --arg blocker "$blocker" --argjson version "$version" \
  '{version:2,command:"task.dependency.add",writeContext:$ctx,idempotencyKey:"blocker-1",args:{id:$id,expectedVersion:$version,dependsOnId:$blocker}}' | relationships)
printf '%s\n' "$added"
version=$(printf '%s\n' "$added" | jq -r '.result.task.version')
jq -nc --arg ctx "$context" --arg id "$id" --arg blocker "$blocker" --argjson version "$version" \
  '{version:2,command:"task.dependency.remove",writeContext:$ctx,idempotencyKey:"remove-1",args:{id:$id,expectedVersion:$version,dependsOnId:$blocker}}' | relationships
```

`task.move` requires explicit `parentId` (use JSON `null` to remove a parent), `id` and fresh `expectedVersion`. A changed parent places the task first in the **complete** new sibling scope, including canceled/hidden tasks; same-parent requests do not reorder it. Descendant links stay intact. New parents/blockers must exist and not be canceled; existing canceled links may remain unchanged or be removed. Parent and dependency graphs are separate DAGs, checked before writes. No cascades or implicit unlinking.

Dependency commands take `dependsOnId`, not a replacement array. Adding an existing link or removing an absent link is a receipt-only no-op. Done dependencies still block; canceled dependencies do not, although their links remain until explicitly removed. Relationship edits advance edit time and versions while preserving closure, creation time and other content; reparenting also advances affected old/new sibling tokens without rewriting sibling files.

For each **new** edit use its current task version. Keep the original context/key/payload/version when retrying an uncertain call. Recovery retains the fixed key/time and checks the full guarded graph and sibling observations: arrivals, formatting edits, changed links/state or missing files require inspection, not reallocation or resurrection. [Relationship evidence](spec/v2/conformance.md#guarded-parent-and-dependency-edits) remains Linux/WSL2 process proof only, not native/provider or personal-data acceptance.

### Reorder siblings or explicitly normalize their keys

Linux only, with `jq`, on a disposable copy. This puts the planning task first, then normalizes the complete root sibling scope without changing its sequence:

```bash
pnpm build:backend
orderscratch=$(mktemp -d)
cp -R scripts/fixtures/taskdb-v2/root "$orderscratch/root"
ordering() {
  XDG_DATA_HOME="$orderscratch/local-data" node dist/backend/cli.js \
    --stdio --v2-root "$orderscratch/root" --database "$orderscratch/cache.db"
}
id=c8d4206d-c25a-4317-baa4-a2c5443060e9
current=$(jq -nc --arg id "$id" '{version:2,command:"task.get",args:{id:$id}}' | ordering)
context=$(printf '%s\n' "$current" | jq -r '.writeContext')
version=$(printf '%s\n' "$current" | jq -r '.result.task.version')
jq -nc --arg ctx "$context" --arg id "$id" --argjson version "$version" \
  '{version:2,command:"task.reorder",writeContext:$ctx,idempotencyKey:"order-1",args:{tasks:[{id:$id,expectedVersion:$version}],placement:{first:true}}}' | ordering
siblings=$(printf '%s\n' '{"version":2,"command":"task.list","args":{"sort":"manual","limit":100}}' | ordering | \
  jq -c '[.result.tasks[] | select(.parentId == null) | {id,expectedVersion:.version}]')
jq -nc --arg ctx "$context" --argjson tasks "$siblings" \
  '{version:2,command:"task.order.normalize",writeContext:$ctx,idempotencyKey:"normalize-1",args:{parentId:null,tasks:$tasks}}' | ordering
```

Reorder supplies unique versioned IDs **in their current sibling order** and exactly one placement: `beforeId`, `afterId`, `first:true`, or `last:true`. An anchor must be an unselected sibling. Canceled/hidden tasks still belong to the scope. A gap inside equal keys may rewrite the surrounding tied run, not outside neighbors. `rewrittenIds` lists actual file changes; a selected task's position/version can change even if its key stays the same. All non-order fields and timestamps remain intact.

Normalization requires explicit `parentId` (JSON `null` for roots) and **every sibling**, including canceled/hidden tasks, in current order. The small example fits in one page; larger scopes require all pages from a consistent observation, not a filtered or truncated list. Normalization preserves sequence but is meaningful unless all keys already match. It is never an automatic overflow fallback. Both commands have non-consuming previews and receipt-only no-ops; use fresh versions for a new edit, but keep the original context/key/versioned list/placement/actor/flags for an uncertain retry.

Multi-file recovery recognizes exact before/next bytes and finishes only the fixed plan. Arrivals, deletion, formatting or other divergence stop with preserved pending evidence, without rollback, resurrection or choosing another gap. Resume through the original root/cache/profile. Grouped history keeps selected intent, incidental rewrites and complete old/new scopes; eligible inverses use `operation.undo` below. See [ordering evidence](spec/v2/conformance.md#recoverable-ordering-and-normalization) for process-only Linux/WSL2 limits. Default v1 UI/CLI and personal data remain untouched.

### Undo an eligible local change

Linux only, with `jq`, on a disposable copy. This reopens a done example task, restores its exact historical status/closure, then makes and undoes a priority edit:

```bash
pnpm build:backend
undoscratch=$(mktemp -d)
cp -R scripts/fixtures/taskdb-v2/root "$undoscratch/root"
experimental_undo() {
  XDG_DATA_HOME="$undoscratch/local-data" node dist/backend/cli.js \
    --stdio --v2-root "$undoscratch/root" --database "$undoscratch/cache.db"
}
id=f3e5499b-402e-4d7d-8b61-eefc4409ca32
current=$(jq -nc --arg id "$id" '{version:2,command:"task.get",args:{id:$id}}' | experimental_undo)
context=$(printf '%s\n' "$current" | jq -r '.writeContext')
version=$(printf '%s\n' "$current" | jq -r '.result.task.version')
reopened=$(jq -nc --arg ctx "$context" --arg id "$id" --argjson version "$version" \
  '{version:2,command:"task.reopen",writeContext:$ctx,idempotencyKey:"reopen-1",args:{id:$id,expectedVersion:$version}}' | experimental_undo)
printf '%s\n' "$reopened"
version=$(printf '%s\n' "$reopened" | jq -r '.result.task.version')
restored=$(jq -nc --arg ctx "$context" --arg id "$id" --argjson version "$version" \
  '{version:2,command:"task.status.undo",writeContext:$ctx,idempotencyKey:"status-undo-1",args:{id:$id,expectedVersion:$version}}' | experimental_undo)
printf '%s\n' "$restored"
version=$(printf '%s\n' "$restored" | jq -r '.result.task.version')
edited=$(jq -nc --arg ctx "$context" --arg id "$id" --argjson version "$version" \
  '{version:2,command:"task.update",writeContext:$ctx,idempotencyKey:"priority-1",args:{id:$id,expectedVersion:$version,priority:0}}' | experimental_undo)
printf '%s\n' "$edited"
operation=$(printf '%s\n' "$edited" | jq -r '.result.operationId')
jq -nc --arg ctx "$context" --arg op "$operation" \
  '{version:2,command:"operation.undo",writeContext:$ctx,idempotencyKey:"priority-undo-1",args:{operationId:$op}}' | experimental_undo
```

`task.status.undo` needs fresh context/version and the latest meaningful local status history. An intervening meaningful task change makes it unavailable; no-ops do not replace history. `task.status.undoMany` takes unique `{id,expectedVersion}` items and restores eligible histories in one group. `task.transitionMany` takes unique `{id,expectedVersion,command}` items using one of the six supported status commands. Any invalid item refuses the entire batch before writes; empty/all-no-op batches are receipt-only.

`operation.undo` names an eligible local operation ID, not a task version. It checks current affected fields, full graph and relevant recorded sibling sequence/keys, while preserving unrelated later fields. Content/relationship inverses use one new edit time; status/order-only inverses preserve current edit time and restore exact historic closure where affected. Ordering also restores unchanged-key selected tasks' local authority. An already-consumed or partially undone group is unavailable; this slice does not provide redo or undo-of-undo, purge, doctor or migration reversal.

Creation undo is deliberately stricter: only unchanged exact capture bytes, latest retained history and no incoming children/blockers or conflict copies qualify. Success physically removes that one file, returns `removedIds` plus `recoveryLocation`, and permanently retains independently verified raw originals outside the synced root. Do not automatically restore/adopt those copies or delete them during pending work. This differs from `task.delete`, which only cancels.

Retained-cache restart/rebuild keeps history, receipts and consumed-history marks; cache loss cannot invent undo authority. A retained pending journal can be explicitly recovered at the original root/cache/profile with fresh context after cache loss, but old-context retries remain invalid. Keep the original context/key/payload/versioned list/operation ID/actor/flags for uncertain calls. Missing/divergent archive, stage, canonical bytes or scope membership stops recovery without rollback, resurrection or another inverse plan. See [undo evidence](spec/v2/conformance.md#guarded-status-and-grouped-undo). These are experimental Linux/WSL2 controls, not native/provider or personal-rollout acceptance.

### Purge canceled tasks from a disposable folder

Linux only, with `jq`. This cancels an unreferenced example task, previews the **complete canceled set**, then removes that set with an independent raw recovery copy:

```bash
pnpm build:backend
purgescratch=$(mktemp -d)
cp -R scripts/fixtures/taskdb-v2/root "$purgescratch/root"
experimental_purge() {
  XDG_DATA_HOME="$purgescratch/local-data" node dist/backend/cli.js \
    --stdio --v2-root "$purgescratch/root" --database "$purgescratch/cache.db"
}
id=62f159c1-22a7-45cb-89a0-c0c35aaeb1ed
current=$(jq -nc --arg id "$id" '{version:2,command:"task.get",args:{id:$id}}' | experimental_purge)
context=$(printf '%s\n' "$current" | jq -r '.writeContext')
version=$(printf '%s\n' "$current" | jq -r '.result.task.version')
jq -nc --arg ctx "$context" --arg id "$id" --argjson version "$version" \
  '{version:2,command:"task.cancel",writeContext:$ctx,idempotencyKey:"cancel-1",args:{id:$id,expectedVersion:$version}}' | experimental_purge
jq -nc --arg ctx "$context" \
  '{version:2,command:"task.purgeCanceled",writeContext:$ctx,dryRun:true}' | experimental_purge
purged=$(jq -nc --arg ctx "$context" \
  '{version:2,command:"task.purgeCanceled",writeContext:$ctx,idempotencyKey:"purge-1"}' | experimental_purge)
printf '%s\n' "$purged"
printf '%s\n' "$purged" | jq -r '.result.recoveryLocation'
```

`task.delete` still only cancels. `task.purgeCanceled` takes **no args**, IDs, versions or filters: each new execution observes every canceled task, not a displayed page. A preview reserves nothing. Pause other writers and sharing yourself before destructive work; the local lock cannot stop arbitrary editors or Syncthing. Any surviving parent/dependency reference, even from a done task, refuses the entire purge with `PURGE_REFERENCED` and `error.details.references`. Explicitly unlink/cancel linked tasks in a separate reviewed edit; purge never does it for you. A wholly canceled linked subgraph can be removed together. An empty set is receipt-only, without activity, archive or undo invalidation.

The recovery copy preserves exact descriptor/task/known conflict bytes outside the synced root, including survivors; canonical conflict copies are not cleaned up. It is raw recovery data, not another selectable root or an automatically applied restore. Keep it independently backed up. Purge has no generic undo; related prior task/link/scope undo becomes unavailable, while unrelated eligible edits remain reversible. Survivors retain their bytes/timestamps; affected sibling tokens may advance.

Interrupted purge fixes the original canceled set, raw bytes, actor/time and root/cache/profile. Bound transient quarantines prove journal-authored deletion, including linked-subgraph prefixes; an unexplained missing file never qualifies. Missing/divergent archives, changed/reintroduced files, lost quarantine proof or changed bindings stop without further deletion, rollback or resurrection. Use explicit `workspace.recovery.resume` through the original root/cache/profile. Fresh-cache recovery can finish only with retained proof, never validate an old-context retry. Cache loss after committed quarantine cleanup has removed that proof requires manual reconciliation, not regenerated evidence. Keep the original context/key/payload/actor/flags for an uncertain original call. See [purge evidence](spec/v2/conformance.md#verified-canceled-task-purge). Native/provider, hardware power-loss and personal-rollout acceptance remain open.

### Review and apply a conflict repair in a disposable folder

Linux only, with `jq`. This creates a synthetic conflict **inside a disposable copy**, inspects its versions, prepares a keep-both plan retaining the current canonical version, then explicitly applies that plan:

```bash
pnpm build:backend
doctorscratch=$(mktemp -d)
cp -R scripts/fixtures/taskdb-v2/root "$doctorscratch/root"
doctor_control() {
  XDG_DATA_HOME="$doctorscratch/local-data" node dist/backend/cli.js \
    --stdio --v2-root "$doctorscratch/root" --database "$doctorscratch/cache.db"
}
id=62f159c1-22a7-45cb-89a0-c0c35aaeb1ed
jq '.title = "Alternate meeting notes"' "$doctorscratch/root/tasks/$id.json" \
  > "$doctorscratch/root/tasks/$id.sync-conflict-demo.json"
inspected=$(printf '%s\n' '{"version":2,"command":"workspace.doctor.inspect"}' | doctor_control)
context=$(printf '%s\n' "$inspected" | jq -r '.writeContext')
issue=$(printf '%s\n' "$inspected" | jq -r --arg id "$id" \
  '.result.issues[] | select(.code == "CONFLICT_COPY" and .taskId == $id) | .issueId')
original=$(printf '%s\n' "$inspected" | jq -r --arg id "$id" \
  '.result.versionRefs[] | select(.canonical and .taskId == $id) | .versionRef')
planned=$(jq -nc --arg ctx "$context" --arg issue "$issue" --arg original "$original" \
  '{version:2,command:"workspace.doctor.plan",writeContext:$ctx,idempotencyKey:"plan-1",args:{kind:"keep-both",issueIds:[$issue],canonicalVersions:[{issueId:$issue,versionRef:$original}],linkChoices:[]}}' | doctor_control)
printf '%s\n' "$planned"
planid=$(printf '%s\n' "$planned" | jq -r '.result.planId')
applied=$(jq -nc --arg ctx "$context" --arg plan "$planid" \
  '{version:2,command:"workspace.doctor.apply",writeContext:$ctx,idempotencyKey:"apply-1",args:{planId:$plan}}' | doctor_control)
printf '%s\n' "$applied"
```

**Applying the reviewed `planId` is explicit confirmation.** In real work, first nominate one repair device, complete known sync and manually pause sharing and all writers. Review the plan's chosen canonical versions, fixed clone IDs/keys, link edits and conflict-cleanup paths before applying. This example's paused fixture task has no incoming links; do not copy its empty `linkChoices` into another graph. Planning changes no files. Its `recoveryReady:false` path is only a proposed destination. Successful apply returns `recoveryReady:true` and an independently verified raw recovery file outside the synced root, then retires only selected conflict copies after every planned output and graph verifies. Other conflicts, unrelated bytes, Markdown and source timestamps remain preserved, except real link changes use one fixed apply edit time. Equal clone keys are allowed; no implicit normalization.

Inspection reports path/ID/exact-byte version references, incoming links and invalid/orphan evidence without turning alternate versions or an incomplete graph into normal task authority. It remains available during pending work; planning cannot resume or bypass that work. Invalid canonical records, invalid selected alternates, unsafe entries, descriptor conflicts and orphan copies are not repair sources in this bounded slice. Nonempty `keep-both` plans require an explicit choice for **every** surviving parent/dependency reference to a split ID, including references inside versions being copied. Use the [declared choice shapes](spec/v2/protocol.md#commands); omission refuses with `AMBIGUOUS_LINK`, never a guessed redirect.

`kind:"repair-links"` permits only explicit edits to reported dangling parents/dependencies, not arbitrary relationships/content. The complete proposed graph must be valid; new canceled parents/blockers refuse. Plans preserve each copied source's content/times/key, except explicit changed-parent placement is first in the complete new scope. Edit times do not advance during planning. Apply captures one fixed instant, validates raw source bindings again, publishes only the retained outputs, refreshes affected local authority and records one selected/clone/link activity group. It cannot be generically undone. Its recovery file is not another selectable root or an automatic rollback; inspect/reconcile originals into a reviewed new root if needed.

Executing planning retains one local plan and SQLite receipt under the original root/cache/context. Same-key retry keeps the original payload/actor/flags and returns the same IDs, even after source bytes change; that historical result is not renewed apply authority. Cache loss/copy invalidates old authority; retained-cache rebuild preserves plans, receipts and repair history. `dryRun`/`readOnly` creates no execution archive or canonical effects. Planning preview IDs are hypothetical rather than reserved; apply previews refer to the retained plan but reserve no future apply instant. A different-key second apply of an already consumed plan refuses rather than cloning again. Local retained repair history flags later unreviewed links to split IDs, without redirecting them; another device or lost history cannot infer those choices.

If apply is interrupted, preserve the original root, cache location, app-data profile, journal, archive and private stages/quarantines. Inspect `workspace.info` for its pending `operationId`, then use [explicit recovery](#disposable-v2-probe). Ordinary reads/writes refuse pending work. Recovery keeps the original IDs/time/actor and accepts only bound old/applied bytes and proven conflict removal. Missing/divergent originals, targets, stages, progress or archives stop without resurrection or new allocation. An absent clone after publication-start is uncertain even if no file was actually written; do not retry with new authority. Lost cache can explicitly finish retained complete proof at the original cache location, never revive the old request context. Cache loss after committed private cleanup removed proof, or an unpublished archive/progress/intent, can require manual reconciliation. Historical receipts remain replayable, not permission to repair a later divergence or regenerate recovery data.

Sharing/writers must be paused by people, not inferred from folder bytes. After successful repair, resume sharing and verify convergence before another device repairs. See [planning](spec/v2/conformance.md#doctor-inspection-and-retained-planning) and [guarded apply evidence](spec/v2/conformance.md#guarded-doctor-application-and-recovery). Native/provider, hardware power-loss, distributed exactly-once/CAS and personal-rollout acceptance remain open.

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

Copies preserve exact canonical/known task conflict bytes, not SQLite or transport history. They are verified before publication; pending destinations stay blocked until receipt completion. If interrupted, resume through the **original selected root and cache**, not the new destination. Keep the original context/key/payload for an uncertain retry. Malformed/partial evidence, unrecorded directory creation and changed files/bindings require inspection rather than automatic repair. Do not select/share a private `.stage` folder. The superseded stage-only helper has been removed; any retained artifacts from it are inspection evidence, not public-command receipts or permission to adopt a stage. All this remains experimental Linux/WSL2 evidence, not native/provider acceptance or v1 migration.

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

See the [verified one-user rehearsal/runbook](docs/migration-rehearsal.md) for preservation checks and recovery refusals. Windows native migration remains withheld; personal conversion/selection still requires explicit approval.

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

- [Current support and evidence](docs/support.md): actual entrypoints, platform/client boundaries, remaining gaps and acceptance limits.
- [Legacy-default specification](spec/overview.md): task model, storage, protocol, queries, mutations, CLI, sources and UI baseline.
- [Replacement contracts](spec/v2/overview.md): single-root requirements with bounded Linux/backend and Windows/native implementation; not blanket target support.
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
